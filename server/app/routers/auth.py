from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from ..auth import create_token, current_user, hash_password, verify_password
from ..db import User, get_session
from ..wallet import credit, get_int

router = APIRouter(prefix="/api/auth", tags=["auth"])


class RegisterIn(BaseModel):
    email: str = Field(min_length=3, max_length=200)
    password: str = Field(min_length=6, max_length=200)
    name: str = Field(default="", max_length=100)


class LoginIn(BaseModel):
    email: str
    password: str


class ProfileIn(BaseModel):
    name: str | None = Field(default=None, max_length=100)
    calorie_goal: int | None = Field(default=None, ge=800, le=6000)


def user_out(u: User) -> dict:
    return {"id": u.id, "email": u.email, "name": u.name, "calorie_goal": u.calorie_goal,
            "is_admin": bool(u.is_admin), "wallet_balance": u.wallet_balance or 0}


@router.post("/register")
def register(body: RegisterIn, session: Session = Depends(get_session)):
    email = body.email.strip().lower()
    if "@" not in email:
        raise HTTPException(400, "ایمیل معتبر نیست")
    if session.exec(select(User).where(User.email == email)).first():
        raise HTTPException(409, "این ایمیل قبلاً ثبت شده است")
    user = User(email=email, name=body.name.strip(), password_hash=hash_password(body.password))
    session.add(user)
    session.commit()
    session.refresh(user)
    credit(session, user.id, get_int(session, "initial_wallet"), "initial", "شارژ اولیه کیف پول")
    session.commit()
    session.refresh(user)
    return {"token": create_token(user.id), "user": user_out(user)}


@router.post("/login")
def login(body: LoginIn, session: Session = Depends(get_session)):
    user = session.exec(select(User).where(User.email == body.email.strip().lower())).first()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "ایمیل یا رمز عبور اشتباه است")
    return {"token": create_token(user.id), "user": user_out(user)}


@router.get("/me")
def me(user: User = Depends(current_user)):
    return user_out(user)


@router.patch("/me")
def update_me(body: ProfileIn, user: User = Depends(current_user), session: Session = Depends(get_session)):
    if body.name is not None:
        user.name = body.name.strip()
    if body.calorie_goal is not None:
        user.calorie_goal = body.calorie_goal
    session.add(user)
    session.commit()
    session.refresh(user)
    return user_out(user)
