"""Database models for Common Ground application."""

from datetime import datetime
from typing import Optional, List
from sqlalchemy import Column, String, Text, DateTime, ForeignKey, Float, Integer, Boolean, Enum, UniqueConstraint, Index
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
    headline = Column(String)             # newspaper-style headline, AI-generated
    lede = Column(Text)                   # punchy 1-2 sentence news lede, AI-generated
    summary = Column(Text)
    impact_score = Column(Integer)        # 1-10
    impact_level = Column(String)         # low / medium / high
    bill_type = Column(String)            # substantive / ceremonial / procedural
    supplementary_data = Column(Text)     # JSON — OpenDataPhilly budget/demographics context
    news_links = Column(Text)             # JSON array of {title, url, source}
    times_tracked = Column(Integer, default=0)
    analyzed_at = Column(DateTime)        # NULL = not yet analyzed

    # City this legislation belongs to (used for multi-city support)
    city = Column(String, default='philadelphia')

    # Legislative metadata (populated by detail scrape)
    committee             = Column(String, nullable=True)   # referred-to committee body
    final_date            = Column(DateTime, nullable=True)  # date passed/failed/signed
    co_sponsors           = Column(String, nullable=True)   # JSON array of co-sponsor names
    metadata_fetched_at   = Column(DateTime, nullable=True)  # last time fetch-metadata ran (even if empty)
    news_fetched_at       = Column(DateTime, nullable=True)  # last time news fetch ran (even if no articles found)
    votes_fetched_at      = Column(DateTime, nullable=True)  # last time vote record scrape ran

    # Background worker tracking
    skip_reason           = Column(String, nullable=True)    # set when bill is permanently unfetchable
    worker_retries        = Column(Integer, default=0)       # failed fetch attempts before giving up

    # Upcoming hearing fields (populated by hearings scraper)
    next_hearing_date     = Column(DateTime, nullable=True)
    next_hearing_time     = Column(String, nullable=True)
    next_hearing_body     = Column(String, nullable=True)
    next_hearing_location = Column(String, nullable=True)
    next_hearing_url      = Column(String, nullable=True)

    # Relationships
    votes = relationship("LegislationVote", back_populates="legislation", cascade="all, delete-orphan")
    perspectives = relationship("BillPerspective", back_populates="legislation", cascade="all, delete-orphan")
    tracked_by = relationship("BillTracking", back_populates="legislation", cascade="all, delete-orphan")
    vote_records = relationship("BillVoteRecord", back_populates="legislation", cascade="all, delete-orphan")

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("ix_legislation_level_date", "level", "introduced_date"),
        Index("ix_legislation_status", "status"),
        Index("ix_legislation_impact_level", "impact_level"),
        Index("ix_legislation_bill_type", "bill_type"),
        Index("ix_legislation_city", "city"),
        Index("ix_legislation_analyzed_at", "analyzed_at"),
        Index("ix_legislation_sponsor", "sponsor"),
    )


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

    votes = relationship("CouncilmemberVote", back_populates="councilmember", cascade="all, delete-orphan")
    vote_records = relationship("BillVoteRecord", back_populates="councilmember")


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
    subscription_tier  = Column(String, default="free", nullable=False)      # "free" | "paid" | "dev"
    digest_enabled     = Column(Boolean, default=False, nullable=False)       # weekly email digest opt-in
    digest_frequency   = Column(String, default="weekly", nullable=False)    # "daily" | "weekly" | "never"
    digest_min_impact  = Column(String, default="low", nullable=False)       # "low" | "medium" | "high"
    created_at         = Column(DateTime, default=datetime.utcnow)
    last_login         = Column(DateTime)

    votes          = relationship("LegislationVote", back_populates="user")
    tracked_bills  = relationship("BillTracking", back_populates="user", cascade="all, delete-orphan")


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
    user_id        = Column(String, ForeignKey("users.id"), nullable=True, index=True)
    vote           = Column(String, nullable=False)   # "support" | "oppose" | "neutral"
    voter_token    = Column(String, nullable=False)   # client-generated UUID
    created_at     = Column(DateTime, default=datetime.utcnow)
    updated_at     = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (UniqueConstraint("legislation_id", "voter_token", name="uq_vote_per_voter"),)

    legislation = relationship("Legislation", back_populates="votes")
    user        = relationship("User", back_populates="votes")


class CouncilmemberVote(Base):
    """Anonymous or authenticated citizen approval vote on a council member.

    Deduplicated per (councilmember_id, voter_token).  One vote per token;
    casting again updates the existing record (upsert).
    """
    __tablename__ = "councilmember_votes"

    id                = Column(String, primary_key=True)
    councilmember_id  = Column(String, ForeignKey("councilmembers.id"), nullable=False, index=True)
    user_id           = Column(String, ForeignKey("users.id"), nullable=True, index=True)
    vote              = Column(String, nullable=False)   # "support" | "oppose"
    voter_token       = Column(String, nullable=False)
    created_at        = Column(DateTime, default=datetime.utcnow)
    updated_at        = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (UniqueConstraint("councilmember_id", "voter_token", name="uq_cm_vote_per_voter"),)

    councilmember = relationship("Councilmember", back_populates="votes")


class Candidate(Base):
    """Philadelphia City Council election candidate."""
    __tablename__ = "candidates"

    id              = Column(String, primary_key=True)   # "cand_{uuid12}"
    name            = Column(String, nullable=False)
    district        = Column(String, nullable=False)     # "District 2" | "At-Large"
    party           = Column(String)
    bio             = Column(Text)
    photo_url       = Column(String)
    website_url     = Column(String)
    office_sought   = Column(String)
    election_year   = Column(Integer, nullable=False)
    is_incumbent    = Column(Boolean, default=False)
    known_positions = Column(Text)                       # Free-text notes on stances; used as AI context
    created_at      = Column(DateTime, default=datetime.utcnow)
    updated_at      = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    predictions = relationship("CandidateVotePrediction", back_populates="candidate", cascade="all, delete-orphan")


class CandidateVotePrediction(Base):
    """Cached AI-generated vote prediction for a candidate on a specific bill."""
    __tablename__ = "candidate_vote_predictions"

    id             = Column(String, primary_key=True)
    candidate_id   = Column(String, ForeignKey("candidates.id"), nullable=False, index=True)
    bill_id        = Column(String, ForeignKey("legislation.id"), nullable=False, index=True)
    predicted_vote = Column(String, nullable=False)   # "support" | "oppose" | "uncertain"
    reasoning      = Column(Text)
    ai_provider    = Column(String)
    ai_model       = Column(String)
    generated_at   = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("candidate_id", "bill_id", name="uq_prediction_per_candidate_bill"),)

    candidate   = relationship("Candidate", back_populates="predictions")
    legislation = relationship("Legislation")


class BillVoteRecord(Base):
    """Official roll call vote cast by a Philadelphia City Council member on a bill.

    Populated by fetching Legistar EventItem vote records via the Legistar Web API.
    One row per councilmember per bill vote event.  Deduplicated on (legislation_id,
    voter_name) — only the most recent vote event is kept when a bill is voted on
    multiple times.
    """
    __tablename__ = "bill_vote_records"

    id               = Column(String, primary_key=True)   # "bvr_{uuid12}"
    legislation_id   = Column(String, ForeignKey("legislation.id"), nullable=False, index=True)
    councilmember_id = Column(String, ForeignKey("councilmembers.id"), nullable=True, index=True)
    voter_name       = Column(String, nullable=False)     # raw "Last, First" from Legistar
    vote             = Column(String, nullable=False)     # "Yea" | "Nay" | "Abstain" | "Absent"
    action_date      = Column(DateTime, nullable=True)
    result           = Column(String, nullable=True)      # overall action result, e.g. "Pass"
    created_at       = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("legislation_id", "voter_name", name="uq_vote_record_per_member_bill"),
    )

    legislation    = relationship("Legislation", back_populates="vote_records")
    councilmember  = relationship("Councilmember", back_populates="vote_records")


class BlueskyPost(Base):
    """Registry of Bluesky posts made by the bot.

    One row per post. Used to guarantee the bot never duplicates a bill within
    a given post_type (spotlight, signed, roundup). post_uri / post_cid link
    back to the actual Bluesky record.
    """
    __tablename__ = "bluesky_posts"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    bill_id     = Column(String, ForeignKey("legislation.id"), nullable=True, index=True)
    post_type   = Column(String, nullable=False)   # "spotlight" | "signed" | "roundup"
    posted_at   = Column(DateTime, default=datetime.utcnow, nullable=False)
    post_uri    = Column(String, nullable=True)    # at:// URI from Bluesky
    post_cid    = Column(String, nullable=True)    # content identifier

    __table_args__ = (
        Index("ix_bluesky_posts_bill_type", "bill_id", "post_type"),
        Index("ix_bluesky_posts_posted_at", "posted_at"),
    )
