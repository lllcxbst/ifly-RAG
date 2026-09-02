import time
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.security import anonymize_ip
from app.models import Conversation, Feedback, Message, MessageRole, Product
from app.schemas import ChatRequest, ChatResponse, FeedbackIn, ProductOut
from app.services.rag import answer_question

router = APIRouter(tags=["public"])


@router.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": settings.app_name, "demo_mode": settings.demo_mode}


@router.get("/products", response_model=list[ProductOut])
async def list_products(db: AsyncSession = Depends(get_db)) -> list[Product]:
    return list((await db.scalars(select(Product).where(Product.is_active.is_(True)).order_by(Product.name))).all())


@router.post("/chat", response_model=ChatResponse)
async def chat(payload: ChatRequest, request: Request, db: AsyncSession = Depends(get_db)) -> ChatResponse:
    await _check_rate_limit(request, payload.session_key)
    started = time.perf_counter()
    conversation = (
        (
            await db.execute(
                select(Conversation)
                .where(Conversation.session_key == payload.session_key)
                .order_by(Conversation.created_at.desc())
            )
        )
        .scalars()
        .first()
    )
    if conversation is None:
        conversation = Conversation(
            session_key=payload.session_key,
            product_id=payload.product_id,
            ip_hash=anonymize_ip(request.client.host if request.client else None),
        )
        db.add(conversation)
        await db.flush()
    db.add(Message(conversation_id=conversation.id, role=MessageRole.user, content=payload.question))

    try:
        (
            answer,
            category,
            confidence,
            needs_human,
            citations,
            suggestions,
            contact,
            retrieval_mode,
            retrieval_reason,
            graph_entities,
        ) = await answer_question(db, payload.question, payload.product_id)
    except Exception as exc:
        await db.rollback()
        raise HTTPException(status_code=503, detail="问答服务暂时不可用，请稍后重试") from exc

    latency_ms = int((time.perf_counter() - started) * 1000)
    assistant = Message(
        conversation_id=conversation.id,
        role=MessageRole.assistant,
        content=answer,
        category=category,
        confidence=confidence,
        citations_json=[_jsonable_citation(item) for item in citations],
        latency_ms=latency_ms,
        model="extractive-demo" if settings.demo_mode else settings.llm_model,
        retrieval_mode=retrieval_mode,
    )
    db.add(assistant)
    conversation.escalated = conversation.escalated or needs_human
    await db.commit()
    await db.refresh(assistant)
    return ChatResponse(
        conversation_id=conversation.id,
        message_id=assistant.id,
        answer=answer,
        category=category,
        confidence=confidence,
        needs_human=needs_human,
        support_contact=contact,
        citations=citations,
        suggested_questions=suggestions,
        latency_ms=latency_ms,
        demo_mode=settings.demo_mode,
        retrieval_mode=retrieval_mode,
        retrieval_reason=retrieval_reason,
        graph_entities=graph_entities,
    )


@router.post("/feedback", status_code=204)
async def submit_feedback(payload: FeedbackIn, db: AsyncSession = Depends(get_db)) -> None:
    message = await db.get(Message, payload.message_id)
    if message is None or message.role != MessageRole.assistant:
        raise HTTPException(status_code=404, detail="回答不存在")
    existing = (
        await db.execute(select(Feedback).where(Feedback.message_id == payload.message_id))
    ).scalar_one_or_none()
    if existing:
        existing.helpful, existing.comment = payload.helpful, payload.comment
    else:
        db.add(Feedback(message_id=payload.message_id, helpful=payload.helpful, comment=payload.comment))
    await db.commit()


async def _check_rate_limit(request: Request, session_key: str) -> None:
    redis: Redis | None = getattr(request.app.state, "redis", None)
    if redis is None:
        return
    key = f"rate:chat:{session_key}"
    try:
        count = await redis.incr(key)
        if count == 1:
            await redis.expire(key, 60)
        if count > 20:
            raise HTTPException(status_code=429, detail="请求过于频繁，请稍后再试")
    except HTTPException:
        raise
    except Exception:
        # Redis failure should degrade gracefully instead of taking chat offline.
        return


def _jsonable_citation(value: dict) -> dict:
    return {key: str(item) if isinstance(item, uuid.UUID) else item for key, item in value.items()}
