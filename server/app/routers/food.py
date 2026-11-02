from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from ..ai.food import FOODS_BY_KEY, food_model, search_foods
from ..ai.images import BadImage
from ..auth import current_user
from ..db import Meal, User, get_session, now
from .deps import read_upload

router = APIRouter(prefix="/api", tags=["nutrition"])


class MealIn(BaseModel):
    food_key: str = ""
    name: str = Field(default="", max_length=120)
    servings: float = Field(default=1.0, gt=0, le=20)
    kcal: float | None = Field(default=None, ge=0, le=10000)
    protein: float | None = None
    carbs: float | None = None
    fat: float | None = None
    source: str = "manual"


@router.post("/food/analyze")
async def analyze_food(file: UploadFile = File(...), user: User = Depends(current_user)):
    if not food_model.available():
        raise HTTPException(503, "مدل تشخیص غذا روی سرور نصب نشده است")
    data = await read_upload(file)
    try:
        return await run_in_threadpool(food_model.predict, data)
    except BadImage as exc:
        raise HTTPException(400, str(exc))


@router.get("/food/search")
def food_search(q: str = "", limit: int = Query(30, le=100)):
    return search_foods(q, limit)


@router.post("/meals")
def add_meal(body: MealIn, user: User = Depends(current_user), session: Session = Depends(get_session)):
    food = FOODS_BY_KEY.get(body.food_key)
    if not food and body.kcal is None:
        raise HTTPException(400, "غذا را از لیست انتخاب کنید یا کالری را وارد کنید")
    s = body.servings

    def pick(field: str) -> float:
        # Known food: table value x servings. Custom food: the totals the user typed.
        if food:
            return round(float(food[field]) * s, 1)
        return float(getattr(body, field) or 0)

    meal = Meal(
        user_id=user.id,
        food_key=body.food_key,
        name=body.name or (food["fa"] if food else "غذا"),
        servings=s,
        kcal=pick("kcal"),
        protein=pick("protein"),
        carbs=pick("carbs"),
        fat=pick("fat"),
        source=body.source if body.source in ("manual", "ai") else "manual",
    )
    session.add(meal)
    session.commit()
    session.refresh(meal)
    return meal


@router.get("/meals")
def list_meals(days: int = Query(1, ge=1, le=90), user: User = Depends(current_user),
               session: Session = Depends(get_session)):
    since = now() - timedelta(days=days)
    return session.exec(
        select(Meal).where(Meal.user_id == user.id, Meal.created_at >= since).order_by(Meal.created_at.desc())
    ).all()


@router.delete("/meals/{meal_id}")
def delete_meal(meal_id: int, user: User = Depends(current_user), session: Session = Depends(get_session)):
    meal = session.get(Meal, meal_id)
    if not meal or meal.user_id != user.id:
        raise HTTPException(404, "یافت نشد")
    session.delete(meal)
    session.commit()
    return {"ok": True}


def day_totals(session: Session, user_id: int, start: datetime) -> dict:
    meals = session.exec(
        select(Meal).where(Meal.user_id == user_id, Meal.created_at >= start,
                           Meal.created_at < start + timedelta(days=1))
    ).all()
    return {k: round(sum(getattr(m, k) for m in meals), 1) for k in ("kcal", "protein", "carbs", "fat")} | {
        "count": len(meals)}
