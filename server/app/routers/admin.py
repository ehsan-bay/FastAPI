"""Admin panel API: doctors (QR), payments, users and wallets, reports, settings."""
from collections import defaultdict
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, update
from sqlmodel import Session, select

from ..auth import admin_user
from ..db import Doctor, DoctorSettlement, Payment, User, WalletTxn, as_utc, get_session, now
from ..wallet import DEFAULTS, WalletError, credit, get_int, get_setting, new_token, set_setting

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(admin_user)])


# --- overview ------------------------------------------------------------------
@router.get("/overview")
def overview(days: int = Query(30, ge=1, le=365), tz_offset: int = Query(0, ge=-900, le=900),
             session: Session = Depends(get_session)):
    since = now() - timedelta(days=days)
    paid = session.exec(select(Payment).where(Payment.status == "paid", Payment.created_at >= since)).all()
    doctors = {d.id: d for d in session.exec(select(Doctor)).all()}
    per_day: dict[str, dict] = defaultdict(lambda: {"count": 0, "total": 0})
    per_doctor: dict[int, dict] = {}
    for p in paid:
        local = as_utc(p.created_at) - timedelta(minutes=tz_offset)
        d = per_day[local.date().isoformat()]
        d["count"] += 1
        d["total"] += p.amount
        e = per_doctor.setdefault(p.doctor_id, {"doctor_id": p.doctor_id, "count": 0, "total": 0,
                                                "doctor": doctors[p.doctor_id].name if p.doctor_id in doctors else "—"})
        e["count"] += 1
        e["total"] += p.amount
    today_key = (now() - timedelta(minutes=tz_offset)).date().isoformat()
    series = []
    for i in range(min(days, 30) - 1, -1, -1):
        key = (now() - timedelta(minutes=tz_offset) - timedelta(days=i)).date().isoformat()
        series.append({"date": key, **per_day.get(key, {"count": 0, "total": 0})})
    return {
        "users": session.exec(select(func.count(User.id))).one(),
        "wallets_total": session.exec(select(func.coalesce(func.sum(User.wallet_balance), 0))).one(),
        "doctors": len(doctors),
        "doctors_active": sum(1 for d in doctors.values() if d.active),
        "owed_to_doctors": sum(d.balance for d in doctors.values()),
        "payments": {"count": len(paid), "total": sum(p.amount for p in paid)},
        "today": per_day.get(today_key, {"count": 0, "total": 0}),
        "series": series,
        "top_doctors": sorted(per_doctor.values(), key=lambda e: e["total"], reverse=True)[:10],
        "days": days,
    }


# --- doctors -------------------------------------------------------------------
class DoctorIn(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    specialty: str = Field(default="", max_length=100)
    fee: int | None = Field(default=None, ge=1000, le=1_000_000_000)
    active: bool = True


class DoctorPatch(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=100)
    specialty: str | None = Field(default=None, max_length=100)
    fee: int | None = Field(default=None, ge=1000, le=1_000_000_000)
    active: bool | None = None


def doctor_out(d: Doctor, stats: dict | None = None) -> dict:
    s = stats or {}
    return {"id": d.id, "name": d.name, "specialty": d.specialty, "fee": d.fee, "active": d.active,
            "balance": d.balance, "qr_token": d.qr_token, "created_at": d.created_at,
            "payments_count": s.get("count", 0), "payments_total": s.get("total", 0)}


def _get_doctor(session: Session, doctor_id: int) -> Doctor:
    d = session.get(Doctor, doctor_id)
    if not d:
        raise HTTPException(404, "پزشک یافت نشد")
    return d


@router.get("/doctors")
def list_doctors(session: Session = Depends(get_session)):
    rows = session.exec(select(Payment.doctor_id, func.count(Payment.id), func.sum(Payment.amount))
                        .where(Payment.status == "paid").group_by(Payment.doctor_id)).all()
    stats = {did: {"count": c, "total": t or 0} for did, c, t in rows}
    return [doctor_out(d, stats.get(d.id)) for d in session.exec(select(Doctor).order_by(Doctor.id)).all()]


@router.post("/doctors")
def create_doctor(body: DoctorIn, session: Session = Depends(get_session)):
    d = Doctor(name=body.name.strip(), specialty=body.specialty.strip(), active=body.active,
               fee=body.fee or get_int(session, "default_fee"), qr_token=new_token())
    session.add(d)
    session.commit()
    session.refresh(d)
    return doctor_out(d)


@router.patch("/doctors/{doctor_id}")
def update_doctor(doctor_id: int, body: DoctorPatch, session: Session = Depends(get_session)):
    d = _get_doctor(session, doctor_id)
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(d, field, value.strip() if isinstance(value, str) else value)
    session.add(d)
    session.commit()
    session.refresh(d)
    return doctor_out(d)


@router.post("/doctors/{doctor_id}/new-qr")
def regenerate_qr(doctor_id: int, session: Session = Depends(get_session)):
    """Old printed QR codes stop working (e.g. if a card was lost)."""
    d = _get_doctor(session, doctor_id)
    d.qr_token = new_token()
    session.add(d)
    session.commit()
    session.refresh(d)
    return doctor_out(d)


class SettleIn(BaseModel):
    amount: int | None = Field(default=None, gt=0)
    note: str = Field(default="", max_length=200)


@router.post("/doctors/{doctor_id}/settle")
def settle(doctor_id: int, body: SettleIn, admin: User = Depends(admin_user), session: Session = Depends(get_session)):
    d = _get_doctor(session, doctor_id)
    amount = body.amount or d.balance
    if amount <= 0:
        raise HTTPException(400, "طلبی برای تسویه وجود ندارد")
    res = session.execute(update(Doctor).where(Doctor.id == d.id, Doctor.balance >= amount)
                          .values(balance=Doctor.balance - amount))
    if res.rowcount != 1:
        session.rollback()
        raise HTTPException(400, "مبلغ تسویه بیشتر از طلب پزشک است")
    session.add(DoctorSettlement(doctor_id=d.id, amount=amount, note=body.note, admin_id=admin.id))
    session.commit()
    session.refresh(d)
    return doctor_out(d)


@router.get("/settlements")
def settlements(doctor_id: int | None = None, session: Session = Depends(get_session)):
    q = select(DoctorSettlement, Doctor).join(Doctor, Doctor.id == DoctorSettlement.doctor_id)
    if doctor_id:
        q = q.where(DoctorSettlement.doctor_id == doctor_id)
    rows = session.exec(q.order_by(DoctorSettlement.created_at.desc()).limit(500)).all()
    return [{"id": s.id, "doctor": d.name, "amount": s.amount, "note": s.note, "created_at": s.created_at}
            for s, d in rows]


# --- payments ------------------------------------------------------------------
@router.get("/payments")
def payments(doctor_id: int | None = None, user_id: int | None = None,
             date_from: datetime | None = Query(None, alias="from"), date_to: datetime | None = Query(None, alias="to"),
             limit: int = Query(500, ge=1, le=5000), session: Session = Depends(get_session)):
    q = (select(Payment, Doctor, User).join(Doctor, Doctor.id == Payment.doctor_id)
         .join(User, User.id == Payment.user_id))
    if doctor_id:
        q = q.where(Payment.doctor_id == doctor_id)
    if user_id:
        q = q.where(Payment.user_id == user_id)
    if date_from:
        q = q.where(Payment.created_at >= as_utc(date_from))
    if date_to:
        q = q.where(Payment.created_at < as_utc(date_to))
    rows = session.exec(q.order_by(Payment.created_at.desc()).limit(limit)).all()
    items = [{"id": p.id, "ref": p.ref, "amount": p.amount, "method": p.method, "status": p.status,
              "created_at": p.created_at, "doctor_id": d.id, "doctor": d.name, "specialty": d.specialty,
              "user_id": u.id, "user": u.name or u.email, "email": u.email} for p, d, u in rows]
    paid = [i for i in items if i["status"] == "paid"]
    return {"items": items, "count": len(paid), "total": sum(i["amount"] for i in paid)}


# --- users and wallets -----------------------------------------------------------
@router.get("/users")
def users(q: str = "", limit: int = Query(200, ge=1, le=2000), session: Session = Depends(get_session)):
    stmt = select(User)
    if q.strip():
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(func.lower(User.email).like(like) | func.lower(User.name).like(like))
    rows = session.exec(stmt.order_by(User.id.desc()).limit(limit)).all()
    counts = dict(session.exec(select(Payment.user_id, func.count(Payment.id)).group_by(Payment.user_id)).all())
    return [{"id": u.id, "email": u.email, "name": u.name, "is_admin": bool(u.is_admin),
             "wallet_balance": u.wallet_balance or 0, "payments": counts.get(u.id, 0), "created_at": u.created_at}
            for u in rows]


class WalletAdjustIn(BaseModel):
    amount: int = Field(description="positive = charge, negative = deduct")
    note: str = Field(default="", max_length=200)


@router.post("/users/{user_id}/wallet")
def adjust_wallet(user_id: int, body: WalletAdjustIn, session: Session = Depends(get_session)):
    if body.amount == 0:
        raise HTTPException(400, "مبلغ نمی‌تواند صفر باشد")
    if not session.get(User, user_id):
        raise HTTPException(404, "کاربر یافت نشد")
    try:
        balance = credit(session, user_id, body.amount, "admin", body.note or "تنظیم توسط مدیر")
    except WalletError as exc:
        session.rollback()
        raise HTTPException(400, str(exc))
    session.commit()
    return {"user_id": user_id, "wallet_balance": balance}


@router.get("/users/{user_id}/transactions")
def user_transactions(user_id: int, session: Session = Depends(get_session)):
    txns = session.exec(select(WalletTxn).where(WalletTxn.user_id == user_id)
                        .order_by(WalletTxn.created_at.desc(), WalletTxn.id.desc()).limit(500)).all()
    return [{"id": t.id, "amount": t.amount, "kind": t.kind, "note": t.note, "balance_after": t.balance_after,
             "created_at": t.created_at} for t in txns]


class RoleIn(BaseModel):
    is_admin: bool


@router.post("/users/{user_id}/role")
def set_role(user_id: int, body: RoleIn, admin: User = Depends(admin_user), session: Session = Depends(get_session)):
    u = session.get(User, user_id)
    if not u:
        raise HTTPException(404, "کاربر یافت نشد")
    if u.id == admin.id and not body.is_admin:
        raise HTTPException(400, "نمی‌توانید دسترسی مدیریت خودتان را بردارید")
    u.is_admin = body.is_admin
    session.add(u)
    session.commit()
    return {"id": u.id, "is_admin": bool(u.is_admin)}


# --- settings ------------------------------------------------------------------
class SettingsIn(BaseModel):
    default_fee: int | None = Field(default=None, ge=1000, le=1_000_000_000)
    initial_wallet: int | None = Field(default=None, ge=0, le=10_000_000_000)
    max_payment: int | None = Field(default=None, ge=1000, le=10_000_000_000)
    apply_fee_to_all: bool = False


@router.get("/settings")
def get_settings(session: Session = Depends(get_session)):
    return {"default_fee": get_int(session, "default_fee"), "initial_wallet": get_int(session, "initial_wallet"),
            "max_payment": get_int(session, "max_payment"), "ipg_enabled": get_setting(session, "ipg_enabled") == "1",
            "ipg_configured": False}


@router.put("/settings")
def put_settings(body: SettingsIn, session: Session = Depends(get_session)):
    for key in ("default_fee", "initial_wallet", "max_payment"):
        value = getattr(body, key)
        if value is not None:
            set_setting(session, key, str(value))
    if body.apply_fee_to_all and body.default_fee:
        session.execute(update(Doctor).values(fee=body.default_fee))
    session.commit()
    return get_settings(session)


assert set(DEFAULTS) >= {"default_fee", "initial_wallet", "ipg_enabled", "max_payment"}
