import json

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from sqlmodel import Session, select

from ..ai.images import BadImage
from ..ai.lab import lab_ocr, parse_text, summarize
from ..auth import current_user
from ..db import LabReport, User, get_session
from .deps import read_upload

router = APIRouter(prefix="/api/lab", tags=["lab"])


@router.post("/analyze")
async def analyze_lab(file: UploadFile | None = File(None), text: str = Form(""),
                      user: User = Depends(current_user), session: Session = Depends(get_session)):
    raw = text.strip()
    if file is not None and file.filename:
        if not lab_ocr.available():
            raise HTTPException(503, "OCR روی سرور نصب نشده است")
        data = await read_upload(file)
        try:
            raw = (await run_in_threadpool(lab_ocr.read, data)) + ("\n" + raw if raw else "")
        except BadImage as exc:
            raise HTTPException(400, str(exc))
    if not raw:
        raise HTTPException(400, "عکس برگه آزمایش یا متن نتایج را بفرستید")
    results = parse_text(raw)
    summary = summarize(results)
    report = LabReport(user_id=user.id, raw_text=raw[:20000],
                       results=json.dumps(results, ensure_ascii=False), summary=summary)
    session.add(report)
    session.commit()
    return {"id": report.id, "text": raw, "results": results, "summary": summary,
            "disclaimer": "محدوده‌های مرجع برای بزرگسالان و عمومی است و ممکن است با آزمایشگاه شما فرق کند."}


@router.get("/history")
def history(user: User = Depends(current_user), session: Session = Depends(get_session)):
    rows = session.exec(select(LabReport).where(LabReport.user_id == user.id)
                        .order_by(LabReport.created_at.desc()).limit(30)).all()
    return [{"id": r.id, "summary": r.summary, "results": json.loads(r.results), "created_at": r.created_at}
            for r in rows]
