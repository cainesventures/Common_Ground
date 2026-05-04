"""Application configuration management."""

from pydantic_settings import BaseSettings
from pydantic import model_validator
from functools import lru_cache


class Settings(BaseSettings):
    """Application settings and environment variables."""

    # Database
    database_url: str = "sqlite:///./common_ground_test.db"

    # API Keys and External Services
    anthropic_api_key: str = ""
    congress_api_key: str = ""

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    # Application
    environment: str = "development"
    debug: bool = False
    log_level: str = "INFO"

    # Server
    host: str = "127.0.0.1"
    port: int = 8000

    # AI Configuration
    default_model: str = "claude-3-5-sonnet-20241022"
    max_debate_turns: int = 5
    temperature: float = 0.7

    # Local AI (Ollama)
    ollama_url: str = "http://localhost:11434"
    ollama_num_gpu_layers: int = 999  # local dev only; 0 = CPU, 999 = all layers on GPU

    # Public base URL for sharing links (set this in production)
    app_base_url: str = "http://localhost:8000"

    # Perspectives AI provider (plug-and-play)
    ai_provider: str = "ollama"              # ollama | claude | openai
    ai_model: str = "llama3"                 # model name for chosen provider
    ai_base_url: str = "http://localhost:11434"  # Ollama default; override for others
    ai_api_key: str = ""                     # blank for Ollama, required for Claude/OpenAI

    # Local / Municipal legislation (Legistar/Granicus)
    legistar_api_key: str = ""  # Optional; required by some cities (e.g. NYC)

    # OpenStates — state legislation
    openstates_api_key: str = ""  # Free tier at https://openstates.org/api/register/

    # Google Gemini
    gemini_api_key: str = ""

    # AI Video Generation (HeyGen)
    heygen_api_key: str = ""
    default_video_provider: str = "heygen"
    # Background image URL shown behind each speaker in generated debate videos.
    # Default: dark podcast-studio look. Override in .env with any public image URL.
    video_background_url: str = "https://images.unsplash.com/photo-1598488035139-bdbb2231ce04?w=1280&q=80"

    # Email (Resend)
    resend_api_key: str = ""                    # Get from resend.com
    email_from: str = "Open Common Ground <hello@opencommonground.com>"
    frontend_base_url: str = "http://localhost:3000"  # Used in email links

    # Stripe Donations
    stripe_secret_key: str = ""                 # sk_live_... or sk_test_...
    stripe_publishable_key: str = ""            # pk_live_... or pk_test_...
    stripe_webhook_secret: str = ""             # whsec_... from Stripe dashboard

    # Google OAuth + JWT
    google_client_id: str = ""
    google_client_secret: str = ""
    jwt_secret: str = "change-me-in-production"  # HS256 signing key
    app_url: str = "http://localhost:8000"        # Base URL for OAuth redirect URI
    frontend_url: str = "http://localhost:3000"   # Next.js frontend (set in production)

    # Sentry error tracking (optional — leave blank to disable)
    sentry_dsn: str = ""

    @model_validator(mode='after')
    def validate_production_secrets(self):
        if self.environment == 'production' and self.jwt_secret == 'change-me-in-production':
            raise ValueError("JWT_SECRET must be changed from default in production")
        return self

    class Config:
        env_file = ".env"
        case_sensitive = False


@lru_cache()
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
