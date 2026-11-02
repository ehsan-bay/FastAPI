"""Database tables and session helper (SQLite by default, any SQLAlchemy URL works)."""
from datetime import datetime, timezone
from typing import Optional

from sqlmodel import Field, Session, SQLModel, create_engine

from .config import settings


def now() -> datetime:
    return datetime.now(timezone.utc)


def as_utc(dt: datetime) -> datetime:
    """Treat naive datetimes as UTC."""
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    email: str = Field(index=True, unique=True)
    name: str = ""
    password_hash: str
    calorie_goal: int = 2000
    created_at: datetime = Field(default_factory=now)


class Meal(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    food_key: str = ""
    name: str
    servings: float = 1.0
    kcal: float = 0
    protein: float = 0
    carbs: float = 0
    fat: float = 0
    source: str = "manual"  # manual | ai
    created_at: datetime = Field(default_factory=now, index=True)


class Journal(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    text: str
    mood: int = 3  # 1..5 self-reported
    sentiment: float = 0  # -1..1
    emotions: str = "[]"  # json list
    reply: str = ""
    risk: bool = False
    created_at: datetime = Field(default_factory=now, index=True)


class Vital(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    kind: str = Field(index=True)  # bp | glucose | weight | hr | spo2
    value: float
    value2: Optional[float] = None  # diastolic for bp
    note: str = ""
    created_at: datetime = Field(default_factory=now, index=True)


class Medication(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    name: str
    dose: str = ""
    times: str = "08:00"  # comma separated HH:MM
    notes: str = ""
    active: bool = True
    created_at: datetime = Field(default_factory=now)


class MedLog(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    medication_id: int = Field(index=True, foreign_key="medication.id")
    status: str = "taken"  # taken | skipped
    created_at: datetime = Field(default_factory=now, index=True)


class SleepSession(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    started_at: datetime
    ended_at: datetime
    snore_seconds: int = 0
    cough_count: int = 0
    breath_events: int = 0
    noise_seconds: int = 0
    timeline: str = "[]"  # json list of {t, label, score}
    score: int = 0
    created_at: datetime = Field(default_factory=now)


class Workout(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    exercise: str
    reps: int = 0
    duration_sec: int = 0
    form_score: int = 0  # 0..100
    kcal: float = 0
    created_at: datetime = Field(default_factory=now, index=True)


class LabReport(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    raw_text: str = ""
    results: str = "[]"  # json
    summary: str = ""
    created_at: datetime = Field(default_factory=now, index=True)


class SkinCheck(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(index=True, foreign_key="user.id")
    body_part: str = ""
    top_label: str = ""
    risk: str = ""  # low | medium | high
    predictions: str = "[]"
    created_at: datetime = Field(default_factory=now, index=True)


_connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, connect_args=_connect_args)


def init_db() -> None:
    SQLModel.metadata.create_all(engine)


def get_session():
    with Session(engine) as session:
        yield session
