"""App settings, read from environment variables."""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent  # server/


def _env(name: str, default: str) -> str:
    return os.environ.get(name, default)


class Settings:
    app_name = "Salamat AI"
    secret_key = _env("SECRET_KEY", "change-me-in-production")
    token_days = int(_env("TOKEN_DAYS", "30"))
    data_dir = Path(_env("DATA_DIR", str(BASE_DIR / "data")))
    database_url = _env("DATABASE_URL", "")
    models_dir = Path(_env("MODELS_DIR", str(BASE_DIR / "models")))
    # Built web client (PWA). Served at "/" when it exists.
    static_dir = Path(_env("STATIC_DIR", str(BASE_DIR.parent / "app" / "dist")))
    cors_origins = [o.strip() for o in _env("CORS_ORIGINS", "*").split(",") if o.strip()]
    # Optional small LLM (GGUF file). Empty = rule-based assistant.
    llm_model_path = _env("LLM_MODEL_PATH", "")
    llm_threads = int(_env("LLM_THREADS", "2"))
    max_upload_mb = int(_env("MAX_UPLOAD_MB", "8"))

    def __init__(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        if not self.database_url:
            self.database_url = f"sqlite:///{self.data_dir / 'app.db'}"
        # Hosting providers hand out postgres:// URLs; SQLAlchemy wants the driver name.
        for prefix in ("postgres://", "postgresql://"):
            if self.database_url.startswith(prefix):
                self.database_url = "postgresql+psycopg://" + self.database_url[len(prefix):]
        if not self.llm_model_path:
            default_llm = self.models_dir / "llm" / "model.gguf"
            if default_llm.exists():
                self.llm_model_path = str(default_llm)


settings = Settings()
