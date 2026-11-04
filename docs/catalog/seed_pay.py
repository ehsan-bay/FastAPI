"""Demo payments over the last 30 days so reports and charts look like a real clinic."""
import random, sys
from datetime import timedelta
sys.path.insert(0, "/home/user/FastAPI/server")
from sqlmodel import Session, select
from app.auth import hash_password
from app.db import Doctor, Payment, User, WalletTxn, engine, now
from app.wallet import credit, pay_doctor_from_wallet

random.seed(11)
names = ["مهدی", "زهرا", "امیر", "فاطمه", "حمید", "لیلا", "پویا", "نسترن", "کاوه", "مینا", "رضا", "شیوا"]
with Session(engine) as s:
    docs = s.exec(select(Doctor)).all()
    users = []
    for i, n in enumerate(names):
        u = User(email=f"patient{i+1}@example.com", name=n, password_hash=hash_password("demo1234"))
        s.add(u); s.commit(); s.refresh(u)
        credit(s, u.id, 5_000_000, "initial", "شارژ اولیه کیف پول"); s.commit()
        users.append(u)
    demo = s.exec(select(User).where(User.email == "demo@salamatyar.ir")).one()
    weights = [5, 4, 3, 6, 2]
    for d in range(29, -1, -1):
        for _ in range(random.randint(2, 7) if d else 4):
            u = random.choice(users + [demo] * 2)
            doc = random.choices(docs, weights=weights)[0]
            amount = random.choice([50_000, 50_000, 50_000, 80_000, 120_000, 150_000, 200_000])
            s.refresh(u)
            if (u.wallet_balance or 0) < amount:
                continue
            p, _ = pay_doctor_from_wallet(s, u, doc, amount)
            t = (now() - timedelta(days=d)).replace(hour=random.randint(5, 15), minute=random.randint(0, 59))
            p.created_at = t
            for tx in s.exec(select(WalletTxn).where(WalletTxn.payment_id == p.id)).all():
                tx.created_at = t; s.add(tx)
            s.add(p); s.commit()
    # one settlement so the "owed" figure differs from the total
    from app.db import DoctorSettlement
    d0 = docs[3]; s.refresh(d0)
    amt = d0.balance // 2
    d0.balance -= amt; s.add(d0); s.add(DoctorSettlement(doctor_id=d0.id, amount=amt, note="واریز هفتگی")); s.commit()
    print("payments:", len(s.exec(select(Payment)).all()))
