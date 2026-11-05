"""Wallet and doctor-balance operations. Balances change only through these functions,
and every change is a single atomic UPDATE, so two payments at the same moment can never
spend the same money twice (works the same on SQLite and PostgreSQL)."""
import os
import secrets

from sqlalchemy import func, update
from sqlmodel import Session, select

from .db import AppSetting, Doctor, Payment, User, WalletTxn

DEFAULTS = {
    "default_fee": "50000",        # amount pre-filled on the payment page for new doctors (toman)
    "initial_wallet": "5000000",   # credit every new user gets (toman)
    "max_payment": "100000000",    # safety limit per payment (toman)
    # --- bank gateway (IPG). Every value can be changed later in the admin panel (or via env at first start).
    # Off until the owner confirms the gateway is ready (2026-11-05); switch on in the admin panel.
    "ipg_enabled": os.environ.get("IPG_ENABLED", "0"),
    "ipg_off_applied": "",  # internal marker: the one-time switch-off below has run
    "ipg_payment_url": os.environ.get("IPG_PAYMENT_URL", "http://192.168.141.45:1212/_ipgw_//payment/simple/"),
    "ipg_mid": os.environ.get("IPG_MID", "41642444"),
    # Base URL of the gateway's REST services (merchantLogin, verifyMerchantTrans, reverseTransaction).
    "ipg_rest_url": os.environ.get("IPG_REST_URL", ""),
    "ipg_username": os.environ.get("IPG_USERNAME", ""),
    "ipg_password": os.environ.get("IPG_PASSWORD", ""),
    # Without REST verify settings, accept a gateway "OK" as paid (test only; such payments are flagged "unverified").
    "ipg_allow_unverified": os.environ.get("IPG_ALLOW_UNVERIFIED", "1"),
    "ipg_amount_multiplier": os.environ.get("IPG_AMOUNT_MULTIPLIER", "10"),  # app amounts are toman, gateway wants rial
    "ipg_language": os.environ.get("IPG_LANGUAGE", "fa"),
    # Public address of this site for the gateway's redirectURL; empty = taken from the request.
    "public_url": os.environ.get("PUBLIC_URL", ""),
}


class WalletError(ValueError):
    pass


def get_setting(session: Session, key: str) -> str:
    row = session.get(AppSetting, key)
    return row.value if row else DEFAULTS[key]


def get_int(session: Session, key: str) -> int:
    try:
        return int(get_setting(session, key))
    except ValueError:
        return int(DEFAULTS[key])


def set_setting(session: Session, key: str, value: str) -> None:
    row = session.get(AppSetting, key)
    if row:
        row.value = value
    else:
        row = AppSetting(key=key, value=value)
    session.add(row)


def new_token() -> str:
    return secrets.token_urlsafe(12)


def new_ref() -> str:
    return "SY" + "".join(secrets.choice("0123456789") for _ in range(10))


def credit(session: Session, user_id: int, amount: int, kind: str, note: str = "") -> int:
    """Add (or with a negative amount, remove) money. Returns the new balance. Caller commits."""
    if amount < 0:
        res = session.execute(
            update(User).where(User.id == user_id, User.wallet_balance >= -amount)
            .values(wallet_balance=User.wallet_balance + amount)
        )
        if res.rowcount != 1:
            raise WalletError("موجودی کیف پول کافی نیست")
    else:
        session.execute(
            update(User).where(User.id == user_id)
            .values(wallet_balance=func.coalesce(User.wallet_balance, 0) + amount)
        )
    balance = session.exec(select(User.wallet_balance).where(User.id == user_id)).one()
    session.add(WalletTxn(user_id=user_id, amount=amount, kind=kind, balance_after=balance, note=note))
    return balance


def pay_doctor_from_wallet(session: Session, user: User, doctor: Doctor, amount: int) -> tuple[Payment, int]:
    """Move `amount` from the user's wallet to the doctor's balance in one transaction."""
    if amount <= 0:
        raise WalletError("مبلغ باید بیشتر از صفر باشد")
    if amount > get_int(session, "max_payment"):
        raise WalletError("مبلغ بیش از سقف مجاز پرداخت است")
    res = session.execute(
        update(User).where(User.id == user.id, User.wallet_balance >= amount)
        .values(wallet_balance=User.wallet_balance - amount)
    )
    if res.rowcount != 1:
        session.rollback()
        raise WalletError("موجودی کیف پول کافی نیست")
    session.execute(update(Doctor).where(Doctor.id == doctor.id).values(balance=Doctor.balance + amount))
    payment = Payment(user_id=user.id, doctor_id=doctor.id, amount=amount, method="wallet", status="paid", ref=new_ref())
    session.add(payment)
    session.flush()
    balance = session.exec(select(User.wallet_balance).where(User.id == user.id)).one()
    session.add(WalletTxn(user_id=user.id, amount=-amount, kind="payment", balance_after=balance,
                          payment_id=payment.id, note=f"ویزیت {doctor.name}"))
    session.commit()
    session.refresh(payment)
    return payment, balance
