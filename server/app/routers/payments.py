"""Visit payments by the patient: scan the doctor's QR, enter the amount, pay from the wallet."""
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from ..auth import current_user
from ..db import Doctor, Payment, User, WalletTxn, get_session, now
from .. import ipg
from ..wallet import WalletError, get_int, get_setting, pay_doctor_from_wallet

router = APIRouter(prefix="/api", tags=["payments"])


def doctor_by_token(session: Session, token: str) -> Doctor:
    doc = session.exec(select(Doctor).where(Doctor.qr_token == token)).first()
    if not doc or not doc.active:
        raise HTTPException(404, "پزشک پیدا نشد یا غیرفعال است")
    return doc


def ipg_enabled(session: Session) -> bool:
    return get_setting(session, "ipg_enabled") == "1"


@router.get("/pay/doctors/{token}")
def pay_info(token: str, user: User = Depends(current_user), session: Session = Depends(get_session)):
    doc = doctor_by_token(session, token)
    return {"name": doc.name, "specialty": doc.specialty, "fee": doc.fee,
            "wallet_balance": user.wallet_balance or 0, "ipg_enabled": ipg_enabled(session),
            "max_payment": get_int(session, "max_payment")}


class PayIn(BaseModel):
    token: str = Field(min_length=4, max_length=40)
    amount: int = Field(gt=0, le=10_000_000_000)
    method: str = Field(default="wallet", pattern="^(wallet|ipg)$")


def payment_out(p: Payment, doctor: Doctor | None) -> dict:
    return {"id": p.id, "ref": p.ref, "amount": p.amount, "method": p.method, "status": p.status,
            "created_at": p.created_at, "doctor": doctor.name if doctor else "—",
            "specialty": doctor.specialty if doctor else "",
            "gateway_ref": p.gateway_ref, "gateway_rrn": p.gateway_rrn, "message": p.gateway_message,
            "verified": p.verified}


@router.post("/pay")
def pay(body: PayIn, request: Request, user: User = Depends(current_user), session: Session = Depends(get_session)):
    doc = doctor_by_token(session, body.token)
    if body.method == "ipg":
        if not ipg_enabled(session):
            raise HTTPException(400, "پرداخت از درگاه بانکی هنوز فعال نشده است؛ لطفاً با کیف پول پرداخت کنید")
        if body.amount > get_int(session, "max_payment"):
            raise HTTPException(400, "مبلغ بیش از سقف مجاز پرداخت است")
        cfg = ipg.config(session)
        if not cfg.payment_url or not cfg.mid:
            raise HTTPException(503, "تنظیمات درگاه بانکی کامل نیست")
        # The browser posts this form to the gateway; the gateway posts the result to /api/ipg/callback.
        return ipg.start_payment(session, user, doc, body.amount, str(request.base_url))
    try:
        payment, balance = pay_doctor_from_wallet(session, user, doc, body.amount)
    except WalletError as exc:
        raise HTTPException(400, str(exc))
    return payment_out(payment, doc) | {"wallet_balance": balance}


@router.get("/wallet")
def wallet(user: User = Depends(current_user), session: Session = Depends(get_session)):
    txns = session.exec(select(WalletTxn).where(WalletTxn.user_id == user.id)
                        .order_by(WalletTxn.created_at.desc(), WalletTxn.id.desc()).limit(100)).all()
    return {"balance": user.wallet_balance or 0,
            "transactions": [{"id": t.id, "amount": t.amount, "kind": t.kind, "note": t.note,
                              "balance_after": t.balance_after, "created_at": t.created_at} for t in txns]}


@router.get("/payments")
def my_payments(days: int = Query(365, ge=1, le=3650), user: User = Depends(current_user),
                session: Session = Depends(get_session)):
    rows = session.exec(select(Payment, Doctor).join(Doctor, Doctor.id == Payment.doctor_id)
                        .where(Payment.user_id == user.id, Payment.created_at >= now() - timedelta(days=days))
                        .order_by(Payment.created_at.desc())).all()
    items = [payment_out(p, d) for p, d in rows]
    paid = [p for p, _ in rows if p.status == "paid"]
    by_doctor: dict[str, dict] = {}
    for p, d in rows:
        if p.status != "paid":
            continue
        e = by_doctor.setdefault(d.name, {"doctor": d.name, "specialty": d.specialty, "count": 0, "total": 0})
        e["count"] += 1
        e["total"] += p.amount
    return {"items": items, "count": len(paid), "total": sum(p.amount for p in paid),
            "by_doctor": sorted(by_doctor.values(), key=lambda e: e["total"], reverse=True),
            "wallet_balance": user.wallet_balance or 0}


@router.get("/payments/{payment_id}")
def receipt(payment_id: int, user: User = Depends(current_user), session: Session = Depends(get_session)):
    p = session.get(Payment, payment_id)
    if not p or p.user_id != user.id:
        raise HTTPException(404, "یافت نشد")
    return payment_out(p, session.get(Doctor, p.doctor_id))


@router.api_route("/ipg/callback", methods=["GET", "POST"], include_in_schema=False)
async def ipg_callback(request: Request, session: Session = Depends(get_session)):
    """The bank gateway sends the customer back here with the result (form post)."""
    data = dict(request.query_params)
    if request.method == "POST":
        form = await request.form()
        data.update({k: str(v) for k, v in form.items()})
    payment = ipg.handle_callback(session, data)
    target = f"/pay/result/{payment.id}" if payment else "/pay/result/0"
    return RedirectResponse(target, status_code=303)
