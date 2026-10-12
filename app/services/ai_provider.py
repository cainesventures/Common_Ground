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
# nvidia-smi is a subprocess; sampling it before every single request would be
# its own drag, and VRAM pressure does not change meaningfully faster than this.
_VRAM_CHECK_TTL_SECONDS = 15


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
        # Number of model layers to place on the GPU. -1 = let Ollama decide
        # (all of them, if they fit).
        #
        # This is the only knob that makes a large model coexist with a
        # desktop on an 8GB card. llama3.1:8b fully offloaded holds ~5.3GB and
        # peaked at 6.0GB of 8.1GB, leaving ~2.1GB for a desktop that grows
        # past it -- which is what took this machine down. Keeping some layers
        # on the CPU trades tokens/sec for VRAM, and with 128GB of system RAM
        # the layers that live there cost speed, not stability.
        self._num_gpu = int(os.getenv("AI_NUM_GPU") or -1)
        self._pause_poll_seconds = int(os.getenv("AI_PAUSE_POLL_SECONDS") or 20)
        self._pause_max_seconds = int(os.getenv("AI_PAUSE_MAX_SECONDS") or 1800)
        self._game_checked_at = 0.0
        self._game_seen = False
        # Free VRAM, in MiB, below which we hand the card back and wait.
        #
        # The game check below was the only pause trigger, and it is a
        # hardcoded list of game executables. The desktop is what actually
        # competes for VRAM on this machine: a run that is fine against an idle
        # desktop starves the compositor once Chrome, VS Code and the Claude
        # app grow into the remaining headroom, and the symptom is that the
        # mouse still moves (hardware cursor plane) while clicks do nothing.
        # No game is involved, so nothing paused.
        #
        # 0 disables the check. It is a no-op anywhere nvidia-smi is absent,
        # which covers Railway and CI.
        self._vram_floor_mb = int(os.getenv("AI_VRAM_FLOOR_MB") or 1200)
        self._vram_checked_at = 0.0
        self._vram_free_mb = None

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

    def _free_vram_mb(self):
        """Free VRAM in MiB, or None when there is no NVIDIA telemetry.

        Cached briefly: this runs before every request, and shelling out to
        nvidia-smi per call would be its own overhead.
        """
        import subprocess
        import time
        if self._vram_floor_mb <= 0:
            return None
        now = time.time()
        if now - self._vram_checked_at < _VRAM_CHECK_TTL_SECONDS:
            return self._vram_free_mb
        self._vram_checked_at = now
        try:
            out = subprocess.run(
                ["nvidia-smi", "--query-gpu=memory.used,memory.total",
                 "--format=csv,noheader,nounits"],
                capture_output=True, text=True, timeout=10,
            ).stdout.strip().splitlines()[0]
            used, total = (int(x.strip()) for x in out.split(","))
            self._vram_free_mb = total - used
        except Exception:
            # No GPU, no nvidia-smi, or a CPU-only host: nothing to guard.
            self._vram_free_mb = None
        return self._vram_free_mb

    def _backoff_reason(self):
        """Why we should hand the GPU back right now, or None to proceed.

        Checked in cost order: the game list is a cached process scan, the
        VRAM sample is a cached subprocess.
        """
        if self._game_running():
            return "a game is running"
        free = self._free_vram_mb()
        if free is not None and free < self._vram_floor_mb:
            # Our own resident model counts toward `used`, so this reads as
            # "there is no longer room for both us and the desktop".
            return (f"only {free}MB VRAM free (floor {self._vram_floor_mb}MB)")
        return None

    def _wait_if_busy(self) -> None:
        """Block while the GPU is contended, rather than moving work to the CPU.

        Pausing is the only honest option: the GPU is what the other party
        needs, and the CPU fallback this replaces simply relocated the load
        onto the resource that was already saturated.

        Two triggers -- a known game, and free VRAM under a floor. The second
        is the one that matters day to day, because the competition is usually
        the desktop rather than a game. See `_vram_floor_mb`.
        """
        import time
        if self._policy != "pause":
            return
        reason = self._backoff_reason()
        if not reason:
            return

        self._unload()  # hand the VRAM back straight away
        waited = 0
        logger.warning("Ollama: pausing — %s", reason)
        while waited < self._pause_max_seconds:
            time.sleep(self._pause_poll_seconds)
            waited += self._pause_poll_seconds
            self._game_checked_at = 0.0   # force a fresh look
            self._vram_checked_at = 0.0
            if not self._backoff_reason():
                logger.info("Ollama: resuming after %ds", waited)
                return
        raise InferencePaused(
            f"The GPU stayed contended for over {self._pause_max_seconds}s "
            f"({reason}); stopping rather than competing with it. "
            "Set AI_GPU_POLICY=gpu to override."
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
        # num_gpu: how many layers go on the GPU.
        #
        # Never *derived* from free VRAM -- that was tried and was
        # self-defeating, because our own model load consumes the very headroom
        # being measured, so a concurrent check saw "not enough VRAM" and
        # pinned the whole run to the CPU on an idle GPU. It is only ever set
        # explicitly: 0 for CPU mode, or AI_NUM_GPU for a deliberate partial
        # offload chosen by the caller against a measurement.
        if self._policy == "cpu":
            options["num_gpu"] = 0
        elif self._num_gpu >= 0:
            options["num_gpu"] = self._num_gpu
        return options

    def resident_vram_mb(self) -> int:
        """VRAM this model currently holds, in MiB. 0 when not loaded.

        Needed to tell our own footprint apart from the desktop's. A guard
        that only looks at total free VRAM cannot do that, and so cannot tell
        "the desktop needs room" from "we are using the room" -- which makes
        it unload, see the memory freed, reload, and thrash.
        """
        try:
            r = self._client.get(f"{self.base_url}/api/ps", timeout=10)
            for m in (r.json() or {}).get("models", []):
                if m.get("name", "").startswith(self.model.split(":")[0]):
                    return int((m.get("size_vram") or 0) / (1024 * 1024))
        except Exception:
            pass
        return 0

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
