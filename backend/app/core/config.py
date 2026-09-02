from functools import lru_cache
from typing import Annotated, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", case_sensitive=False, extra="ignore")

    app_env: Literal["development", "test", "production"] = "development"
    app_name: str = "航标 · 产品智能客服"
    public_base_url: str = "http://localhost:8080"
    api_prefix: str = "/api/v1"

    database_url: str = "postgresql+asyncpg://support_bot:support_bot@localhost:5432/support_bot"
    redis_url: str = "redis://localhost:6379/0"
    admin_api_key: str = "dev-admin-key"
    secret_key: str = "dev-secret-change-me"

    llm_base_url: str = "https://api.openai.com/v1"
    llm_api_key: str = ""
    llm_model: str = "gpt-4.1-mini"
    embedding_base_url: str = "https://api.openai.com/v1"
    embedding_api_key: str = ""
    embedding_model: str = "text-embedding-3-small"
    embedding_dimensions: int = 1536

    graph_enabled: bool = True
    graph_llm_model: str = "Qwen/Qwen3.5-9B"
    graph_storage_dir: str = "graph_store"
    graph_top_k: int = Field(default=8, ge=2, le=30)
    graph_max_nodes: int = Field(default=180, ge=20, le=1000)
    graph_index_max_attempts: int = Field(default=2, ge=1, le=4)

    rag_top_k: int = Field(default=6, ge=1, le=20)
    rag_min_score: float = Field(default=0.28, ge=0, le=1)
    max_upload_mb: int = Field(default=20, ge=1, le=100)
    cors_origins: Annotated[list[str], NoDecode] = ["http://localhost:5173", "http://localhost:8080"]

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [part.strip() for part in value.split(",") if part.strip()]
        return value

    @property
    def demo_mode(self) -> bool:
        return not bool(self.llm_api_key)

    @property
    def graph_available(self) -> bool:
        return self.graph_enabled and bool(self.llm_api_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
