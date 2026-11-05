import re
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlmodel import Session, select

from ..auth import current_user
from ..db import MedLog, Medication, User, as_utc, get_session, now

router = APIRouter(prefix="/api/meds", tags=["medications"])
_TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


class MedIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    dose: str = Field(default="", max_length=60)
    times: list[str] = Field(default_factory=lambda: ["08:00"], max_length=12)
    notes: str = Field(default="", max_length=300)
    active: bool = True
    stock: float | None = Field(default=None, ge=0, le=10000)      # pills left (optional, enables refill reminders)
    per_dose: float | None = Field(default=None, gt=0, le=50)       # pills per dose (default 1)
    refill_days: int | None = Field(default=None, ge=1, le=60)      # warn this many days before running out (default 5)

    @field_validator("times")
    @classmethod
    def valid_times(cls, v: list[str]) -> list[str]:
        for t in v:
            if not _TIME.match(t):
                raise ValueError("ساعت باید به شکل HH:MM باشد")
        return sorted(set(v))


class LogIn(BaseModel):
    status: str = Field(default="taken", pattern="^(taken|skipped)$")


class RefillIn(BaseModel):
    amount: float = Field(gt=0, le=10000)  # pills added (a new box)


def times_of(m: Medication) -> list[str]:
    return [t for t in m.times.split(",") if t]


def active_days(m: Medication, days: int) -> int:
    """Days (out of the last `days`) the medicine was on the list; a medicine added today counts 1 day."""
    return max(1, min(days, (now() - as_utc(m.created_at)).days + 1))


def refill_status(m: Medication) -> dict | None:
    """Days of medicine left and whether to remind the user to refill. None when stock is not tracked."""
    if m.stock is None:
        return None
    per_day = (m.per_dose or 1) * max(1, len(times_of(m)))
    days_left = int(m.stock // per_day)
    warn_at = m.refill_days or 5
    return {"stock": m.stock, "per_dose": m.per_dose or 1, "days_left": days_left, "refill_days": warn_at,
            "low": m.active and days_left <= warn_at, "empty": m.stock < (m.per_dose or 1)}


def _out(m: Medication, logs: list[MedLog] | None = None) -> dict:
    return {"id": m.id, "name": m.name, "dose": m.dose, "times": times_of(m),
            "notes": m.notes, "active": m.active, "refill": refill_status(m),
            "today": [{"status": l.status, "at": l.created_at} for l in (logs or [])]}


def _get(session: Session, user: User, med_id: int) -> Medication:
    m = session.get(Medication, med_id)
    if not m or m.user_id != user.id:
        raise HTTPException(404, "یافت نشد")
    return m


@router.get("")
def list_meds(user: User = Depends(current_user), session: Session = Depends(get_session)):
    meds = session.exec(select(Medication).where(Medication.user_id == user.id)).all()
    logs = session.exec(select(MedLog).where(MedLog.user_id == user.id,
                                             MedLog.created_at >= now() - timedelta(hours=24))).all()
    return [_out(m, [l for l in logs if l.medication_id == m.id]) for m in meds]


@router.post("")
def add_med(body: MedIn, user: User = Depends(current_user), session: Session = Depends(get_session)):
    m = Medication(user_id=user.id, name=body.name, dose=body.dose, times=",".join(body.times),
                   notes=body.notes, active=body.active, stock=body.stock, per_dose=body.per_dose,
                   refill_days=body.refill_days)
    session.add(m)
    session.commit()
    session.refresh(m)
    return _out(m)


@router.put("/{med_id}")
def update_med(med_id: int, body: MedIn, user: User = Depends(current_user),
               session: Session = Depends(get_session)):
    m = _get(session, user, med_id)
    m.name, m.dose, m.times, m.notes, m.active = body.name, body.dose, ",".join(body.times), body.notes, body.active
    m.stock, m.per_dose, m.refill_days = body.stock, body.per_dose, body.refill_days
    session.add(m)
    session.commit()
    session.refresh(m)
    return _out(m)


@router.delete("/{med_id}")
def delete_med(med_id: int, user: User = Depends(current_user), session: Session = Depends(get_session)):
    m = _get(session, user, med_id)
    for log in session.exec(select(MedLog).where(MedLog.medication_id == m.id)).all():
        session.delete(log)
    session.delete(m)
    session.commit()
    return {"ok": True}


@router.post("/{med_id}/log")
def log_med(med_id: int, body: LogIn, user: User = Depends(current_user), session: Session = Depends(get_session)):
    m = _get(session, user, med_id)
    log = MedLog(user_id=user.id, medication_id=m.id, status=body.status)
    session.add(log)
    if body.status == "taken" and m.stock is not None:
        m.stock = max(0.0, m.stock - (m.per_dose or 1))
        session.add(m)
    session.commit()
    session.refresh(m)
    return {"ok": True, "refill": refill_status(m)}


@router.post("/{med_id}/refill")
def refill(med_id: int, body: RefillIn, user: User = Depends(current_user), session: Session = Depends(get_session)):
    m = _get(session, user, med_id)
    m.stock = (m.stock or 0) + body.amount
    session.add(m)
    session.commit()
    session.refresh(m)
    return _out(m)


@router.get("/adherence")
def adherence(days: int = 7, user: User = Depends(current_user), session: Session = Depends(get_session)):
    meds = session.exec(select(Medication).where(Medication.user_id == user.id, Medication.active)).all()
    expected = sum(len(times_of(m)) * active_days(m, days) for m in meds)
    taken = len(session.exec(select(MedLog).where(MedLog.user_id == user.id, MedLog.status == "taken",
                                                  MedLog.created_at >= now() - timedelta(days=days))).all())
    pct = round(100 * min(taken, expected) / expected) if expected else None
    return {"days": days, "expected": expected, "taken": taken, "percent": pct}
