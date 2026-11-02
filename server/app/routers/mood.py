import json
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from ..ai import mood as mood_ai
from ..ai.llm import fallback_reply, llm
from ..auth import current_user
from ..db import Journal, User, get_session, now

router = APIRouter(prefix="/api", tags=["mind"])


class JournalIn(BaseModel):
    text: str = Field(min_length=1, max_length=5000)
    mood: int = Field(default=3, ge=1, le=5)


class ChatMessage(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(max_length=4000)


class ChatIn(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=30)


@router.post("/journal")
async def add_journal(body: JournalIn, user: User = Depends(current_user), session: Session = Depends(get_session)):
    analysis = mood_ai.analyze(body.text)
    reply = None
    if not analysis["risk"]:
        prompt = (f"این یادداشت روزانه من است (حال کلی {body.mood} از ۵):\n{body.text}\n"
                  "در ۳ جمله کوتاه همدلی کن و یک پیشنهاد عملی بده.")
        reply = await run_in_threadpool(llm.chat, [{"role": "user", "content": prompt}], 200)
    reply = reply or mood_ai.rule_reply(analysis)
    entry = Journal(user_id=user.id, text=body.text, mood=body.mood, sentiment=analysis["sentiment"],
                    emotions=json.dumps(analysis["emotions"], ensure_ascii=False), reply=reply,
                    risk=analysis["risk"])
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return _journal_out(entry)


def _journal_out(j: Journal) -> dict:
    return {"id": j.id, "text": j.text, "mood": j.mood, "sentiment": j.sentiment,
            "emotions": json.loads(j.emotions), "reply": j.reply, "risk": j.risk, "created_at": j.created_at}


@router.get("/journal")
def list_journal(days: int = Query(30, ge=1, le=365), user: User = Depends(current_user),
                 session: Session = Depends(get_session)):
    rows = session.exec(select(Journal).where(Journal.user_id == user.id,
                                              Journal.created_at >= now() - timedelta(days=days))
                        .order_by(Journal.created_at.desc())).all()
    return [_journal_out(r) for r in rows]


@router.delete("/journal/{entry_id}")
def delete_journal(entry_id: int, user: User = Depends(current_user), session: Session = Depends(get_session)):
    j = session.get(Journal, entry_id)
    if not j or j.user_id != user.id:
        raise HTTPException(404, "یافت نشد")
    session.delete(j)
    session.commit()
    return {"ok": True}


@router.post("/assistant/chat")
async def chat(body: ChatIn, user: User = Depends(current_user)):
    msgs = [m.model_dump() for m in body.messages]
    last = msgs[-1]["content"]
    if mood_ai.analyze(last)["risk"]:
        return {"reply": mood_ai.CRISIS_MESSAGE, "engine": "safety"}
    reply = await run_in_threadpool(llm.chat, msgs)
    if reply:
        return {"reply": reply, "engine": "llm"}
    return {"reply": fallback_reply(last), "engine": "rules"}
