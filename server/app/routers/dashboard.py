from datetime import timedelta

from fastapi import APIRouter, Depends, Query
from sqlmodel import Session, select

from ..ai.food import food_model
from ..ai.insights import classify
from ..ai.lab import lab_ocr
from ..ai.llm import llm
from ..ai.skin import skin_model
from ..auth import current_user
from ..db import Journal, SleepSession, User, Vital, Workout, get_session, now
from .food import day_totals
from .meds import adherence

router = APIRouter(prefix="/api", tags=["dashboard"])


def local_day_start(tz_offset: int):
    """tz_offset uses JS getTimezoneOffset() convention (minutes, UTC - local). Returns naive UTC."""
    local_now = now() - timedelta(minutes=tz_offset)
    local_midnight = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
    return local_midnight + timedelta(minutes=tz_offset)


@router.get("/dashboard")
def dashboard(tz_offset: int = Query(0, ge=-900, le=900), user: User = Depends(current_user),
              session: Session = Depends(get_session)):
    start = local_day_start(tz_offset)
    nutrition = day_totals(session, user.id, start) | {"goal": user.calorie_goal}

    latest_vitals = {}
    for v in session.exec(select(Vital).where(Vital.user_id == user.id).order_by(Vital.created_at.desc())
                          .limit(200)).all():
        if v.kind not in latest_vitals:
            level, msg = classify(v.kind, v.value, v.value2)
            latest_vitals[v.kind] = {"value": v.value, "value2": v.value2, "at": v.created_at,
                                     "level": level, "message": msg}

    last_sleep = session.exec(select(SleepSession).where(SleepSession.user_id == user.id)
                              .order_by(SleepSession.started_at.desc())).first()
    week = now() - timedelta(days=7)
    moods = session.exec(select(Journal).where(Journal.user_id == user.id, Journal.created_at >= week)).all()
    workouts = session.exec(select(Workout).where(Workout.user_id == user.id, Workout.created_at >= week)).all()
    return {
        "nutrition": nutrition,
        "vitals": latest_vitals,
        "sleep": None if not last_sleep else {
            "score": last_sleep.score,
            "hours": round((last_sleep.ended_at - last_sleep.started_at).total_seconds() / 3600, 1),
            "at": last_sleep.started_at},
        "mood": {"entries": len(moods),
                 "avg": round(sum(m.mood for m in moods) / len(moods), 1) if moods else None},
        "workouts": {"count": len(workouts), "reps": sum(w.reps for w in workouts),
                     "kcal": round(sum(w.kcal for w in workouts), 1)},
        "meds": adherence(7, user, session),
    }


@router.get("/models")
def models_status():
    return {
        "server": {
            "food": food_model.available(),
            "skin": skin_model.available(),
            "lab_ocr": lab_ocr.available(),
            "llm": llm.available(),
            "mood": True,
        },
        "device": ["pose_landmarker_lite.task", "yamnet.tflite"],
    }
