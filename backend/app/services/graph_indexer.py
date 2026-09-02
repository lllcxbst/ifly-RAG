"""Database-aware orchestration for incremental graph indexing."""

from __future__ import annotations

import asyncio
import uuid

import structlog
from app.core.config import settings
from app.core.database import SessionLocal
from app.models import KnowledgeChunk, KnowledgeDocument, KnowledgeStatus
from app.services.graph_rag import graph_rag_service
from sqlalchemy import select

logger = structlog.get_logger()


async def _document_text(document_id: uuid.UUID) -> str:
    async with SessionLocal() as db:
        chunks = list(
            (
                await db.scalars(
                    select(KnowledgeChunk)
                    .where(KnowledgeChunk.document_id == document_id)
                    .order_by(KnowledgeChunk.ordinal)
                )
            ).all()
        )
    return "\n\n".join(f"## {chunk.heading}\n\n{chunk.content}" for chunk in chunks)


async def index_document_graph(
    document_id: uuid.UUID,
    text: str | None = None,
    rebuild: bool = False,
) -> None:
    if not settings.graph_available:
        async with SessionLocal() as db:
            document = await db.get(KnowledgeDocument, document_id)
            if document:
                document.graph_status = "unavailable"
                document.graph_error_message = "知识图谱需要配置大模型密钥"
                await db.commit()
        return

    async with SessionLocal() as db:
        document = await db.get(KnowledgeDocument, document_id)
        if document is None or document.status != KnowledgeStatus.ready:
            return
        product_id, title = document.product_id, document.title
        previous_graph_status = document.graph_status
        document.graph_status = "processing"
        document.graph_error_message = None
        await db.commit()

    source_text = text if text is not None else await _document_text(document_id)
    try:
        # A failed LightRAG insert leaves a document-status record behind. If
        # we do not clear it up front, the first retry is consumed by a
        # "duplicate document" result instead of performing real extraction.
        if rebuild or previous_graph_status in {"failed", "processing"}:
            await graph_rag_service.delete_document(product_id, document_id)
        for attempt in range(1, settings.graph_index_max_attempts + 1):
            try:
                await graph_rag_service.index_document(product_id, document_id, title, source_text)
                break
            except asyncio.CancelledError:
                raise
            except Exception:
                if attempt >= settings.graph_index_max_attempts:
                    raise
                logger.warning(
                    "graph_index_retrying",
                    document_id=str(document_id),
                    product_id=str(product_id),
                    attempt=attempt,
                    max_attempts=settings.graph_index_max_attempts,
                )
                # LightRAG keeps failed document IDs in its status store and a
                # plain re-insert is treated as a duplicate. Remove only this
                # document's failed/partial graph contribution before retrying.
                await graph_rag_service.delete_document(product_id, document_id)
                await asyncio.sleep(min(2 * attempt, 6))
    except Exception as exc:
        logger.exception("graph_index_failed", document_id=str(document_id), product_id=str(product_id))
        async with SessionLocal() as db:
            document = await db.get(KnowledgeDocument, document_id)
            if document:
                document.graph_status = "failed"
                document.graph_error_message = str(exc)[:1000]
                await db.commit()
        return

    async with SessionLocal() as db:
        document = await db.get(KnowledgeDocument, document_id)
        if document:
            document.graph_status = "ready"
            document.graph_error_message = None
            await db.commit()


async def backfill_pending_graphs(product_id: uuid.UUID | None = None, rebuild: bool = False) -> None:
    if not settings.graph_available:
        return
    async with SessionLocal() as db:
        statement = select(KnowledgeDocument.id).where(KnowledgeDocument.status == KnowledgeStatus.ready)
        if product_id:
            statement = statement.where(KnowledgeDocument.product_id == product_id)
        elif not rebuild:
            statement = statement.where(KnowledgeDocument.graph_status != "ready")
        document_ids = list((await db.scalars(statement.order_by(KnowledgeDocument.created_at))).all())
    for document_id in document_ids:
        await index_document_graph(document_id, rebuild=rebuild)
