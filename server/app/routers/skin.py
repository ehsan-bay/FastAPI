import json

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from sqlmodel import Session, select

from ..ai.images import BadImage
from ..ai.skin import skin_model
from ..auth import current_user
from ..db import SkinCheck, User, get_session
from .deps import read_upload

router = APIRouter(prefix="/api/skin", tags=["skin"])


@router.post("/analyze")
async def analyze_skin(file: UploadFile = File(...), body_part: str = Form(""),
                       user: User = Depends(current_user), session: Session = Depends(get_session)):
    if not skin_model.available():
        raise HTTPException(503, "مدل پوست روی سرور نصب نشده است")
    data = await read_upload(file)
    try:
        result = await run_in_threadpool(skin_model.predict, data)
    except BadImage as exc:
        raise HTTPException(400, str(exc))
    # Only the result is stored, never the photo.
    check = SkinCheck(user_id=user.id, body_part=body_part[:50], top_label=result["predictions"][0]["label"],
                      risk=result["risk"], predictions=json.dumps(result["predictions"], ensure_ascii=False))
    session.add(check)
    session.commit()
    return result | {"id": check.id}


@router.get("/history")
def history(user: User = Depends(current_user), session: Session = Depends(get_session)):
    rows = session.exec(select(SkinCheck).where(SkinCheck.user_id == user.id)
                        .order_by(SkinCheck.created_at.desc()).limit(50)).all()
    return [{"id": r.id, "body_part": r.body_part, "top_label": r.top_label, "risk": r.risk,
             "created_at": r.created_at} for r in rows]
