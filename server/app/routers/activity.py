"""Sleep sessions and workouts. The AI for both runs on the device (MediaPipe); the server stores results."""
import json
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, model_validator
from sqlmodel import Session, select

from ..auth import current_user
from ..db import SleepSession, User, Workout, as_utc, get_session, now

router = APIRouter(prefix="/api", tags=["activity"])

# Rough MET-based kcal per rep for a 70 kg adult.
KCAL_PER_REP = {"squat": 0.32, "pushup": 0.36, "jumping_jack": 0.2, "lunge": 0.3, "situp": 0.25}


class SleepIn(BaseModel):
    started_at: datetime
    ended_at: datetime
    snore_seconds: int = Field(default=0, ge=0)
    cough_count: int = Field(default=0, ge=0)
    breath_events: int = Field(default=0, ge=0)
    noise_seconds: int = Field(default=0, ge=0)
    timeline: list[dict] = Field(default_factory=list, max_length=5000)

    @model_validator(mode="after")
    def check(self):
        self.started_at, self.ended_at = as_utc(self.started_at), as_utc(self.ended_at)
        if self.ended_at <= self.started_at:
            raise ValueError("زمان پایان باید بعد از شروع باشد")
        if self.ended_at - self.started_at > timedelta(hours=16):
            raise ValueError("جلسه خواب طولانی‌تر از ۱۶ ساعت است")
        return self


def sleep_score(s: SleepIn) -> int:
    hours = (s.ended_at - s.started_at).total_seconds() / 3600
    score = 100.0
    score -= max(0.0, 7 - hours) * 12 + max(0.0, hours - 9) * 6  # 7-9 h is the target
    total = max(1.0, hours * 3600)
    score -= min(25.0, 100 * s.snore_seconds / total)
    score -= min(15.0, s.cough_count * 1.5)
    score -= min(15.0, s.breath_events * 3)
    score -= min(10.0, 50 * s.noise_seconds / total)
    return int(max(0, min(100, round(score))))


@router.post("/sleep")
def add_sleep(body: SleepIn, user: User = Depends(current_user), session: Session = Depends(get_session)):
    data = body.model_dump()
    data["started_at"] = as_utc(body.started_at)
    data["ended_at"] = as_utc(body.ended_at)
    data["timeline"] = json.dumps(body.timeline[:5000], ensure_ascii=False)
    rec = SleepSession(user_id=user.id, score=sleep_score(body), **data)
    session.add(rec)
    session.commit()
    session.refresh(rec)
    return _sleep_out(rec)


def _sleep_out(s: SleepSession) -> dict:
    hours = (s.ended_at - s.started_at).total_seconds() / 3600
    tips = []
    if hours < 7:
        tips.append("کمتر از ۷ ساعت خوابیدی؛ سعی کن زودتر بخوابی.")
    if s.snore_seconds > 0.1 * hours * 3600:
        tips.append("خروپف زیاد بود. خوابیدن به پهلو و پرهیز از غذای سنگین شب کمک می‌کند.")
    if s.breath_events >= 5:
        tips.append("چند بار صدای قطع یا سختی تنفس ثبت شد. اگر روزها خواب‌آلودی، درباره آپنه خواب با پزشک صحبت کن.")
    if s.cough_count >= 10:
        tips.append("سرفه شبانه زیاد بود. اگر ادامه داشت با پزشک مشورت کن.")
    return {"id": s.id, "started_at": s.started_at, "ended_at": s.ended_at, "hours": round(hours, 2),
            "snore_seconds": s.snore_seconds, "cough_count": s.cough_count, "breath_events": s.breath_events,
            "noise_seconds": s.noise_seconds, "score": s.score, "tips": tips}


@router.get("/sleep")
def list_sleep(days: int = Query(30, ge=1, le=365), user: User = Depends(current_user),
               session: Session = Depends(get_session)):
    rows = session.exec(select(SleepSession).where(SleepSession.user_id == user.id,
                                                   SleepSession.started_at >= now() - timedelta(days=days))
                        .order_by(SleepSession.started_at.desc())).all()
    return [_sleep_out(r) for r in rows]


@router.get("/sleep/{sleep_id}")
def get_sleep(sleep_id: int, user: User = Depends(current_user), session: Session = Depends(get_session)):
    s = session.get(SleepSession, sleep_id)
    if not s or s.user_id != user.id:
        raise HTTPException(404, "یافت نشد")
    return _sleep_out(s) | {"timeline": json.loads(s.timeline)}


class WorkoutIn(BaseModel):
    exercise: str = Field(min_length=1, max_length=40)
    reps: int = Field(default=0, ge=0, le=5000)
    duration_sec: int = Field(default=0, ge=0, le=6 * 3600)
    form_score: int = Field(default=0, ge=0, le=100)


@router.post("/workouts")
def add_workout(body: WorkoutIn, user: User = Depends(current_user), session: Session = Depends(get_session)):
    kcal = round(body.reps * KCAL_PER_REP.get(body.exercise, 0.3) + body.duration_sec / 60 * 1.5, 1)
    w = Workout(user_id=user.id, kcal=kcal, **body.model_dump())
    session.add(w)
    session.commit()
    session.refresh(w)
    return w


@router.get("/workouts")
def list_workouts(days: int = Query(30, ge=1, le=365), user: User = Depends(current_user),
                  session: Session = Depends(get_session)):
    return session.exec(select(Workout).where(Workout.user_id == user.id,
                                              Workout.created_at >= now() - timedelta(days=days))
                        .order_by(Workout.created_at.desc())).all()
