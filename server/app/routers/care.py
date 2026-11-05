"""Family / caregiver follow-up. The patient creates an invite code; the caregiver joins with it and then sees
missed doses, dangerous readings and medicine running out. The patient can remove a caregiver at any time."""
import secrets

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlmodel import Session, or_, select

from ..auth import current_user
from ..care import alerts, latest_vitals, meds_today
from ..db import CareLink, User, get_session
from .meds import adherence

router = APIRouter(prefix="/api/care", tags=["care"])
_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O, 1/I


class InviteIn(BaseModel):
    label: str = Field(default="", max_length=40)


class JoinIn(BaseModel):
    code: str = Field(min_length=4, max_length=12)


def _name(u: User | None) -> str:
    return (u.name or u.email) if u else ""


def _new_code(session: Session) -> str:
    while True:
        code = "".join(secrets.choice(_ALPHABET) for _ in range(6))
        if not session.exec(select(CareLink).where(CareLink.code == code)).first():
            return code


def _patient_link(session: Session, me: User, patient_id: int) -> CareLink:
    link = session.exec(select(CareLink).where(CareLink.patient_id == patient_id, CareLink.caregiver_id == me.id,
                                               CareLink.status == "active")).first()
    if not link:
        raise HTTPException(404, "یافت نشد")
    return link


@router.get("")
def overview(tz_offset: int = Query(0, ge=-900, le=900), me: User = Depends(current_user),
             session: Session = Depends(get_session)):
    links = session.exec(select(CareLink).where(or_(CareLink.patient_id == me.id, CareLink.caregiver_id == me.id))).all()
    following, followers = [], []
    for l in links:
        if l.caregiver_id == me.id and l.status == "active":
            p = session.get(User, l.patient_id)
            following.append({"link_id": l.id, "patient_id": p.id, "name": _name(p), "alerts": alerts(session, p, tz_offset)})
        elif l.patient_id == me.id:
            followers.append({"link_id": l.id, "label": l.label, "status": l.status, "created_at": l.created_at,
                              "code": l.code if l.status == "pending" else None,
                              "caregiver": _name(session.get(User, l.caregiver_id)) if l.caregiver_id else None})
    return {"following": following, "followers": followers}


@router.post("/invite")
def invite(body: InviteIn, me: User = Depends(current_user), session: Session = Depends(get_session)):
    pending = session.exec(select(CareLink).where(CareLink.patient_id == me.id, CareLink.status == "pending")).all()
    if len(pending) >= 5:
        raise HTTPException(400, "حداکثر ۵ دعوت در انتظار مجاز است؛ دعوت‌های قبلی را حذف کنید")
    link = CareLink(patient_id=me.id, code=_new_code(session), label=body.label.strip())
    session.add(link)
    session.commit()
    session.refresh(link)
    return {"link_id": link.id, "code": link.code, "label": link.label}


@router.post("/join")
def join(body: JoinIn, me: User = Depends(current_user), session: Session = Depends(get_session)):
    code = body.code.strip().upper().replace(" ", "")
    link = session.exec(select(CareLink).where(CareLink.code == code)).first()
    if not link or link.status != "pending":
        raise HTTPException(404, "کد دعوت معتبر نیست یا قبلاً استفاده شده است")
    if link.patient_id == me.id:
        raise HTTPException(400, "این کد دعوت خودتان است؛ آن را به عضو خانواده بدهید")
    if session.exec(select(CareLink).where(CareLink.patient_id == link.patient_id, CareLink.caregiver_id == me.id,
                                           CareLink.status == "active")).first():
        raise HTTPException(400, "شما همین حالا هم این فرد را دنبال می‌کنید")
    link.caregiver_id, link.status = me.id, "active"
    session.add(link)
    session.commit()
    return {"ok": True, "patient": _name(session.get(User, link.patient_id))}


@router.delete("/{link_id}")
def remove(link_id: int, me: User = Depends(current_user), session: Session = Depends(get_session)):
    link = session.get(CareLink, link_id)
    if not link or me.id not in (link.patient_id, link.caregiver_id):
        raise HTTPException(404, "یافت نشد")
    session.delete(link)
    session.commit()
    return {"ok": True}


@router.get("/alerts")
def all_alerts(tz_offset: int = Query(0, ge=-900, le=900), me: User = Depends(current_user),
               session: Session = Depends(get_session)):
    """Alerts of everyone I follow (the app polls this to show notifications)."""
    links = session.exec(select(CareLink).where(CareLink.caregiver_id == me.id, CareLink.status == "active")).all()
    out = []
    for l in links:
        p = session.get(User, l.patient_id)
        out += [a | {"patient_id": p.id, "patient": _name(p)} for a in alerts(session, p, tz_offset)]
    return out


@router.get("/patient/{patient_id}")
def patient(patient_id: int, tz_offset: int = Query(0, ge=-900, le=900), me: User = Depends(current_user),
            session: Session = Depends(get_session)):
    _patient_link(session, me, patient_id)
    p = session.get(User, patient_id)
    return {"name": _name(p), "alerts": alerts(session, p, tz_offset), "vitals": latest_vitals(session, p.id),
            "meds": meds_today(session, p.id, tz_offset), "adherence": adherence(7, p, session)}
