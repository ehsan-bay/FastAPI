from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, model_validator
from sqlmodel import Session, select

from ..ai.insights import KINDS, analyze_series, classify, estimated_a1c
from ..auth import current_user
from ..db import Vital, User, get_session, now

router = APIRouter(prefix="/api/vitals", tags=["vitals"])

RANGES = {"bp": (40, 300), "glucose": (10, 1000), "weight": (2, 400), "hr": (20, 250), "spo2": (50, 100)}


class VitalIn(BaseModel):
    kind: str
    value: float
    value2: float | None = None
    note: str = Field(default="", max_length=200)

    @model_validator(mode="after")
    def check(self):
        if self.kind not in KINDS:
            raise ValueError("نوع اندازه‌گیری نامعتبر است")
        lo, hi = RANGES[self.kind]
        if not lo <= self.value <= hi:
            raise ValueError("مقدار خارج از محدوده ممکن است")
        if self.kind == "bp" and not (self.value2 and 20 <= self.value2 <= 200):
            raise ValueError("فشار پایین (دیاستولیک) را وارد کنید")
        return self


def _out(v: Vital) -> dict:
    level, msg = classify(v.kind, v.value, v.value2)
    return {"id": v.id, "kind": v.kind, "value": v.value, "value2": v.value2, "note": v.note,
            "created_at": v.created_at, "level": level, "message": msg}


@router.post("")
def add_vital(body: VitalIn, user: User = Depends(current_user), session: Session = Depends(get_session)):
    v = Vital(user_id=user.id, **body.model_dump())
    session.add(v)
    session.commit()
    session.refresh(v)
    return _out(v)


@router.get("")
def list_vitals(kind: str | None = None, days: int = Query(90, ge=1, le=730),
                user: User = Depends(current_user), session: Session = Depends(get_session)):
    q = select(Vital).where(Vital.user_id == user.id, Vital.created_at >= now() - timedelta(days=days))
    if kind:
        q = q.where(Vital.kind == kind)
    return [_out(v) for v in session.exec(q.order_by(Vital.created_at.desc())).all()]


@router.delete("/{vital_id}")
def delete_vital(vital_id: int, user: User = Depends(current_user), session: Session = Depends(get_session)):
    v = session.get(Vital, vital_id)
    if not v or v.user_id != user.id:
        raise HTTPException(404, "یافت نشد")
    session.delete(v)
    session.commit()
    return {"ok": True}


@router.get("/insights")
def insights(days: int = Query(90, ge=7, le=730), user: User = Depends(current_user),
             session: Session = Depends(get_session)):
    rows = session.exec(select(Vital).where(Vital.user_id == user.id,
                                            Vital.created_at >= now() - timedelta(days=days))
                        .order_by(Vital.created_at)).all()
    out = []
    for kind in KINDS:
        pts = [(r.created_at, r.value) for r in rows if r.kind == kind]
        if pts:
            out.append(analyze_series(kind, pts))
    return out


@router.get("/a1c")
def a1c(days: int = Query(90, ge=14, le=120), user: User = Depends(current_user), session: Session = Depends(get_session)):
    """Estimated HbA1c from the glucose readings of the last `days` days (about 3 months reflects HbA1c)."""
    rows = session.exec(select(Vital).where(Vital.user_id == user.id, Vital.kind == "glucose",
                                            Vital.created_at >= now() - timedelta(days=days))).all()
    return estimated_a1c([(r.created_at, r.value) for r in rows]) | {"period_days": days}
