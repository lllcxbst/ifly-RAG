import hashlib
from pathlib import Path

from app.core.database import SessionLocal
from app.models import KnowledgeChunk, KnowledgeDocument, KnowledgeStatus, Product
from app.services.chunker import split_text
from app.services.providers import embedding_provider
from sqlalchemy import select


async def seed_demo() -> None:
    path = Path("data/seed/demo-product.md")
    if not path.exists():
        return
    async with SessionLocal() as db:
        product = (await db.execute(select(Product).where(Product.slug == "demo-api-platform"))).scalar_one_or_none()
        if product is None:
            product = Product(
                name="星河 API 开放平台（演示）",
                slug="demo-api-platform",
                description="用于展示功能咨询、接入指导和智能排障的虚构产品，可在管理台替换为真实部门资料。",
                support_contact="通过内部工单系统联系“星河平台技术支持”",
            )
            db.add(product)
            await db.flush()
        data = path.read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        existing = (
            await db.execute(
                select(KnowledgeDocument).where(
                    KnowledgeDocument.product_id == product.id, KnowledgeDocument.content_hash == digest
                )
            )
        ).scalar_one_or_none()
        if existing:
            return
        document = KnowledgeDocument(
            product_id=product.id,
            title="星河 API 开放平台产品与排障手册",
            source_type="演示文档",
            original_filename=path.name,
            content_hash=digest,
            status=KnowledgeStatus.processing,
        )
        db.add(document)
        await db.flush()
        chunks = split_text(data.decode("utf-8"))
        embeddings = await embedding_provider.embed([f"{chunk.heading}\n{chunk.content}" for chunk in chunks])
        for chunk, embedding in zip(chunks, embeddings, strict=True):
            db.add(
                KnowledgeChunk(
                    document_id=document.id,
                    product_id=product.id,
                    ordinal=chunk.ordinal,
                    heading=chunk.heading,
                    content=chunk.content,
                    token_count=chunk.token_count,
                    embedding=embedding,
                    metadata_json={"source_type": "演示文档"},
                )
            )
        document.chunk_count = len(chunks)
        document.status = KnowledgeStatus.ready
        await db.commit()
