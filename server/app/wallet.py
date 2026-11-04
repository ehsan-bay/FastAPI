"""Wallet and doctor-balance operations. Balances change only through these functions,
and every change is a single atomic UPDATE, so two payments at the same moment can never
spend the same money twice (works the same on SQLite and PostgreSQL)."""
import secrets

from sqlalchemy import func, update
from sqlmodel import Session, select

from .db import AppSetting, Doctor, Payment, User, WalletTxn

DEFAULTS = {
    "default_fee": "50000",        # amount pre-filled on the payment page for new doctors (toman)
    "initial_wallet": "5000000",   # credit every new user gets (toman)
    "ipg_enabled": "0",            # bank gateway: shown but disabled until configured
    "max_payment": "100000000",    # safety limit per payment (toman)
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
