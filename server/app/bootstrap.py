"""Startup data: sample doctors, the first admin account and the initial wallet credit."""
import logging
import secrets

from sqlmodel import Session, select

from .auth import hash_password, verify_password
from .config import settings
from .db import Doctor, User, engine
from .wallet import credit, get_int, new_token

log = logging.getLogger("salamat.bootstrap")

SAMPLE_DOCTORS = [
    ("دکتر سارا محمدی", "متخصص قلب و عروق"),
    ("دکتر علی رضایی", "متخصص داخلی"),
    ("دکتر مریم احمدی", "متخصص پوست و مو"),
    ("دکتر حسین کریمی", "پزشک عمومی"),
    ("دکتر نرگس حسینی", "متخصص زنان و زایمان"),
]


def seed_doctors(session: Session) -> None:
    if session.exec(select(Doctor.id)).first() is not None:
        return
    fee = get_int(session, "default_fee")
    for name, specialty in SAMPLE_DOCTORS:
        session.add(Doctor(name=name, specialty=specialty, fee=fee, qr_token=new_token()))
    session.commit()
    log.info("added %d sample doctors", len(SAMPLE_DOCTORS))


def ensure_admin(session: Session) -> None:
    # ADMIN_PASSWORD in the environment is authoritative: changing it and restarting resets the login.
    if settings.admin_password:
        user = session.exec(select(User).where(User.email == settings.admin_email)).first()
        if user is None:
            user = User(email=settings.admin_email, name="مدیر سامانه", password_hash=hash_password(settings.admin_password))
        elif not verify_password(settings.admin_password, user.password_hash):
            user.password_hash = hash_password(settings.admin_password)
        user.is_admin = True
        session.add(user)
        session.commit()
        return
    if session.exec(select(User.id).where(User.is_admin == True)).first() is not None:  # noqa: E712
        return
    user = session.exec(select(User).where(User.email == settings.admin_email)).first()
    password = settings.admin_password
    generated = False
    if user is None:
        if not password:
            password, generated = secrets.token_urlsafe(9), True
        user = User(email=settings.admin_email, name="مدیر سامانه", password_hash=hash_password(password))
    elif password:
        user.password_hash = hash_password(password)
    user.is_admin = True
    session.add(user)
    session.commit()
    if generated:
        note = f"ADMIN LOGIN  email: {settings.admin_email}  password: {password}"
        log.warning(note)
        print(note, flush=True)
        try:
            path = settings.data_dir / "admin-credentials.txt"
            path.write_text(note + "\n", encoding="utf-8")
            path.chmod(0o600)
        except OSError:
            pass
    else:
        log.info("admin account: %s", settings.admin_email)


def backfill_wallets(session: Session) -> None:
    """Users created before wallets existed get the same initial credit as new users."""
    amount = get_int(session, "initial_wallet")
    ids = session.exec(select(User.id).where(User.wallet_balance == None)).all()  # noqa: E711
    for uid in ids:
        credit(session, uid, amount, "initial", "شارژ اولیه کیف پول")
    if ids:
        session.commit()
        log.info("initial wallet credit for %d existing users", len(ids))


def bootstrap() -> None:
    with Session(engine) as session:
        seed_doctors(session)
        ensure_admin(session)
        backfill_wallets(session)
