"""Application settings, loaded from environment / .env via pydantic-settings."""

from functools import lru_cache
from urllib.parse import quote_plus

from pydantic import computed_field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    # ─── App ───────────────────────────────────────────────────────────────
    ENVIRONMENT: str = "development"
    DEBUG: bool = True
    SQL_ECHO: bool = False
    PROJECT_NAME: str = "Videocon Installation API"
    API_V1_PREFIX: str = "/api/v1"

    # ─── CORS ──────────────────────────────────────────────────────────────
    # Origins allowed to call the API from a browser (the adminWeb dev server).
    # Set CORS_ORIGINS in .env as a JSON array to override.
    # Vite auto-increments its port when one is taken, so allow the usual range.
    CORS_ORIGINS: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
        "http://localhost:5175",
        "http://127.0.0.1:5175",
    ]

    # ─── Database ──────────────────────────────────────────────────────────
    POSTGRES_HOST: str
    POSTGRES_PORT: int = 5432
    POSTGRES_DB: str
    POSTGRES_USER: str
    POSTGRES_PASSWORD: str
    POSTGRES_SSLMODE: str = "require"

    # ─── JWT ───────────────────────────────────────────────────────────────
    JWT_SECRET_KEY: str
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # ─── Superadmin bootstrap (used by app.scripts.bootstrap) ──────────────
    SUPERADMIN_EMAIL: str = "superadmin@videocon.com"
    SUPERADMIN_PASSWORD: str = "ChangeMe_Superadmin@123"
    SUPERADMIN_NAME: str = "Super Admin"

    # ─── WhatsApp Cloud API (partner invites) ──────────────────────────────
    # One platform-level sender for every company, for now.
    WHATSAPP_TOKEN: str = ""
    WHATSAPP_PHONE_NUMBER_ID: str = ""
    WHATSAPP_BUSINESS_ID: str = ""
    WHATSAPP_API_VERSION: str = "v21.0"
    # Empty template name = send plain text, which only reaches someone who
    # messaged the business in the last 24h. Set it once a template is approved.
    WHATSAPP_TEMPLATE_NAME: str = ""
    WHATSAPP_TEMPLATE_LANG: str = "en_US"

    # ─── Partner invites ───────────────────────────────────────────────────
    PARTNER_APP_LINK: str = "https://install.videocon.app/technician"
    INVITE_LINK_BASE: str = "https://install.videocon.app/invite"

    # Path to a CA bundle for outbound HTTPS. Only needed where something
    # intercepts TLS (corporate proxy, or antivirus web-shield on a dev box) and
    # its root is in the OS store but not in certifi's. Empty = normal
    # verification. Never disable verification instead.
    HTTP_CA_BUNDLE: str = ""

    @computed_field  # type: ignore[prop-decorator]
    @property
    def DATABASE_URL(self) -> str:
        """Async SQLAlchemy URL (psycopg 3 driver). Credentials are URL-encoded."""
        return (
            f"postgresql+psycopg://{quote_plus(self.POSTGRES_USER)}:"
            f"{quote_plus(self.POSTGRES_PASSWORD)}@"
            f"{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
            f"?sslmode={self.POSTGRES_SSLMODE}"
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]


settings = get_settings()
