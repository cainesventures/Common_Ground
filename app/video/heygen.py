"""HeyGen video generation provider.

API docs: https://docs.heygen.com/reference/new-session
Video generation endpoint: POST https://api.heygen.com/v2/video/generate
Status polling endpoint:   GET  https://api.heygen.com/v1/video_status.get?video_id={id}

Pricing: ~10 free credits/month on the free tier (~$1/min after that).
"""

import httpx
import json
import logging
import re
from typing import Any, Dict, List, Optional, TYPE_CHECKING

from app.video.base import VideoProvider

if TYPE_CHECKING:
    from app.models import Agent, Debate, DebateMessage

logger = logging.getLogger(__name__)

HEYGEN_API_BASE = "https://api.heygen.com"

# Default HeyGen stock avatars used when an agent has no avatar_id set.
# Key is the debate position; "default" covers any other position.
DEFAULT_AVATARS: Dict[str, str] = {
    "pro": "Wayne_20240711",
    "con": "Abigail_expressive_20230613",
    "neutral": "Josh_lite3_20230714",
    "default": "Josh_lite3_20230714",
}

# Default voice (neutral EN-US)
DEFAULT_VOICE_ID = "2d5b0e6cf36f460aa7fc47e3eee4ba54"

# HeyGen limits input text per scene; truncate long arguments to avoid errors.
MAX_SCRIPT_CHARS = 1500


def _to_spoken_script(message: "DebateMessage") -> str:
    """Return the best available text for TTS, cleaned of markdown and citations."""
    # Prefer the conversational simple variant — written to be heard, not read
    text = message.argument or ""
    if message.argument_variants:
        try:
            variants = json.loads(message.argument_variants)
            text = variants.get("simple") or text
        except (json.JSONDecodeError, AttributeError):
            pass

    # Strip citation brackets: [1], [2], [Source 1: Title], etc.
    text = re.sub(r'\[(?:Source\s+)?\d+[^\[\]]*?\]', '', text)
    # Strip markdown bold/italic markers
    text = re.sub(r'\*{1,3}([^*]+)\*{1,3}', r'\1', text)
    # Strip markdown headers
    text = re.sub(r'^#{1,6}\s+', '', text, flags=re.MULTILINE)
    # Collapse multiple spaces/newlines left by stripping
    text = re.sub(r'\n{3,}', '\n\n', text).strip()

    return text[:MAX_SCRIPT_CHARS]


class HeyGenVideoProvider(VideoProvider):
    """Generate talking-head debate videos via the HeyGen v2 API."""

    def __init__(self, api_key: str):
        if not api_key:
            raise ValueError("HeyGen API key is required")
        self.api_key = api_key

    def _headers(self) -> Dict[str, str]:
        return {
            "X-Api-Key": self.api_key,
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    def _build_scene(
        self,
        message: "DebateMessage",
        agent: Optional["Agent"],
        background_url: str = "",
    ) -> Dict[str, Any]:
        """Build one HeyGen video_input scene for a single debate message."""
        position = (message.position or "default").lower()

        # Avatar selection: agent override → position default → global default
        avatar_id = (
            (agent.avatar_id if agent else None)
            or DEFAULT_AVATARS.get(position)
            or DEFAULT_AVATARS["default"]
        )

        # Voice selection: agent override → global default
        voice_id = (agent.voice_id if agent else None) or DEFAULT_VOICE_ID

        script = _to_spoken_script(message)

        scene: Dict[str, Any] = {
            "character": {
                "type": "avatar",
                "avatar_id": avatar_id,
                "avatar_style": "normal",
            },
            "voice": {
                "type": "text",
                "input_text": script,
                "voice_id": voice_id,
                "speed": 1.0,
            },
        }

        if background_url:
            scene["background"] = {"type": "image", "url": background_url}
        else:
            # Dark studio fallback color when no image URL is set
            scene["background"] = {"type": "color", "value": "#111111"}

        return scene

    async def generate_video(
        self,
        debate: "Debate",
        messages: List["DebateMessage"],
        agents: Dict[str, "Agent"],
    ) -> str:
        """Submit a multi-scene debate video to HeyGen and return the video_id."""
        if not messages:
            raise ValueError("Cannot generate video: debate has no messages")

        from app.config import get_settings
        bg_url = get_settings().video_background_url

        scenes = [
            self._build_scene(msg, agents.get(msg.agent_id), background_url=bg_url)
            for msg in messages
        ]

        payload = {
            "video_inputs": scenes,
            "dimension": {"width": 1280, "height": 720},
        }

        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                f"{HEYGEN_API_BASE}/v2/video/generate",
                json=payload,
                headers=self._headers(),
            )
            response.raise_for_status()
            data = response.json()

        video_id: Optional[str] = (data.get("data") or {}).get("video_id")
        if not video_id:
            raise RuntimeError(
                f"HeyGen did not return a video_id. Response: {data}"
            )

        logger.info(f"HeyGen video submitted: video_id={video_id} debate={debate.id}")
        return video_id

    async def get_status(self, provider_video_id: str) -> Dict[str, Any]:
        """Poll HeyGen for the current status of a video job."""
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                f"{HEYGEN_API_BASE}/v1/video_status.get",
                params={"video_id": provider_video_id},
                headers=self._headers(),
            )
            response.raise_for_status()
            data = response.json()

        inner = data.get("data") or {}
        heygen_status: str = (inner.get("status") or "").lower()

        # Map HeyGen status → our internal status
        if heygen_status == "completed":
            return {
                "status": "completed",
                "video_url": inner.get("video_url"),
                "thumbnail_url": inner.get("thumbnail_url"),
                "error": None,
            }
        elif heygen_status in ("failed", "error"):
            return {
                "status": "failed",
                "video_url": None,
                "thumbnail_url": None,
                "error": inner.get("error") or "HeyGen reported failure",
            }
        else:
            # "pending", "processing", "waiting", etc.
            return {
                "status": "processing",
                "video_url": None,
                "thumbnail_url": None,
                "error": None,
            }
