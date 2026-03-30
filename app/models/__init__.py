"""Database models for Common Ground application."""

from datetime import datetime
from typing import Optional, List
from sqlalchemy import Column, String, Text, DateTime, ForeignKey, Float, Integer, Boolean, Enum, UniqueConstraint
from sqlalchemy.orm import declarative_base, relationship
from enum import Enum as PyEnum

Base = declarative_base()


class LegislationSource(str, PyEnum):
    """Source of legislation data."""
    CONGRESS_GOV = "congress_gov"
    OPEN_STATES = "open_states"


class LegislationStatus(str, PyEnum):
    """Status of legislation."""
    INTRODUCED = "introduced"
    IN_COMMITTEE = "in_committee"
    PASSED_CHAMBER = "passed_chamber"
    PASSED_BOTH = "passed_both"
    SIGNED_INTO_LAW = "signed_into_law"
    VETOED = "vetoed"
    FAILED = "failed"


class AgentType(str, PyEnum):
    """Type of AI agent."""
    CLAUDE = "claude"
    LOCAL = "local"
    BYO = "byo"  # Bring Your Own AI


class Legislation(Base):
    """Model for bills and legislation."""
    __tablename__ = "legislation"

    id = Column(String, primary_key=True)  # External ID from source
    source = Column(String, nullable=False)  # congress_gov, open_states, etc.
    level = Column(String, nullable=False)  # federal, state
    bill_number = Column(String, nullable=False)
    title = Column(String, nullable=False)
    description = Column(Text)
    full_text = Column(Text)
    sponsor = Column(String)
    sponsor_party = Column(String)   # e.g. "Republican", "Democrat", "Independent"
    sponsor_state = Column(String)   # e.g. "AR", "CA"
    tags = Column(String)            # JSON array e.g. '["Immigration","National Security"]'
    status = Column(String, default=LegislationStatus.INTRODUCED.value)
    introduced_date = Column(DateTime)
    last_updated = Column(DateTime, default=datetime.utcnow)
    external_url = Column(String)

    # AI analysis fields (populated when "Analyze" is clicked)
    plain_title = Column(String)          # short human-friendly name, AI-generated
    summary = Column(Text)
    impact_score = Column(Integer)        # 1-10
    impact_level = Column(String)         # low / medium / high
    bill_type = Column(String)            # substantive / ceremonial / procedural
    supplementary_data = Column(Text)     # JSON — OpenDataPhilly budget/demographics context
    news_links = Column(Text)             # JSON array of {title, url, source}
    times_tracked = Column(Integer, default=0)
    analyzed_at = Column(DateTime)        # NULL = not yet analyzed

    # Relationships
    debates = relationship("Debate", back_populates="legislation", cascade="all, delete-orphan")
    votes = relationship("LegislationVote", back_populates="legislation", cascade="all, delete-orphan")
    perspectives = relationship("BillPerspective", back_populates="legislation", cascade="all, delete-orphan")
    tracked_by = relationship("BillTracking", back_populates="legislation", cascade="all, delete-orphan")

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Agent(Base):
    """Model for AI debate agents."""
    __tablename__ = "agents"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False, unique=True)
    description = Column(Text)
    persona = Column(String)  # e.g., "Progressive Advocate", "Conservative Analyst"
    system_prompt = Column(Text)  # System instruction for the agent
    expertise_areas = Column(String)  # Comma-separated tags
    agent_type = Column(String, default=AgentType.CLAUDE.value)  # claude, local, byo
    model_name = Column(String, default="claude-3-sonnet-20240229")  # For local AI
    api_url = Column(String)  # For BYO AI
    api_key = Column(String)  # For BYO AI (encrypted in production)
    is_active = Column(Boolean, default=True)

    # Video generation avatar/voice (HeyGen or other providers)
    avatar_id = Column(String)   # Provider avatar ID (e.g. HeyGen stock avatar)
    voice_id = Column(String)    # Provider voice ID

    # Personal AI Debator: user who owns this agent (NULL for preset/system agents)
    owner_user_id = Column(String, ForeignKey("users.id"), nullable=True, index=True)

    # Relationships
    debate_messages = relationship("DebateMessage", back_populates="agent")
    ratings_given = relationship("Rating", foreign_keys="Rating.rater_agent_id", back_populates="rater_agent")
    owner = relationship("User", back_populates="personal_agent", foreign_keys=[owner_user_id])
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Debate(Base):
    """Model for debate threads about legislation."""
    __tablename__ = "debates"

    id = Column(String, primary_key=True)
    legislation_id = Column(String, ForeignKey("legislation.id"), nullable=False)
    title = Column(String, nullable=False)
    topic = Column(Text)  # Debate premise/question
    status = Column(String, default="active")  # active, completed, paused
    turn_count = Column(Integer, default=0)
    max_turns = Column(Integer, default=5)
    current_turn_agent_id = Column(String, ForeignKey("agents.id"))
    
    # Research phase
    research_enabled = Column(Boolean, default=True)
    research_data = Column(Text)  # JSON string of research from all agents
    
    # Per-agent settings JSON: {"agent_id": {"conviction": 1-5}, ...}
    participant_settings = Column(Text, nullable=True)

    # Creator (authenticated user who created this debate; NULL for auto-generated)
    created_by_user_id = Column(String, ForeignKey("users.id"), nullable=True, index=True)

    # Sharing and visibility
    is_public = Column(Boolean, default=True)  # Allow public sharing
    share_count = Column(Integer, default=0)  # Track shares
    view_count = Column(Integer, default=0)  # Track views

    # Relationships
    legislation = relationship("Legislation", back_populates="debates")
    created_by = relationship("User", foreign_keys=[created_by_user_id])
    messages = relationship("DebateMessage", back_populates="debate", cascade="all, delete-orphan")
    participating_agents = relationship("Agent", secondary="debate_participants")
    videos = relationship("DebateVideo", back_populates="debate", cascade="all, delete-orphan")
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class DebateMessage(Base):
    """Model for individual messages/arguments in a debate."""
    __tablename__ = "debate_messages"

    id = Column(String, primary_key=True)
    debate_id = Column(String, ForeignKey("debates.id"), nullable=False)
    agent_id = Column(String, ForeignKey("agents.id"), nullable=False)
    turn_number = Column(Integer, nullable=False)
    position = Column(String)  # "pro", "con", "neutral"
    argument = Column(Text, nullable=False)
    citations = Column(Text)  # JSON string of citations
    reasoning_chain = Column(Text)  # Detail of how conclusion was reached
    
    # Research data for this agent
    research_data = Column(Text)  # JSON string of agent's research

    # Complexity variants: {"simple": "...", "moderate": "...", "expert": "..."}
    argument_variants = Column(Text)
    
    # Relationships
    debate = relationship("Debate", back_populates="messages")
    agent = relationship("Agent", back_populates="debate_messages")
    ratings = relationship("Rating", back_populates="message")
    
    created_at = Column(DateTime, default=datetime.utcnow)


class Rating(Base):
    """Model for AI agents rating arguments."""
    __tablename__ = "ratings"

    id = Column(String, primary_key=True)
    message_id = Column(String, ForeignKey("debate_messages.id"), nullable=False)
    rater_agent_id = Column(String, ForeignKey("agents.id"), nullable=False)
    
    # Rating dimensions
    persuasiveness_score = Column(Float)  # 0-10
    logical_soundness_score = Column(Float)  # 0-10
    factual_accuracy_score = Column(Float)  # 0-10
    relevance_score = Column(Float)  # 0-10
    overall_score = Column(Float)  # 0-10
    
    reasoning = Column(Text)  # Why the rater gave these scores
    
    # Relationships
    message = relationship("DebateMessage", back_populates="ratings")
    rater_agent = relationship("Agent", foreign_keys=[rater_agent_id], back_populates="ratings_given")
    
    created_at = Column(DateTime, default=datetime.utcnow)


# Association table for debate participants
from sqlalchemy import Table
from uuid import uuid4

debate_participants = Table(
    "debate_participants",
    Base.metadata,
    Column("debate_id", String, ForeignKey("debates.id")),
    Column("agent_id", String, ForeignKey("agents.id")),
)


class DebateVideo(Base):
    """Model for AI-generated debate videos."""
    __tablename__ = "debate_videos"

    id = Column(String, primary_key=True, default=lambda: f"video_{uuid4().hex[:12]}")
    debate_id = Column(String, ForeignKey("debates.id"), nullable=False, index=True)
    status = Column(String, default="pending")       # pending | processing | completed | failed
    provider = Column(String, nullable=False)         # "heygen", "d-id", etc.
    provider_video_id = Column(String)               # Provider's internal video ID (for polling)
    video_url = Column(String)                       # Final hosted video URL
    thumbnail_url = Column(String)
    duration_seconds = Column(Float)
    error_message = Column(Text)
    celery_task_id = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime)

    # Relationships
    debate = relationship("Debate", back_populates="videos")


class BillPerspective(Base):
    """AI-generated perspective on a bill from one of 17 viewpoints."""
    __tablename__ = "bill_perspectives"

    id = Column(String, primary_key=True)
    bill_id = Column(String, ForeignKey("legislation.id"), nullable=False, index=True)
    perspective_type = Column(String, nullable=False)   # progressive, conservative, etc.
    position = Column(String)                            # support / oppose / neutral / mixed
    key_arguments = Column(Text)                         # JSON array of strings
    concerns = Column(Text)
    assessment = Column(Text)                            # ~50-word summary
    ai_provider = Column(String)                         # ollama / claude / openai
    ai_model = Column(String)
    generated_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("bill_id", "perspective_type", name="uq_perspective_per_bill"),)

    legislation = relationship("Legislation", back_populates="perspectives")


class Councilmember(Base):
    """Philadelphia City Council member."""
    __tablename__ = "councilmembers"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    district = Column(String)
    party = Column(String)
    email = Column(String)
    phone = Column(String)
    photo_url = Column(String)
    bio = Column(Text)
    profile_url = Column(String)
    bills_sponsored = Column(Integer, default=0)
    bills_passed = Column(Integer, default=0)
    legistar_id = Column(Integer, unique=True, nullable=True)
    term_start = Column(Integer, nullable=True)   # Year first took office, e.g. 2012
    updated_at = Column(DateTime, default=datetime.utcnow)


class BillTracking(Base):
    """User tracking (saving) a bill to follow updates."""
    __tablename__ = "bill_tracking"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    bill_id = Column(String, ForeignKey("legislation.id"), nullable=False, index=True)
    tracked_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("user_id", "bill_id", name="uq_tracking_per_user"),)

    user = relationship("User", back_populates="tracked_bills")
    legislation = relationship("Legislation", back_populates="tracked_by")


class Donation(Base):
    """Stripe donation record."""
    __tablename__ = "donations"

    id = Column(String, primary_key=True)
    amount = Column(Float)
    donor_email = Column(String)
    donation_type = Column(String)          # one-time / monthly
    stripe_payment_id = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)


class AggregatedDataCache(Base):
    """Cache for external data (OpenDataPhilly, etc.)."""
    __tablename__ = "aggregated_data_cache"

    id = Column(String, primary_key=True)
    source = Column(String, nullable=False)   # e.g. opendataphilly_budget
    key = Column(String, nullable=False)
    data = Column(Text)                        # JSON
    expires_at = Column(DateTime)

    __table_args__ = (UniqueConstraint("source", "key", name="uq_cache_source_key"),)


class User(Base):
    """Authenticated human user (Google OAuth)."""
    __tablename__ = "users"

    id           = Column(String, primary_key=True)                          # "user_{uuid12}"
    google_id    = Column(String, unique=True, nullable=False, index=True)
    email        = Column(String, unique=True, nullable=False)
    display_name = Column(String)
    avatar_url   = Column(String)                                            # Google profile photo URL
    subscription_tier = Column(String, default="free", nullable=False)      # "free" | "paid" | "dev"
    created_at        = Column(DateTime, default=datetime.utcnow)
    last_login        = Column(DateTime)

    votes          = relationship("LegislationVote", back_populates="user")
    tracked_bills  = relationship("BillTracking", back_populates="user", cascade="all, delete-orphan")
    personal_agent = relationship(
        "Agent",
        back_populates="owner",
        foreign_keys="Agent.owner_user_id",
        uselist=False,
    )


class LegislationVote(Base):
    """Anonymous or authenticated human vote on a piece of legislation.

    Deduplicated per (legislation_id, voter_token).  Clients generate a UUID
    once and store it in localStorage; the server allows one vote per token
    per legislation item (upsert on conflict).  When a user is logged in,
    user_id is also stored for vote history.
    """
    __tablename__ = "legislation_votes"

    id             = Column(String, primary_key=True)
    legislation_id = Column(String, ForeignKey("legislation.id"), nullable=False, index=True)
    debate_id      = Column(String, ForeignKey("debates.id"), nullable=True)   # which debate prompted the vote
    user_id        = Column(String, ForeignKey("users.id"), nullable=True, index=True)
    vote           = Column(String, nullable=False)   # "support" | "oppose" | "neutral"
    voter_token    = Column(String, nullable=False)   # client-generated UUID
    created_at     = Column(DateTime, default=datetime.utcnow)
    updated_at     = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (UniqueConstraint("legislation_id", "voter_token", name="uq_vote_per_voter"),)

    legislation = relationship("Legislation", back_populates="votes")
    user        = relationship("User", back_populates="votes")
