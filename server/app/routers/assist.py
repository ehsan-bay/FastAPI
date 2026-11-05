"""Voice logging (speech to text), read-aloud (text to speech) and chest X-ray screening."""
import json

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from ..ai.images import BadImage
from ..ai.speech import read_wav, speaker, transcriber, understand
from ..ai.xray import xray_model
from ..auth import current_user
from ..db import User, XRayCheck, get_session
from .deps import read_upload

router = APIRouter(prefix="/api", tags=["assist"])


@router.post("/voice/transcribe")
async def transcribe(file: UploadFile = File(...), user: User = Depends(current_user)):
    """16 kHz (or any rate) 16-bit WAV up to 30 s -> Persian text + suggested entries to confirm."""
    if not transcriber.available():
        raise HTTPException(503, "تشخیص گفتار روی سرور نصب نشده است")
    data = await read_upload(file)
    try:
        samples, rate = read_wav(data)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    text = await run_in_threadpool(transcriber.transcribe, samples, rate)
    return {"text": text, "items": understand(text)}


class UnderstandIn(BaseModel):
    text: str = Field(min_length=1, max_length=1000)


@router.post("/voice/understand")
def understand_text(body: UnderstandIn, user: User = Depends(current_user)):
    """Re-parse after the user corrects the recognized text."""
    return {"text": body.text, "items": understand(body.text)}


class SpeakIn(BaseModel):
    text: str = Field(min_length=1, max_length=1200)
    speed: float = Field(default=0.9, ge=0.6, le=1.4)


@router.post("/tts")
async def tts(body: SpeakIn, user: User = Depends(current_user)):
    if not speaker.available():
        raise HTTPException(503, "خواندن متن روی سرور نصب نشده است")
    wav = await run_in_threadpool(speaker.wav, body.text, body.speed)
    return Response(wav, media_type="audio/wav", headers={"Cache-Control": "private, max-age=86400"})


@router.post("/xray/analyze")
async def xray(file: UploadFile = File(...), user: User = Depends(current_user), session: Session = Depends(get_session)):
    if not xray_model.available():
        raise HTTPException(503, "مدل رادیولوژی روی سرور نصب نشده است")
    data = await read_upload(file)
    try:
        result = await run_in_threadpool(xray_model.predict, data)
    except BadImage as exc:
        raise HTTPException(400, str(exc))
    check = XRayCheck(user_id=user.id, level=result["level"], flagged=json.dumps(result["flagged"], ensure_ascii=False),
                      findings=json.dumps(result["findings"][:6], ensure_ascii=False))
    session.add(check)
    session.commit()
    return result | {"id": check.id}


@router.get("/xray/history")
def xray_history(user: User = Depends(current_user), session: Session = Depends(get_session)):
    rows = session.exec(select(XRayCheck).where(XRayCheck.user_id == user.id).order_by(XRayCheck.created_at.desc()).limit(30)).all()
    return [{"id": r.id, "level": r.level, "flagged": json.loads(r.flagged), "created_at": r.created_at} for r in rows]
