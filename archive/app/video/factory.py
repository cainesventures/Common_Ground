"""Factory for instantiating video generation providers.

To add a new provider:
1. Create a class in app/video/ that extends VideoProvider (app/video/base.py).
2. Add it to the PROVIDERS dict below with a short key name.
3. Add the provider's API key to app/config.py and .env.example.
"""

from app.video.base import VideoProvider

# Registry of available providers.  Add new entries here as more are implemented.
PROVIDERS: dict[str, type] = {}

# Lazy-import guard: only register HeyGen when the module can be imported.
try:
    from app.video.heygen import HeyGenVideoProvider
    PROVIDERS["heygen"] = HeyGenVideoProvider
except ImportError:
    pass


def create_video_provider(name: str) -> VideoProvider:
    """Instantiate a video provider by name, injecting its API key from settings.

    Args:
        name: Provider key (e.g. "heygen").

    Returns:
        Configured VideoProvider instance.

    Raises:
        ValueError: If the provider name is unknown.
    """
    from app.config import get_settings
    settings = get_settings()

    cls = PROVIDERS.get(name)
    if cls is None:
        raise ValueError(
            f"Unknown video provider '{name}'. "
            f"Available providers: {sorted(PROVIDERS)}"
        )

    # Each provider expects its API key as the first argument.
    # Extend this mapping when adding providers with different config keys.
    api_key_map: dict[str, str] = {
        "heygen": settings.heygen_api_key,
    }

    api_key = api_key_map.get(name, "")
    return cls(api_key=api_key)
