"""Health report for the doctor: a print-ready page (save as PDF from the browser) reachable by a signed link
that the patient can share. The link is read-only, expires, and cannot be used to log in."""
import html
import json
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from ..ai.insights import classify, estimated_a1c
from ..auth import current_user
from ..config import settings
from ..db import LabReport, MedLog, Medication, SleepSession, User, Vital, as_utc, get_session, now
from ..jalali import fa_digits, jdate
from .meds import active_days, refill_status, times_of

router = APIRouter(prefix="/api/report", tags=["report"])
PURPOSE = "doctor-report"


class LinkIn(BaseModel):
    days: int = Field(default=30, ge=7, le=180)
    valid_days: int = Field(default=7, ge=1, le=30)
    tz_offset: int = Field(default=0, ge=-900, le=900)


@router.post("/link")
def make_link(body: LinkIn, user: User = Depends(current_user)):
    exp = datetime.now(timezone.utc) + timedelta(days=body.valid_days)
    # "rid" instead of "sub": current_user() needs "sub", so this token can never act as a login.
    token = jwt.encode({"rid": user.id, "days": body.days, "tz": body.tz_offset, "purpose": PURPOSE, "exp": exp},
                       settings.secret_key, algorithm="HS256")
    return {"path": f"/api/report/view?t={token}", "expires_at": exp, "days": body.days}


def _local(dt: datetime, tz: int) -> datetime:
    return as_utc(dt).replace(tzinfo=None) - timedelta(minutes=tz)


def _n(x, d=0) -> str:
    if x is None:
        return "—"
    return fa_digits(f"{x:.{d}f}".replace(".", "٫") if d else f"{round(x):d}")


def _chart(series: list[tuple[str, list[tuple[datetime, float]], str]], lo: float, hi: float,
           bands: list[tuple[float, float, str]] = ()) -> str:
    pts = [t for _, s, _ in series for t, _ in s]
    if len(pts) < 2:
        return '<p class="muted">برای نمودار داده کافی نیست.</p>'
    t0, t1 = min(pts), max(pts)
    span = max(1.0, (t1 - t0).total_seconds())
    W, H, P = 700, 190, 28
    x = lambda t: P + (W - 2 * P) * (t - t0).total_seconds() / span
    y = lambda v: H - P - (H - 2 * P) * (min(hi, max(lo, v)) - lo) / (hi - lo)
    out = [f'<svg viewBox="0 0 {W} {H}" class="chart" role="img" style="direction:ltr">']
    for a, b, color in bands:
        out.append(f'<rect x="{P}" y="{y(b):.1f}" width="{W - 2 * P}" height="{y(a) - y(b):.1f}" fill="{color}"/>')
    for i in range(5):
        v = lo + (hi - lo) * i / 4
        out.append(f'<line x1="{P}" x2="{W - P}" y1="{y(v):.1f}" y2="{y(v):.1f}" stroke="#e3e9e7"/>'
                   f'<text x="{W - P + 4}" y="{y(v) + 4:.1f}" font-size="10" fill="#7b8b85">{fa_digits(round(v))}</text>')
    for label, s, color in series:
        s = sorted(s)
        if not s:
            continue
        path = " ".join(f"{x(t):.1f},{y(v):.1f}" for t, v in s)
        out.append(f'<polyline fill="none" stroke="{color}" stroke-width="2" points="{path}"/>')
        out += [f'<circle cx="{x(t):.1f}" cy="{y(v):.1f}" r="2.6" fill="{color}"/>' for t, v in s]
    # Persian labels in a left-to-right chart: draw them right-to-left (in RTL, "end" is the left edge).
    out.append(f'<text x="{P}" y="{H - 6}" font-size="10" fill="#7b8b85" direction="rtl" text-anchor="end">{jdate(t0)}</text>'
               f'<text x="{W - P}" y="{H - 6}" font-size="10" fill="#7b8b85" direction="rtl" text-anchor="start">{jdate(t1)}</text></svg>')
    return "".join(out)


@router.get("/view", response_class=HTMLResponse)
def view(t: str = Query(...), session: Session = Depends(get_session)):
    try:
        data = jwt.decode(t, settings.secret_key, algorithms=["HS256"])
        if data.get("purpose") != PURPOSE:
            raise ValueError
    except jwt.ExpiredSignatureError:
        return HTMLResponse(_page("گزارش", '<div class="box warn">اعتبار این لینک تمام شده است. از بیمار بخواهید لینک تازه بفرستد.</div>'), 410)
    except (jwt.PyJWTError, ValueError):
        raise HTTPException(404, "گزارش یافت نشد")
    user = session.get(User, int(data["rid"]))
    if not user:
        raise HTTPException(404, "گزارش یافت نشد")
    return HTMLResponse(render(session, user, int(data.get("days", 30)), int(data.get("tz", 0))),
                        headers={"Cache-Control": "no-store", "X-Robots-Tag": "noindex"})


def render(session: Session, user: User, days: int, tz: int) -> str:
    since = now() - timedelta(days=days)
    vit = session.exec(select(Vital).where(Vital.user_id == user.id, Vital.created_at >= since).order_by(Vital.created_at)).all()
    by = lambda k: [v for v in vit if v.kind == k]
    bp, glu, wt, hr, spo = by("bp"), by("glucose"), by("weight"), by("hr"), by("spo2")
    avg = lambda xs: sum(xs) / len(xs) if xs else None
    sec = []

    # --- summary tiles
    a1c = estimated_a1c([(v.created_at, v.value) for v in glu])
    meds = session.exec(select(Medication).where(Medication.user_id == user.id, Medication.active)).all()
    logs = session.exec(select(MedLog).where(MedLog.user_id == user.id, MedLog.created_at >= since)).all()
    expected = sum(len(times_of(m)) * active_days(m, days) for m in meds)
    taken = sum(1 for l in logs if l.status == "taken")
    adher = round(100 * min(taken, expected) / expected) if expected else None
    sleeps = session.exec(select(SleepSession).where(SleepSession.user_id == user.id, SleepSession.started_at >= since)).all()
    sleep_h = avg([(s.ended_at - s.started_at).total_seconds() / 3600 for s in sleeps])
    danger = [v for v in vit if classify(v.kind, v.value, v.value2)[0] == "danger"]
    tiles = [
        ("میانگین فشار خون", f"{_n(avg([v.value for v in bp]))}/{_n(avg([v.value2 or 0 for v in bp]))}" if bp else "—", f"{_n(len(bp))} اندازه‌گیری"),
        ("میانگین قند خون", _n(avg([v.value for v in glu])), f"{_n(len(glu))} اندازه‌گیری · mg/dL"),
        ("HbA1c تخمینی", _n(a1c.get("value"), 1) + ("٪" if a1c.get("value") else ""), "از قندهای خانگی" if a1c.get("available") else "داده کافی نیست"),
        ("مصرف به‌موقع دارو", (_n(adher) + "٪") if adher is not None else "—", f"{_n(min(taken, expected))} از {_n(expected)} نوبت"),
        ("وزن", f"{_n(wt[-1].value, 1)} کیلوگرم" if wt else "—", (f"تغییر {fa_digits(f'{wt[-1].value - wt[0].value:+.1f}'.replace('.', '٫'))} kg" if len(wt) > 1 else "")),
        ("میانگین خواب", f"{_n(sleep_h, 1)} ساعت" if sleep_h else "—", f"{_n(len(sleeps))} شب"),
        ("ضربان قلب", _n(avg([v.value for v in hr])) if hr else "—", "میانگین در دقیقه"),
        ("اکسیژن خون", (_n(min(v.value for v in spo)) + "٪") if spo else "—", "کمترین مقدار"),
    ]
    sec.append('<div class="tiles">' + "".join(f'<div class="tile"><span>{a}</span><b>{b}</b><small>{c}</small></div>' for a, b, c in tiles) + "</div>")
    if danger:
        sec.append(f'<div class="box danger">{_n(len(danger))} اندازه‌گیری در محدوده خطر در این دوره ثبت شده است (در جدول‌ها قرمز).</div>')

    # --- blood pressure
    if bp:
        loc = lambda v: _local(v.created_at, tz)
        sec.append("<h2>فشار خون</h2>" + _chart([("سیستولیک", [(loc(v), v.value) for v in bp], "#c9302c"),
                                                ("دیاستولیک", [(loc(v), v.value2 or 0) for v in bp], "#2563eb")], 40, 200,
                                               [(90, 130, "#e8f6ee"), (60, 80, "#e8f6ee")]))
        sec.append(_table(["زمان", "فشار", "وضعیت"], [(jdate(loc(v), True), f"{_n(v.value)}/{_n(v.value2)}", v) for v in reversed(bp)][:40]))
    # --- glucose
    if glu:
        loc = lambda v: _local(v.created_at, tz)
        sec.append("<h2>قند خون</h2>" + _chart([("قند", [(loc(v), v.value) for v in glu], "#b45309")], 40, 350, [(70, 140, "#e8f6ee")]))
        if a1c.get("available"):
            sec.append(f'<p>HbA1c تخمینی: <b>{_n(a1c["value"], 1)}٪</b> ({a1c["message"]}) — بر پایه {_n(a1c["readings"])} اندازه‌گیری در {_n(a1c["days"])} روز. جایگزین آزمایش HbA1c نیست.</p>')
        sec.append(_table(["زمان", "قند (mg/dL)", "وضعیت"], [(jdate(loc(v), True), _n(v.value), v) for v in reversed(glu)][:40]))
    # --- other vitals
    other = [v for v in vit if v.kind in ("weight", "hr", "spo2")]
    if other:
        names = {"weight": "وزن (kg)", "hr": "ضربان", "spo2": "اکسیژن (٪)"}
        sec.append("<h2>سایر علائم</h2>" + _table(["زمان", "نوع", "مقدار"], [(jdate(_local(v.created_at, tz), True), names[v.kind], _n(v.value, 1 if v.kind == "weight" else 0)) for v in reversed(other)][:30]))
    # --- medications
    if meds:
        rows = []
        for m in meds:
            mt = [l for l in logs if l.medication_id == m.id and l.status == "taken"]
            exp_m = len(times_of(m)) * active_days(m, days)
            r = refill_status(m)
            rows.append((html.escape(m.name), html.escape(m.dose or "—"), fa_digits("، ".join(times_of(m))),
                         (_n(100 * min(len(mt), exp_m) / exp_m) + "٪") if exp_m else "—", (f"{_n(r['days_left'])} روز" if r else "—")))
        sec.append("<h2>داروها</h2>" + _table(["دارو", "دوز", "ساعت‌ها", "مصرف به‌موقع", "باقی‌مانده"], rows))
    # --- latest lab
    lab = session.exec(select(LabReport).where(LabReport.user_id == user.id, LabReport.created_at >= since)
                       .order_by(LabReport.created_at.desc())).first()
    if lab:
        res = json.loads(lab.results or "[]")
        sec.append(f"<h2>آخرین آزمایش ({jdate(_local(lab.created_at, tz))})</h2>" + _table(
            ["آزمایش", "مقدار", "وضعیت"],
            [(html.escape(r.get("name", "")), f'{fa_digits(r.get("value", ""))} {html.escape(r.get("unit", ""))}',
              {"low": "پایین", "high": "بالا", "normal": "طبیعی"}.get(r.get("status"), "")) for r in res]))
    if not vit and not meds and not lab:
        sec.append('<div class="box">در این دوره داده‌ای ثبت نشده است.</div>')

    end = _local(now(), tz)
    head = (f'<div class="head"><div><h1>گزارش سلامت برای پزشک</h1><p>{html.escape(user.name or user.email)}</p></div>'
            f'<div class="meta">دوره: {jdate(end - timedelta(days=days))} تا {jdate(end)}<br>تهیه‌شده: {jdate(end, True)}</div></div>')
    foot = ('<p class="disc">این گزارش از داده‌هایی که خود بیمار در سلامت‌یار ثبت کرده تهیه شده است؛ اندازه‌گیری‌ها با دستگاه‌های خانگی '
            'انجام شده‌اند و مقدارهای تخمینی (مانند HbA1c) جایگزین آزمایش نیستند. تصمیم بالینی با پزشک است.</p>')
    return _page("گزارش سلامت", head + "".join(sec) + foot, print_button=True)


def _table(cols: list[str], rows: list[tuple]) -> str:
    out = ["<table><thead><tr>" + "".join(f"<th>{c}</th>" for c in cols) + "</tr></thead><tbody>"]
    for r in rows:
        cells = list(r)
        cls = ""
        if cells and isinstance(cells[-1], Vital):
            level, msg = classify(cells[-1].kind, cells[-1].value, cells[-1].value2)
            cls = f' class="{level}"'
            cells[-1] = {"ok": "طبیعی", "warn": "بالاتر از حد مطلوب", "danger": "خطر"}.get(level, level)
        out.append(f"<tr{cls}>" + "".join(f"<td>{c}</td>" for c in cells) + "</tr>")
    return "".join(out) + "</tbody></table>"


def _page(title: str, body: str, print_button: bool = False) -> str:
    btn = ('<div class="bar no-print"><button onclick="window.print()">چاپ / ذخیره PDF</button>'
           '<span class="grow">برای ذخیره PDF در پنجره چاپ، «Save as PDF» را انتخاب کنید.</span>'
           '<button id="bk" onclick="history.back()" style="display:none">بازگشت</button>'
           '<script>if(history.length>1)document.getElementById("bk").style.display="";</script></div>') if print_button else ""
    return f"""<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>{title} — سلامت‌یار</title><style>
@font-face{{font-family:Vazirmatn;src:url(/fonts/vazirmatn-400.woff2) format("woff2");font-weight:400}}
@font-face{{font-family:Vazirmatn;src:url(/fonts/vazirmatn-700.woff2) format("woff2");font-weight:700}}
@page{{size:A4;margin:14mm}}
body{{font-family:Vazirmatn,Tahoma,sans-serif;color:#10201b;margin:0;background:#f3f6f5;font-size:14px;line-height:1.7}}
main{{max-width:820px;margin:0 auto;background:#fff;padding:28px 32px}}
.head{{display:flex;justify-content:space-between;gap:16px;border-bottom:3px solid #0e8f6d;padding-bottom:10px;margin-bottom:14px}}
h1{{font-size:22px;margin:0;color:#0b6e55}} h2{{font-size:16px;margin:22px 0 8px;color:#0b6e55}}
.head p{{margin:2px 0 0;font-weight:700}} .meta{{font-size:12px;color:#5b6f68;text-align:left}}
.tiles{{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}}
.tile{{border:1px solid #dfe8e4;border-radius:10px;padding:8px 10px;display:flex;flex-direction:column}}
.tile span{{font-size:11px;color:#5b6f68}} .tile b{{font-size:18px}} .tile small{{font-size:11px;color:#7b8b85}}
table{{width:100%;border-collapse:collapse;font-size:12.5px}} th,td{{text-align:right;padding:5px 6px;border-bottom:1px solid #e7eeeb}}
th{{background:#f2f7f5;color:#33443f}} tr.danger td{{color:#c9302c;font-weight:700}} tr.warn td{{color:#9a5b00}}
.chart{{width:100%;height:auto;background:#fff}}
.box{{padding:10px 12px;border-radius:10px;background:#eef6f3;margin:12px 0}} .box.danger{{background:#fde7e5;color:#a42521}} .box.warn{{background:#fff3d6}}
.disc{{font-size:11px;color:#6a7b75;margin-top:22px;border-top:1px solid #e3e9e7;padding-top:8px}}
.bar{{position:sticky;top:0;display:flex;gap:12px;align-items:center;padding:10px 32px;background:#0e8f6d;color:#fff;font-size:12px;max-width:820px;margin:0 auto;box-sizing:border-box}}
.bar .grow{{flex:1}} .bar button{{font:inherit;font-weight:700;border:0;border-radius:8px;padding:8px 14px;background:#fff;color:#0b6e55;cursor:pointer}}
@media (max-width:640px){{.tiles{{grid-template-columns:repeat(2,1fr)}} main{{padding:18px}} .head{{flex-direction:column}} .meta{{text-align:right}}}}
@media print{{body{{background:#fff}} main{{padding:0;max-width:none}} .no-print{{display:none}} h2{{break-after:avoid}} tr{{break-inside:avoid}}}}
</style></head><body>{btn}<main>{body}</main></body></html>"""
