"""Health status of a patient for family members / caregivers: missed doses, dangerous readings, low medicine."""
from datetime import datetime, timedelta, timezone

from sqlmodel import Session, select

from .ai.insights import classify
from .db import MedLog, Medication, User, Vital, as_utc, now
from .jalali import fa_digits
from .routers.meds import refill_status, times_of

GRACE_MIN = 60  # a dose counts as missed this long after its time
VITAL_FA = {"bp": "فشار خون", "glucose": "قند خون", "hr": "ضربان قلب", "spo2": "اکسیژن خون", "weight": "وزن"}


def local_now(tz_offset: int) -> datetime:
    """tz_offset = JS getTimezoneOffset() (minutes, UTC - local). Returns a naive local datetime."""
    return now().replace(tzinfo=None) - timedelta(minutes=tz_offset)


def meds_today(session: Session, user_id: int, tz_offset: int) -> list[dict]:
    lnow = local_now(tz_offset)
    midnight_utc = (lnow.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(minutes=tz_offset)).replace(tzinfo=timezone.utc)
    meds = session.exec(select(Medication).where(Medication.user_id == user_id, Medication.active)).all()
    logs = session.exec(select(MedLog).where(MedLog.user_id == user_id, MedLog.created_at >= midnight_utc)).all()
    out = []
    for m in meds:
        times = times_of(m)
        due = [t for t in times if lnow >= lnow.replace(hour=int(t[:2]), minute=int(t[3:]), second=0, microsecond=0)
               + timedelta(minutes=GRACE_MIN)]
        mine = [l for l in logs if l.medication_id == m.id]
        taken = sum(1 for l in mine if l.status == "taken")
        missed = max(0, len(due) - len(mine))
        out.append({"id": m.id, "name": m.name, "dose": m.dose, "times": times, "taken": taken, "planned": len(times),
                    "missed": missed, "missed_time": due[-1] if missed else None, "refill": refill_status(m)})
    return out


def latest_vitals(session: Session, user_id: int, hours: int = 24 * 30) -> dict:
    rows = session.exec(select(Vital).where(Vital.user_id == user_id, Vital.created_at >= now() - timedelta(hours=hours))
                        .order_by(Vital.created_at.desc())).all()
    out: dict = {}
    for v in rows:
        if v.kind not in out:
            level, msg = classify(v.kind, v.value, v.value2)
            out[v.kind] = {"value": v.value, "value2": v.value2, "level": level, "message": msg, "at": as_utc(v.created_at)}
    return out


def alerts(session: Session, patient: User, tz_offset: int) -> list[dict]:
    """Things a caregiver should know now. Each alert has a stable `key` so the app notifies only once."""
    day = local_now(tz_offset).strftime("%Y-%m-%d")
    out = []
    for m in meds_today(session, patient.id, tz_offset):
        if m["missed"]:
            out.append({"key": f"miss-{m['id']}-{day}-{m['missed_time']}", "level": "warn", "kind": "missed_dose",
                        "text": f"داروی {m['name']} (نوبت ساعت {fa_digits(m['missed_time'])}) هنوز مصرف نشده است."})
        r = m["refill"]
        if r and r["low"]:
            out.append({"key": f"refill-{m['id']}-{day}", "level": "warn" if r["days_left"] > 1 else "danger", "kind": "refill",
                        "text": f"داروی {m['name']} حدود {fa_digits(r['days_left'])} روز دیگر تمام می‌شود."})
    recent = session.exec(select(Vital).where(Vital.user_id == patient.id, Vital.created_at >= now() - timedelta(hours=48))
                          .order_by(Vital.created_at.desc())).all()
    seen = set()
    for v in recent:
        if v.kind in seen:
            continue
        seen.add(v.kind)  # only the latest reading of each kind matters
        level, msg = classify(v.kind, v.value, v.value2)
        if level == "danger":
            val = f"{v.value:g}/{v.value2:g}" if v.kind == "bp" and v.value2 else f"{v.value:g}"
            out.append({"key": f"vital-{v.id}", "level": "danger", "kind": "vital", "at": as_utc(v.created_at),
                        "text": f"{VITAL_FA.get(v.kind, v.kind)} {fa_digits(val)}: {msg}"})
    return out
