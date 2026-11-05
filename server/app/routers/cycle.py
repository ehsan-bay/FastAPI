"""Women's health: period log and simple predictions (next period, fertile window). Dates are local days."""
import json
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlmodel import Session, select

from ..auth import current_user
from ..db import CycleEntry, User, get_session

router = APIRouter(prefix="/api/cycle", tags=["cycle"])
SYMPTOMS = {"cramps", "headache", "bloating", "acne", "fatigue", "mood", "back", "breast", "nausea"}
DEFAULT_CYCLE, DEFAULT_PERIOD = 28, 5


def _d(s: str) -> date:
    return date.fromisoformat(s)


class EntryIn(BaseModel):
    start: str
    end: str | None = None
    flow: str = Field(default="", pattern="^(|light|medium|heavy)$")
    symptoms: list[str] = Field(default_factory=list, max_length=12)
    note: str = Field(default="", max_length=300)

    @field_validator("start", "end")
    @classmethod
    def iso(cls, v):
        if v is None:
            return v
        try:
            d = date.fromisoformat(v)
        except ValueError:
            raise ValueError("تاریخ نامعتبر است")
        if d > date.today() + timedelta(days=1):
            raise ValueError("تاریخ آینده قابل ثبت نیست")
        return d.isoformat()

    @field_validator("symptoms")
    @classmethod
    def known(cls, v):
        return [s for s in dict.fromkeys(v) if s in SYMPTOMS]


def _out(e: CycleEntry) -> dict:
    return {"id": e.id, "start": e.start, "end": e.end, "flow": e.flow, "symptoms": json.loads(e.symptoms), "note": e.note}


def predict(entries: list[CycleEntry], today: date) -> dict:
    """Average of the last 6 cycles (21–45 days long) and periods; defaults 28 / 5 days."""
    starts = sorted(_d(e.start) for e in entries)
    gaps = [(b - a).days for a, b in zip(starts, starts[1:]) if 21 <= (b - a).days <= 45][-6:]
    cycle = round(sum(gaps) / len(gaps)) if gaps else DEFAULT_CYCLE
    lens = [(_d(e.end) - _d(e.start)).days + 1 for e in entries if e.end and 1 <= (_d(e.end) - _d(e.start)).days + 1 <= 12][-6:]
    period = round(sum(lens) / len(lens)) if lens else DEFAULT_PERIOD
    out = {"cycle_length": cycle, "period_length": period, "based_on": len(gaps), "regular": None}
    if len(gaps) >= 3:
        out["regular"] = max(gaps) - min(gaps) <= 7
    if not starts:
        return out
    last = starts[-1]
    nxt = last + timedelta(days=cycle)
    while nxt + timedelta(days=period) < today:  # missed logging: roll forward
        nxt += timedelta(days=cycle)
    ovulation = nxt - timedelta(days=14)
    day = (today - last).days + 1
    # In a period: an open entry (no end yet, started up to 10 days ago) or a closed one that covers today.
    in_period = any(_d(e.start) <= today and ((e.end is None and (today - _d(e.start)).days < 10) or
                                              (e.end is not None and today <= _d(e.end))) for e in entries)
    fertile = (ovulation - timedelta(days=5), ovulation + timedelta(days=1))
    phase = "period" if in_period else "fertile" if fertile[0] <= today <= fertile[1] else \
        "luteal" if today > fertile[1] else "follicular"
    out |= {"last_start": last.isoformat(), "cycle_day": day, "next_start": nxt.isoformat(),
            "days_to_next": (nxt - today).days, "ovulation": ovulation.isoformat(),
            "fertile_start": fertile[0].isoformat(), "fertile_end": fertile[1].isoformat(),
            "phase": phase, "late": (today - nxt).days if today > nxt and not in_period else 0, "in_period": in_period}
    return out


@router.get("")
def get_cycle(today: str | None = None, user: User = Depends(current_user), session: Session = Depends(get_session)):
    t = _d(today) if today else date.today()
    entries = session.exec(select(CycleEntry).where(CycleEntry.user_id == user.id).order_by(CycleEntry.start)).all()
    return {"entries": [_out(e) for e in reversed(entries)][:24], "prediction": predict(list(entries), t)}


@router.post("")
def add(body: EntryIn, user: User = Depends(current_user), session: Session = Depends(get_session)):
    if body.end and body.end < body.start:
        raise HTTPException(400, "تاریخ پایان قبل از شروع است")
    clash = session.exec(select(CycleEntry).where(CycleEntry.user_id == user.id, CycleEntry.start == body.start)).first()
    if clash:
        raise HTTPException(400, "برای این روز قبلاً شروع پریود ثبت شده است")
    e = CycleEntry(user_id=user.id, start=body.start, end=body.end, flow=body.flow,
                   symptoms=json.dumps(body.symptoms), note=body.note)
    session.add(e)
    session.commit()
    session.refresh(e)
    return _out(e)


@router.put("/{entry_id}")
def update(entry_id: int, body: EntryIn, user: User = Depends(current_user), session: Session = Depends(get_session)):
    e = session.get(CycleEntry, entry_id)
    if not e or e.user_id != user.id:
        raise HTTPException(404, "یافت نشد")
    if body.end and body.end < body.start:
        raise HTTPException(400, "تاریخ پایان قبل از شروع است")
    e.start, e.end, e.flow, e.symptoms, e.note = body.start, body.end, body.flow, json.dumps(body.symptoms), body.note
    session.add(e)
    session.commit()
    session.refresh(e)
    return _out(e)


@router.delete("/{entry_id}")
def delete(entry_id: int, user: User = Depends(current_user), session: Session = Depends(get_session)):
    e = session.get(CycleEntry, entry_id)
    if not e or e.user_id != user.id:
        raise HTTPException(404, "یافت نشد")
    session.delete(e)
    session.commit()
    return {"ok": True}
