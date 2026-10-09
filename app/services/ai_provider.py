"""Plug-and-play AI provider abstraction.

Configured via env vars:
  AI_PROVIDER   = ollama | claude | openai   (default: ollama)
  AI_MODEL      = model name                 (default: llama3)
  AI_BASE_URL   = base URL                   (default: http://localhost:11434)
  AI_API_KEY    = API key                    (blank for Ollama)

Usage:
    provider = get_ai_provider()
    result = provider.complete(system_prompt="...", user_prompt="...")
"""

import logging
from abc import ABC, abstractmethod

logger = logging.getLogger(__name__)


class AIProvider(ABC):
    @abstractmethod
    def complete(self, system_prompt: str, user_prompt: str) -> str:
        """Return the model's text response."""


# Enrichment runs on the same desktop the owner uses, so a long pipeline should
# not take the machine hostage while one of these is running.
_GAME_PROCESSES = {
    "tf_win64.exe", "tf.exe", "hl2.exe", "cs2.exe", "csgo.exe",
    "dota2.exe", "portal2.exe", "left4dead2.exe",
}
# How long a game check stands before it is re-taken. Scanning the process
# table per request would cost more than the throttling saves.
_GAME_CHECK_TTL_SECONDS = 30


class InferencePaused(RuntimeError):
    """Raised when the machine stayed busy longer than we are willing to wait."""


class InferenceTimeout(RuntimeError):
    """A generation exceeded the client timeout.

    Distinct from a transport error because the server has NOT stopped: Ollama
    keeps generating after the client gives up, and it serialises per model, so
    an immediate retry queues behind work that is still running. Retrying on
    this is what turned a slow run into an unusable machine.
    """


class OllamaProvider(AIProvider):
    def __init__(self, base_url: str, model: str):
        self.base_url = base_url.rstrip("/")
        self.model = model
        # Shared connection pool across all calls — avoids creating a new TCP
        # connection (and httpx transport) for every perspective generation.
        import httpx
        self._client = httpx.Client(timeout=300, limits=httpx.Limits(max_connections=30, max_keepalive_connections=10))

        import os
        # "pause" (default) waits while a game is running. "gpu" never waits.
        # "cpu" forces CPU-only and is opt-in ONLY: an automatic CPU fallback
        # moved load onto the resource that was already contended (the game had
        # the CPU, not the VRAM), which is what made the machine unusable.
        self._policy = (os.getenv("AI_GPU_POLICY") or "pause").strip().lower()
        if self._policy == "auto":  # old name for the fallback behaviour
            self._policy = "pause"
        self._num_thread = int(os.getenv("AI_NUM_THREAD") or 0)
        # Cap generation length so one call cannot run away. Perspectives are
        # 2-3 paragraphs, ~400 tokens; this leaves headroom without unbounded
        # generation behind a client that has already given up.
        self._num_predict = int(os.getenv("AI_NUM_PREDICT") or 800)
        # 0 = let Ollama choose (its default scales with VRAM: 4k/32k/256k).
        # Set it for short tasks to keep the KV cache small -- see _options.
        self._num_ctx = int(os.getenv("AI_NUM_CTX") or 0)
        self._pause_poll_seconds = int(os.getenv("AI_PAUSE_POLL_SECONDS") or 20)
        self._pause_max_seconds = int(os.getenv("AI_PAUSE_MAX_SECONDS") or 1800)
        self._game_checked_at = 0.0
        self._game_seen = False

    def _game_running(self) -> bool:
        """Names of any known game process, re-checked at most twice a minute."""
        import time
        now = time.time()
        if now - self._game_checked_at < _GAME_CHECK_TTL_SECONDS:
            return self._game_seen
        self._game_checked_at = now

        seen = False
        try:
            import psutil
            for p in psutil.process_iter(["name"]):
                if (p.info.get("name") or "").lower() in _GAME_PROCESSES:
                    seen = True
                    break
        except Exception:
            # No psutil (Railway, CI) — never pause there.
            seen = False
        self._game_seen = seen
        return seen

    def _wait_if_busy(self) -> None:
        """Block while a game is running, rather than moving work to the CPU.

        Pausing is the only honest option: the GPU is what the game needs, and
        the CPU fallback this replaces simply relocated the load onto the
        resource the game was already saturating.
        """
        import time
        if self._policy != "pause" or not self._game_running():
            return

        self._unload()  # hand the VRAM back straight away
        waited = 0
        logger.info("Ollama: pausing — a game is running")
        while waited < self._pause_max_seconds:
            time.sleep(self._pause_poll_seconds)
            waited += self._pause_poll_seconds
            self._game_checked_at = 0.0  # force a fresh look
            if not self._game_running():
                logger.info(f"Ollama: resuming after {waited}s")
                return
        raise InferencePaused(
            f"A game has been running for over {self._pause_max_seconds}s; "
            "stopping rather than competing with it. Set AI_GPU_POLICY=gpu to override."
        )

    def _loaded_on_gpu(self) -> bool:
        """True when Ollama already holds this model in VRAM."""
        try:
            r = self._client.get(f"{self.base_url}/api/ps", timeout=10)
            for m in (r.json() or {}).get("models", []):
                if m.get("name", "").startswith(self.model.split(":")[0]):
                    return (m.get("size_vram") or 0) > 0
        except Exception:
            pass
        return False

    def _unload(self) -> None:
        """Evict the model from VRAM instead of waiting out keep_alive."""
        try:
            self._client.post(
                f"{self.base_url}/api/chat",
                json={"model": self.model, "messages": [], "keep_alive": 0},
                timeout=30,
            )
        except Exception:
            pass

    def _options(self) -> dict:
        options: dict = {"num_predict": self._num_predict}
        if self._num_thread > 0:
            options["num_thread"] = self._num_thread
        # Context window, per request rather than per server.
        #
        # OLLAMA_CONTEXT_LENGTH would pin this globally, but the pipelines need
        # different amounts: a headline is built from at most ~340 characters,
        # while the two-lane generator and `analyze` feed in whole bills. A
        # global value low enough to keep headline KV cache small would quietly
        # truncate those.
        #
        # It matters because KV cache is the part of VRAM that scales with
        # context, and VRAM headroom is the binding constraint on an 8GB card
        # shared with the desktop: llama3.1:8b at 4096 tokens holds ~537MB of
        # f16 KV on top of ~4.7GB of weights, which peaked at 6.0GB of 8.1GB.
        # Halving the context halves that share.
        if self._num_ctx > 0:
            options["num_ctx"] = self._num_ctx
        # num_gpu is set only when CPU mode is explicitly requested. Deciding it
        # from free VRAM was self-defeating: our own model load consumes the
        # very headroom being measured, so a concurrent check saw "not enough
        # VRAM" and pinned the whole run to the CPU on an idle GPU.
        if self._policy == "cpu":
            options["num_gpu"] = 0
        return options

    def _ensure_running(self) -> None:
        """Start Ollama if it's not reachable, then wait until ready."""
        import subprocess
        import sys
        import time
        import httpx

        health_url = f"{self.base_url}/api/tags"

        # Already running?
        try:
            httpx.get(health_url, timeout=2).raise_for_status()
            return
        except Exception:
            pass

        logger.info("Ollama not reachable — attempting to start...")
        kwargs = {"stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL}
        if sys.platform == "win32":
            kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW  # type: ignore[assignment]
        subprocess.Popen(["ollama", "serve"], **kwargs)

        # Wait up to 20 seconds for Ollama to be ready
        for i in range(20):
            time.sleep(1)
            try:
                httpx.get(health_url, timeout=2).raise_for_status()
                logger.info(f"Ollama ready after {i + 1}s")
                return
            except Exception:
                pass

        raise RuntimeError("Ollama did not start within 20 seconds.")

    def complete(self, system_prompt: str, user_prompt: str) -> str:
        import httpx
        self._wait_if_busy()

        url = f"{self.base_url}/api/chat"
        payload = {
            "model": self.model,
            "stream": False,
            # Shorter than it was: an abandoned run should give VRAM back
            # quickly rather than holding ~5GB for five minutes.
            "keep_alive": "60s",
            "options": self._options(),
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }
        try:
            r = self._client.post(url, json=payload)
            r.raise_for_status()
            return r.json()["message"]["content"]
        except (httpx.ReadTimeout, httpx.PoolTimeout) as e:
            # Do NOT retry. The client gave up but Ollama has not: it keeps
            # generating, and it serialises per model, so a retry queues behind
            # work still in flight. Repeating that is what pinned the CPU and
            # took the machine down.
            still_loaded = self._loaded_on_gpu()
            logger.warning(
                "Ollama generation exceeded the client timeout; the server is "
                "probably still working on it. Not retrying. "
                f"(model resident on GPU: {still_loaded})"
            )
            raise InferenceTimeout(str(e)) from e
        except (httpx.ConnectError, httpx.ConnectTimeout):
            # Ollama not running — start it and retry once. Safe to retry:
            # nothing was ever accepted by the server.
            self._ensure_running()
            r = self._client.post(url, json=payload)
            r.raise_for_status()
            return r.json()["message"]["content"]


class ClaudeProvider(AIProvider):
    def __init__(self, api_key: str, model: str):
        self.api_key = api_key
        self.model = model

    def complete(self, system_prompt: str, user_prompt: str) -> str:
        import anthropic
        client = anthropic.Anthropic(api_key=self.api_key)
        msg = client.messages.create(
            model=self.model,
            max_tokens=1024,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}],
        )
        return msg.content[0].text


class OpenAIProvider(AIProvider):
    """Works with any OpenAI-compatible API (OpenAI, Together, Groq, etc.)."""

    def __init__(self, api_key: str, model: str, base_url: str = ""):
        self.api_key = api_key
        self.model = model
        self.base_url = base_url or "https://api.openai.com/v1"

    def complete(self, system_prompt: str, user_prompt: str) -> str:
        import httpx
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }
        r = httpx.post(
            f"{self.base_url.rstrip('/')}/chat/completions",
            json=payload,
            headers=headers,
            timeout=120,
        )
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"]


_provider_instance: AIProvider | None = None

def get_ai_provider() -> AIProvider:
    """Return the configured AI provider (singleton — one instance per process)."""
    global _provider_instance
    if _provider_instance is not None:
        return _provider_instance
    from app.config import get_settings
    s = get_settings()

    provider = s.ai_provider.lower()
    model = s.ai_model
    api_key = s.ai_api_key
    base_url = s.ai_base_url

    if provider == "ollama":
        logger.debug(f"AI provider: Ollama ({base_url}, model={model})")
        _provider_instance = OllamaProvider(base_url=base_url, model=model)
    elif provider == "claude":
        logger.debug(f"AI provider: Claude (model={model})")
        _provider_instance = ClaudeProvider(api_key=api_key, model=model)
    elif provider == "openai":
        logger.debug(f"AI provider: OpenAI-compatible (base_url={base_url}, model={model})")
        _provider_instance = OpenAIProvider(api_key=api_key, model=model, base_url=base_url)
    else:
        raise ValueError(f"Unknown AI_PROVIDER={provider!r}. Must be 'ollama', 'claude', or 'openai'.")
    return _provider_instance
