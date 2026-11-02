"""Database tables and session helper (SQLite by default, any SQLAlchemy URL works)."""
import logging
import time
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import inspect, text
from sqlalchemy.exc import OperationalError
from sqlmodel import Field, Session, SQLModel, create_engine

from .config import settings

log = logging.getLogger("salamat.db")


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
    # Set by the app so a retried upload of the same night is not saved twice.
    client_id: Optional[str] = Field(default=None, index=True, max_length=64)
    # True when the night was rebuilt from the phone's checkpoint (app closed before "wake up").
    recovered: Optional[bool] = None
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


_is_sqlite = settings.database_url.startswith("sqlite")
if _is_sqlite:
    engine = create_engine(settings.database_url, connect_args={"check_same_thread": False})
else:
    # Postgres (or any server DB): check connections before use so restarts of the
    # database don't break the app, and keep a small pool for small servers.
    engine = create_engine(settings.database_url, pool_pre_ping=True, pool_size=5, max_overflow=10,
                           pool_recycle=1800)


def add_missing_columns(eng) -> list[str]:
    """Tiny migration step: add new *nullable* model columns to tables that already exist.

    create_all() only creates missing tables, so without this an existing database would
    break when a model gains a field. Larger schema changes should use Alembic.
    """
    insp = inspect(eng)
    existing_tables = set(insp.get_table_names())
    added = []
    for table in SQLModel.metadata.sorted_tables:
        if table.name not in existing_tables:
            continue
        have = {c["name"] for c in insp.get_columns(table.name)}
        for col in table.columns:
            if col.name in have:
                continue
            if not col.nullable:
                log.warning("cannot auto-add NOT NULL column %s.%s", table.name, col.name)
                continue
            ddl = col.type.compile(dialect=eng.dialect)
            prep = eng.dialect.identifier_preparer
            with eng.begin() as conn:
                conn.execute(text(f"ALTER TABLE {prep.quote(table.name)} ADD COLUMN {prep.quote(col.name)} {ddl}"))
                for idx in table.indexes:
                    if [c.name for c in idx.columns] == [col.name]:
                        idx.create(conn, checkfirst=True)
            added.append(f"{table.name}.{col.name}")
            log.info("added column %s.%s", table.name, col.name)
    return added


def init_db(retries: int = 30, delay: float = 2.0) -> None:
    """Create tables and new columns. Waits for the database to come up (docker compose)."""
    for attempt in range(1, retries + 1):
        try:
            SQLModel.metadata.create_all(engine)
            add_missing_columns(engine)
            return
        except OperationalError as exc:
            if attempt == retries:
                raise
            log.warning("database not ready (%s), retry %d/%d", exc.__class__.__name__, attempt, retries)
            time.sleep(delay)


def db_ok() -> bool:
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


def db_kind() -> str:
    return engine.dialect.name


def get_session():
    with Session(engine) as session:
        yield session
