import asyncio

from sqlalchemy import select

from app.core.config import settings
from app.core.database import SessionLocal
from app.models import KnowledgeChunk
from app.services.providers import embedding_provider

BATCH_SIZE = 32


async def reindex_embeddings() -> None:
    async with SessionLocal() as db:
        chunks = list((await db.scalars(select(KnowledgeChunk).order_by(KnowledgeChunk.id))).all())
        updated = 0
        for offset in range(0, len(chunks), BATCH_SIZE):
            batch = chunks[offset : offset + BATCH_SIZE]
            texts = [f"{chunk.heading}\n{chunk.content}" for chunk in batch]
            embeddings = await embedding_provider.embed(texts)
            for chunk, embedding in zip(batch, embeddings, strict=True):
                chunk.embedding = embedding
            await db.commit()
            updated += len(batch)
            print(f"已重建 {updated}/{len(chunks)} 个知识向量")
        print(
            f"向量重建完成：model={settings.embedding_model}, "
            f"dimensions={settings.embedding_dimensions}, chunks={updated}"
        )


if __name__ == "__main__":
    asyncio.run(reindex_embeddings())
