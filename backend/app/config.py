from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="COLLECTIVE_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    COLLECTIVE_ENV: str = "production"
    DATABASE_URL: str = "sqlite+aiosqlite:///config/collective.db"
    CONFIG_DIR: str = "/config"
    DATA_DIR: str = "/data"
    BROWSE_PATHS: str = "/mnt/user"  # comma-separated list of additional browsable roots
    LOG_LEVEL: str = "INFO"
    SCANNER_DEFAULT: Literal["rmlint", "fclones"] = "rmlint"
    SIMILARITY_THRESHOLD: float = 50.0
    SCAN_DEPTH: int = 3
    HOST: str = "0.0.0.0"
    PORT: int = 8080


@lru_cache
def get_settings() -> Settings:
    return Settings()
