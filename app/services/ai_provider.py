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
# not take the GPU hostage. When one of these is running, inference drops to
# CPU-only and the model is evicted from VRAM.
_GAME_PROCESSES = {
    "tf_win64.exe", "tf.exe", "hl2.exe", "cs2.exe", "csgo.exe",
    "dota2.exe", "portal2.exe", "left4dead2.exe",
}
# How long a GPU/CPU decision stands before it is re-checked. Scanning the
# process table per request would cost more than the throttling saves.
_POLICY_TTL_SECONDS = 60


class OllamaProvider(AIProvider):
    def __init__(self, base_url: str, model: str):
        self.base_url = base_url.rstrip("/")
        self.model = model
        # Shared connection pool across all calls — avoids creating a new TCP
        # connection (and httpx transport) for every perspective generation.
        import httpx
        self._client = httpx.Client(timeout=300, limits=httpx.Limits(max_connections=30, max_keepalive_connections=10))

        import os
        # auto (default) backs off while a game is running; gpu/cpu force it.
        self._policy = (os.getenv("AI_GPU_POLICY") or "auto").strip().lower()
        self._num_thread = int(os.getenv("AI_NUM_THREAD") or 0)
        self._vram_floor_mb = int(os.getenv("AI_VRAM_FLOOR_MB") or 3000)
        self._use_gpu = True
        self._policy_checked_at = 0.0

    def _should_use_gpu(self) -> bool:
        """Whether to offload to the GPU, re-evaluated at most once a minute.

        Every probe is best-effort: on a host with no GPU, no nvidia-smi or no
        psutil (Railway, CI) this must not change the existing behaviour, so any
        failure falls through to using the GPU as before.
        """
        import time
        if self._policy == "gpu":
            return True
        if self._policy == "cpu":
            return False

        now = time.time()
        if now - self._policy_checked_at < _POLICY_TTL_SECONDS:
            return self._use_gpu
        self._policy_checked_at = now

        previous = self._use_gpu
        decision = True
        try:
            import psutil
            for p in psutil.process_iter(["name"]):
                if (p.info.get("name") or "").lower() in _GAME_PROCESSES:
                    decision = False
                    break
        except Exception:
            pass

        if decision:
            try:
                import subprocess
                out = subprocess.run(
                    ["nvidia-smi", "--query-gpu=memory.free", "--format=csv,noheader,nounits"],
                    capture_output=True, text=True, timeout=10,
                )
                if out.returncode == 0:
                    if int(out.stdout.strip().splitlines()[0]) < self._vram_floor_mb:
                        decision = False
            except Exception:
                pass

        self._use_gpu = decision
        if previous and not decision:
            logger.info("Ollama: backing off to CPU — GPU is in use elsewhere")
            self._unload()
        elif decision and not previous:
            logger.info("Ollama: GPU free again — resuming GPU inference")
        return decision

    def _unload(self) -> None:
        """Evict the model from VRAM instead of waiting out keep_alive."""
        try:
            self._client.post(
                f"{self.base_url}/api/chat",
                json={"model": self.model, "messages": [], "keep_alive": 0},
            )
        except Exception:
            pass

    def _options(self) -> dict:
        options: dict = {}
        if self._num_thread > 0:
            options["num_thread"] = self._num_thread
        if not self._should_use_gpu():
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
        url = f"{self.base_url}/api/chat"
        options = self._options()
        payload = {
            "model": self.model,
            "stream": False,
            # Shorter than it was: an abandoned run should give VRAM back
            # quickly rather than holding ~5GB for five minutes.
            "keep_alive": "60s",
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }
        if options:
            payload["options"] = options
        try:
            r = self._client.post(url, json=payload)
            r.raise_for_status()
            return r.json()["message"]["content"]
        except (httpx.ConnectError, httpx.ConnectTimeout):
            # Ollama not running — start it and retry once
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
