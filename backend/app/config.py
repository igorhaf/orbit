"""
Application Configuration
Handles all environment variables and settings using Pydantic Settings
"""

from typing import List
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field, validator


class Settings(BaseSettings):
    """
    Application settings loaded from environment variables
    """

    # Application
    app_name: str = Field(default="AI Orchestrator API", alias="APP_NAME")
    environment: str = Field(default="development", alias="ENVIRONMENT")
    debug: bool = Field(default=True, alias="DEBUG")
    version: str = "0.1.0"

    # Server
    host: str = Field(default="0.0.0.0", alias="HOST")
    port: int = Field(default=8000, alias="PORT")

    # Security
    secret_key: str = Field(default="dev-secret-key-change-in-production", alias="SECRET_KEY")
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 30

    # Database
    database_url: str = Field(
        default="postgresql://aiorch:aiorch_dev_password@localhost:5432/ai_orchestrator",
        alias="DATABASE_URL"
    )

    # CORS
    cors_origins: List[str] = Field(
        default=["http://localhost:3000", "http://127.0.0.1:3000"],
        alias="CORS_ORIGINS"
    )

    # AI API Keys
    anthropic_api_key: str = Field(default="", alias="ANTHROPIC_API_KEY")
    openai_api_key: str = Field(default="", alias="OPENAI_API_KEY")
    google_ai_api_key: str = Field(default="", alias="GOOGLE_AI_API_KEY")

    # AI Configuration
    default_prompt_generation_model: str = Field(
        default="claude-sonnet-4-20250514",
        alias="DEFAULT_PROMPT_GENERATION_MODEL"
    )

    # Logging
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")

    # File Storage (Project Analyzer)
    upload_dir: str = Field(default="./storage/uploads", alias="UPLOAD_DIR")
    extraction_dir: str = Field(default="./storage/extractions", alias="EXTRACTION_DIR")
    generated_orchestrators_dir: str = Field(
        default="./storage/generated_orchestrators",
        alias="GENERATED_ORCHESTRATORS_DIR"
    )
    max_upload_size_mb: int = Field(default=100, alias="MAX_UPLOAD_SIZE_MB")
    max_extraction_size_mb: int = Field(default=500, alias="MAX_EXTRACTION_SIZE_MB")

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="allow"
    )

    @validator("cors_origins", pre=True)
    def parse_cors_origins(cls, v) -> List[str]:
        """Parse CORS origins from comma-separated string or list"""
        if isinstance(v, str):
            return [origin.strip() for origin in v.split(",")]
        if isinstance(v, list):
            return v
        return [str(v)]

    @property
    def is_development(self) -> bool:
        """Check if running in development mode"""
        return self.environment.lower() == "development"

    @property
    def is_production(self) -> bool:
        """Check if running in production mode"""
        return self.environment.lower() == "production"


# Global settings instance
settings = Settings()
