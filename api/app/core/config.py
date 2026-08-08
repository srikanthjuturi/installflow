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
    CORS_ORIGINS: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
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
