import hashlib
import json
import uuid
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.security import require_admin
from app.models import (
    Conversation,
    EvaluationRun,
    Feedback,
    KnowledgeChunk,
    KnowledgeDocument,
    KnowledgeStatus,
    Message,
    MessageRole,
    Product,
)
from app.schemas import DashboardStats, DocumentOut, KnowledgeGraphOut, ProductCreate, ProductOut
from app.services.chunker import split_text
from app.services.document_parser import extract_text
from app.services.graph_indexer import backfill_pending_graphs, index_document_graph
from app.services.graph_rag import graph_rag_service
from app.services.providers import embedding_provider
from app.services.rag import answer_question

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


@router.post("/products", response_model=ProductOut, status_code=201)
async def create_product(payload: ProductCreate, db: AsyncSession = Depends(get_db)) -> Product:
    if (
        await db.execute(select(Product).where((Product.slug == payload.slug) | (Product.name == payload.name)))
    ).first():
        raise HTTPException(status_code=409, detail="产品名称或标识已存在")
    product = Product(**payload.model_dump())
    db.add(product)
    await db.commit()
    await db.refresh(product)
    return product


@router.get("/documents", response_model=list[DocumentOut])
async def list_documents(
    product_id: uuid.UUID | None = None, db: AsyncSession = Depends(get_db)
) -> list[KnowledgeDocument]:
    statement = select(KnowledgeDocument).order_by(KnowledgeDocument.updated_at.desc())
    if product_id:
        statement = statement.where(KnowledgeDocument.product_id == product_id)
    return list((await db.scalars(statement)).all())


@router.post("/documents", response_model=DocumentOut, status_code=201)
async def upload_document(
    background_tasks: BackgroundTasks,
    product_id: uuid.UUID = Form(),
    title: str = Form(),
    source_type: str = Form(default="document"),
    source_url: str | None = Form(default=None),
    file: UploadFile = File(),
    db: AsyncSession = Depends(get_db),
) -> KnowledgeDocument:
    if await db.get(Product, product_id) is None:
        raise HTTPException(status_code=404, detail="产品不存在")
    data = await file.read(settings.max_upload_mb * 1024 * 1024 + 1)
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"文件不能超过 {settings.max_upload_mb} MB")
    digest = hashlib.sha256(data).hexdigest()
    duplicate = (
        await db.execute(
            select(KnowledgeDocument).where(
                KnowledgeDocument.product_id == product_id, KnowledgeDocument.content_hash == digest
            )
        )
    ).scalar_one_or_none()
    if duplicate:
        raise HTTPException(status_code=409, detail="相同内容已存在，无需重复索引")
    document = KnowledgeDocument(
        product_id=product_id,
        title=title.strip() or file.filename or "未命名文档",
        source_type=source_type,
        source_url=source_url or None,
        original_filename=file.filename,
        content_hash=digest,
    )
    db.add(document)
    await db.flush()
    try:
        text = extract_text(file.filename or "upload.txt", data)
        if len(text) < 20:
            raise ValueError("文档没有可索引的正文；扫描版 PDF 请先进行 OCR")
        await _index_document(db, document, text)
    except ValueError as exc:
        document.status = KnowledgeStatus.failed
        document.error_message = str(exc)
        await db.commit()
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        document.status = KnowledgeStatus.failed
        document.error_message = "索引服务异常"
        await db.commit()
        raise HTTPException(status_code=503, detail="文档索引失败，请检查嵌入模型配置") from exc
    await db.commit()
    await db.refresh(document)
    background_tasks.add_task(index_document_graph, document.id, text)
    return document


@router.delete("/documents/{document_id}", status_code=204)
async def delete_document(document_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> None:
    document = await db.get(KnowledgeDocument, document_id)
    if not document:
        raise HTTPException(status_code=404, detail="文档不存在")
    try:
        await graph_rag_service.delete_document(document.product_id, document.id)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="图谱索引删除失败，请稍后重试") from exc
    await db.delete(document)
    await db.commit()


@router.get("/graph", response_model=KnowledgeGraphOut)
async def get_knowledge_graph(
    product_id: uuid.UUID,
    max_nodes: int = 180,
    db: AsyncSession = Depends(get_db),
) -> KnowledgeGraphOut:
    if await db.get(Product, product_id) is None:
        raise HTTPException(status_code=404, detail="产品不存在")
    max_nodes = max(20, min(max_nodes, settings.graph_max_nodes))
    documents = list(
        (await db.scalars(select(KnowledgeDocument).where(KnowledgeDocument.product_id == product_id))).all()
    )
    snapshot = await graph_rag_service.snapshot(product_id, max_nodes=max_nodes)
    return KnowledgeGraphOut(
        product_id=product_id,
        nodes=snapshot["nodes"],
        edges=snapshot["edges"],
        indexed_documents=sum(item.graph_status == "ready" for item in documents),
        pending_documents=sum(item.graph_status in {"pending", "processing"} for item in documents),
        failed_documents=sum(item.graph_status in {"failed", "unavailable"} for item in documents),
        is_truncated=snapshot["is_truncated"],
    )


@router.post("/graph/reindex", status_code=202)
async def reindex_knowledge_graph(
    product_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> dict:
    if await db.get(Product, product_id) is None:
        raise HTTPException(status_code=404, detail="产品不存在")
    documents = list(
        (await db.scalars(select(KnowledgeDocument).where(KnowledgeDocument.product_id == product_id))).all()
    )
    for document in documents:
        if document.status == KnowledgeStatus.ready:
            document.graph_status = "pending"
            document.graph_error_message = None
    await db.commit()
    background_tasks.add_task(backfill_pending_graphs, product_id, True)
    return {"status": "accepted", "documents": len(documents)}


@router.get("/dashboard", response_model=DashboardStats)
async def dashboard(db: AsyncSession = Depends(get_db)) -> DashboardStats:
    async def count(model: type) -> int:
        return int((await db.scalar(select(func.count()).select_from(model))) or 0)

    products, documents, chunks, conversations, messages = [
        await count(model) for model in (Product, KnowledgeDocument, KnowledgeChunk, Conversation, Message)
    ]
    assistant_total = int(
        (await db.scalar(select(func.count()).select_from(Message).where(Message.role == MessageRole.assistant))) or 0
    )
    answered = int(
        (
            await db.scalar(
                select(func.count())
                .select_from(Message)
                .where(Message.role == MessageRole.assistant, Message.confidence >= settings.rag_min_score)
            )
        )
        or 0
    )
    feedback_total = await count(Feedback)
    helpful = int((await db.scalar(select(func.count()).select_from(Feedback).where(Feedback.helpful.is_(True)))) or 0)
    recent = (
        await db.execute(
            select(Message).where(Message.role == MessageRole.user).order_by(Message.created_at.desc()).limit(8)
        )
    ).scalars()
    return DashboardStats(
        products=products,
        documents=documents,
        chunks=chunks,
        conversations=conversations,
        messages=messages,
        answer_rate=round(answered / assistant_total, 4) if assistant_total else 0,
        helpful_rate=round(helpful / feedback_total, 4) if feedback_total else None,
        recent_questions=[{"content": item.content, "created_at": item.created_at.isoformat()} for item in recent],
    )


@router.post("/evaluations/run")
async def run_evaluation(product_id: uuid.UUID | None = None, db: AsyncSession = Depends(get_db)) -> dict:
    path = Path("data/evaluation/questions.json")
    if not path.exists():
        raise HTTPException(status_code=404, detail="评测集不存在")
    cases = json.loads(path.read_text(encoding="utf-8"))
    results: list[dict] = []
    category_totals: dict[str, int] = {}
    category_passed: dict[str, int] = {}
    for case in cases:
        answer, category, confidence, needs_human, citations, *_ = await answer_question(db, case["question"], product_id)
        keywords = case.get("expected_keywords", [])
        passed = (
            case.get("expect_handoff", False) == needs_human
            if not keywords
            else any(word.lower() in answer.lower() for word in keywords)
        )
        category_totals[case["category"]] = category_totals.get(case["category"], 0) + 1
        category_passed[case["category"]] = category_passed.get(case["category"], 0) + int(passed)
        results.append(
            {**case, "answer": answer, "confidence": confidence, "citations": len(citations), "passed": passed}
        )
    passed_count = sum(item["passed"] for item in results)
    metrics = {
        "accuracy": round(passed_count / len(results), 4),
        "by_category": {key: round(category_passed.get(key, 0) / total, 4) for key, total in category_totals.items()},
    }
    run = EvaluationRun(
        name="内置30题回归评测", total=len(results), passed=passed_count, metrics_json=metrics, results_json=results
    )
    db.add(run)
    await db.commit()
    return {"id": str(run.id), "total": len(results), "passed": passed_count, "metrics": metrics, "results": results}


async def _index_document(db: AsyncSession, document: KnowledgeDocument, text: str) -> None:
    chunks = split_text(text)
    embeddings: list[list[float]] = []
    for offset in range(0, len(chunks), 32):
        batch = [f"{chunk.heading}\n{chunk.content}" for chunk in chunks[offset : offset + 32]]
        embeddings.extend(await embedding_provider.embed(batch))
    for chunk, embedding in zip(chunks, embeddings, strict=True):
        db.add(
            KnowledgeChunk(
                document_id=document.id,
                product_id=document.product_id,
                ordinal=chunk.ordinal,
                heading=chunk.heading,
                content=chunk.content,
                token_count=chunk.token_count,
                embedding=embedding,
                metadata_json={"source_url": document.source_url, "source_type": document.source_type},
            )
        )
    document.chunk_count = len(chunks)
    document.status = KnowledgeStatus.ready
