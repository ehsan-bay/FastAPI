import json, random, sys
from datetime import timedelta
sys.path.insert(0, "/home/user/FastAPI/server")
from sqlmodel import Session
from app.auth import hash_password
from app.db import (Journal, Meal, MedLog, Medication, SleepSession, User, Vital, Workout, engine, init_db, now)
from app.ai.food import FOODS_BY_KEY
from app.routers.activity import SleepIn, sleep_score

random.seed(7)
init_db()
N = now()
day = lambda d, h=0, m=0: (N - timedelta(days=d)).replace(hour=h, minute=m, second=0, microsecond=0)
with Session(engine) as s:
    u = User(email="demo@salamatyar.ir", name="سارا", password_hash=hash_password("demo1234"), calorie_goal=1900)
    s.add(u); s.commit(); s.refresh(u)
    today = N.replace(hour=5, minute=0)  # Iran morning ~ 08:30
    for key, sv, h in [("barbari", 1, 4), ("feta", 1, 4), ("walnut", 1, 4), ("tea_sugar", 1, 4), ("ghormeh_sabzi", 1, 9), ("apple", 1, 12), ("yogurt", 1, 9)]:
        f = FOODS_BY_KEY[key]
        s.add(Meal(user_id=u.id, food_key=key, name=f["fa"], servings=sv, kcal=f["kcal"]*sv, protein=f["protein"]*sv,
                   carbs=f["carbs"]*sv, fat=f["fat"]*sv, source="ai" if key in ("ghormeh_sabzi", "apple") else "manual",
                   created_at=N.replace(hour=h, minute=random.randint(0, 50))))
    for d in range(20, -1, -1):
        sys_ = 131 - d * -0.0 - (20 - d) * 0.5 + random.uniform(-3, 3)
        s.add(Vital(user_id=u.id, kind="bp", value=round(sys_), value2=round(sys_ * 0.64 + random.uniform(-2, 2)), created_at=day(d, 4, 10)))
        g = 108 - (20 - d) * 0.6 + random.uniform(-4, 4)
        if d == 9: g = 168
        s.add(Vital(user_id=u.id, kind="glucose", value=round(g), created_at=day(d, 4, 0)))
        if d % 3 == 0:
            s.add(Vital(user_id=u.id, kind="weight", value=round(76.2 - (20 - d) * 0.09 + random.uniform(-0.2, 0.2), 1), created_at=day(d, 3, 30)))
        s.add(Vital(user_id=u.id, kind="hr", value=round(74 - (20 - d) * 0.25 + random.uniform(-3, 3)), created_at=day(d, 4, 5)))
    for d in range(14, 0, -1):
        start = day(d, 19, random.randint(0, 50))  # ~22:30 Tehran
        hrs = random.uniform(6.2, 8.1)
        body = SleepIn(started_at=start, ended_at=start + timedelta(hours=hrs), snore_seconds=random.randint(200, 1500),
                       cough_count=random.randint(0, 4), breath_events=random.choice([0, 0, 1, 2]), noise_seconds=random.randint(30, 400))
        s.add(SleepSession(user_id=u.id, started_at=start, ended_at=start + timedelta(hours=hrs), snore_seconds=body.snore_seconds,
                           cough_count=body.cough_count, breath_events=body.breath_events, noise_seconds=body.noise_seconds, score=sleep_score(body)))
    texts = [(4, "امروز پیاده‌روی کردم و حالم خیلی بهتره"), (3, "کمی خسته‌ام ولی کارها خوب پیش رفت"), (2, "نگران جلسه فردا هستم و استرس دارم"),
             (4, "با دوستام بیرون رفتیم، خوشحالم"), (5, "عالی بود! هدف ورزشی هفته رو انجام دادم"), (3, "روز معمولی بود"),
             (4, "خواب خوبی داشتم و سرحالم"), (2, "سرکار خیلی خسته شدم"), (4, "امروز آرام بودم و مدیتیشن کردم"), (5, "خیلی خوشحالم، نتیجه آزمایشم بهتر شده")]
    for i, (m, t) in enumerate(texts):
        s.add(Journal(user_id=u.id, text=t, mood=m, sentiment=(m - 3) / 2, emotions="[]", reply="", created_at=day(len(texts) - i, 16, 0)))
    for d in range(9, -1, -1):
        for ex, reps in [("squat", random.randint(20, 35)), ("pushup", random.randint(10, 22))][: 1 if d % 2 else 2]:
            s.add(Workout(user_id=u.id, exercise=ex, reps=reps, duration_sec=reps * 3, form_score=random.randint(72, 95),
                          kcal=round(reps * 0.34, 1), created_at=day(d, 14, 0)))
    meds = [Medication(user_id=u.id, name="متفورمین", dose="۵۰۰ میلی‌گرم", times="08:00,20:00"),
            Medication(user_id=u.id, name="ویتامین D", dose="۱۰۰۰ واحد", times="10:00"),
            Medication(user_id=u.id, name="آملودیپین", dose="۵ میلی‌گرم", times="21:00")]
    for m in meds: s.add(m)
    s.commit()
    for m in meds: s.refresh(m)
    for d in range(6, 0, -1):
        for m in meds:
            for _ in m.times.split(","):
                if random.random() < 0.9:
                    s.add(MedLog(user_id=u.id, medication_id=m.id, status="taken", created_at=day(d, 6)))
    s.add(MedLog(user_id=u.id, medication_id=meds[0].id, status="taken", created_at=N.replace(hour=4, minute=40)))
    s.add(MedLog(user_id=u.id, medication_id=meds[1].id, status="taken", created_at=N.replace(hour=6, minute=40)))
    s.commit()
print("seeded")
