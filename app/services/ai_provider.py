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


class OllamaProvider(AIProvider):
    def __init__(self, base_url: str, model: str):
        self.base_url = base_url.rstrip("/")
        self.model = model

    def complete(self, system_prompt: str, user_prompt: str) -> str:
        import httpx
        url = f"{self.base_url}/api/chat"
        payload = {
            "model": self.model,
            "stream": False,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }
        r = httpx.post(url, json=payload, timeout=120)
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


def get_ai_provider() -> AIProvider:
    """Return the configured AI provider based on env vars."""
    from app.config import get_settings
    s = get_settings()

    provider = s.ai_provider.lower()
    model = s.ai_model
    api_key = s.ai_api_key
    base_url = s.ai_base_url

    if provider == "ollama":
        logger.debug(f"AI provider: Ollama ({base_url}, model={model})")
        return OllamaProvider(base_url=base_url, model=model)
    elif provider == "claude":
        logger.debug(f"AI provider: Claude (model={model})")
        return ClaudeProvider(api_key=api_key, model=model)
    elif provider == "openai":
        logger.debug(f"AI provider: OpenAI-compatible (base_url={base_url}, model={model})")
        return OpenAIProvider(api_key=api_key, model=model, base_url=base_url)
    else:
        raise ValueError(f"Unknown AI_PROVIDER={provider!r}. Must be 'ollama', 'claude', or 'openai'.")
