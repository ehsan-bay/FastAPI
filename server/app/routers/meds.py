import re
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlmodel import Session, select

from ..auth import current_user
from ..db import MedLog, Medication, User, get_session, now

router = APIRouter(prefix="/api/meds", tags=["medications"])
_TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


class MedIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    dose: str = Field(default="", max_length=60)
    times: list[str] = Field(default_factory=lambda: ["08:00"], max_length=12)
    notes: str = Field(default="", max_length=300)
    active: bool = True

    @field_validator("times")
    @classmethod
    def valid_times(cls, v: list[str]) -> list[str]:
        for t in v:
            if not _TIME.match(t):
                raise ValueError("ساعت باید به شکل HH:MM باشد")
        return sorted(set(v))


class LogIn(BaseModel):
    status: str = Field(default="taken", pattern="^(taken|skipped)$")


def _out(m: Medication, logs: list[MedLog] | None = None) -> dict:
    return {"id": m.id, "name": m.name, "dose": m.dose, "times": [t for t in m.times.split(",") if t],
            "notes": m.notes, "active": m.active,
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
                   notes=body.notes, active=body.active)
    session.add(m)
    session.commit()
    session.refresh(m)
    return _out(m)


@router.put("/{med_id}")
def update_med(med_id: int, body: MedIn, user: User = Depends(current_user),
               session: Session = Depends(get_session)):
    m = _get(session, user, med_id)
    m.name, m.dose, m.times, m.notes, m.active = body.name, body.dose, ",".join(body.times), body.notes, body.active
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
    session.commit()
    return {"ok": True}


@router.get("/adherence")
def adherence(days: int = 7, user: User = Depends(current_user), session: Session = Depends(get_session)):
    meds = session.exec(select(Medication).where(Medication.user_id == user.id, Medication.active)).all()
    expected = sum(len([t for t in m.times.split(",") if t]) for m in meds) * days
    taken = len(session.exec(select(MedLog).where(MedLog.user_id == user.id, MedLog.status == "taken",
                                                  MedLog.created_at >= now() - timedelta(days=days))).all())
    pct = round(100 * min(taken, expected) / expected) if expected else None
    return {"days": days, "expected": expected, "taken": taken, "percent": pct}
