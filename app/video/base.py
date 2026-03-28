"""Abstract base class for video generation providers."""

from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from app.models import Agent, Debate, DebateMessage


class VideoProvider(ABC):
    """Pluggable interface for AI talking-head video generation.

    Implementations: HeyGenVideoProvider (heygen.py)
    Planned:         DIDVideoProvider, SynthesiaVideoProvider
    """

    @abstractmethod
    async def generate_video(
        self,
        debate: "Debate",
        messages: List["DebateMessage"],
        agents: Dict[str, "Agent"],
    ) -> str:
        """Submit a video generation job.

        Args:
            debate:   The debate ORM object (for title / topic context).
            messages: Ordered list of DebateMessage objects (one scene each).
            agents:   Map of agent_id → Agent for avatar/voice lookup.

        Returns:
            Provider-specific video ID that can be passed to ``get_status()``.
        """

    @abstractmethod
    async def get_status(self, provider_video_id: str) -> Dict[str, Any]:
        """Poll the status of a previously submitted video job.

        Args:
            provider_video_id: ID returned by ``generate_video()``.

        Returns:
            Dict with keys:
              - ``status``:        "processing" | "completed" | "failed"
              - ``video_url``:     Final video URL (present when completed)
              - ``thumbnail_url``: Thumbnail URL (may be None)
              - ``error``:         Error message (present when failed)
        """
