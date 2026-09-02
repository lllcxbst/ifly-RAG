from collections.abc import AsyncIterator

from app.core.config import settings
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


engine = create_async_engine(settings.database_url, pool_pre_ping=True, pool_size=10, max_overflow=20)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def get_db() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session


async def init_db() -> None:
    # pgvector must exist before SQLAlchemy creates the vector column.
    async with engine.begin() as connection:
        await connection.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        await connection.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
        await connection.run_sync(Base.metadata.create_all)
        # create_all does not add columns to an existing deployment. Keep this
        # small additive migration idempotent so graph indexing can be rolled
        # out without replacing the production volume.
        await connection.execute(
            text("ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS graph_status VARCHAR(24) NOT NULL DEFAULT 'pending'")
        )
        await connection.execute(
            text("ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS graph_error_message TEXT")
        )
        await connection.execute(
            text("ALTER TABLE messages ADD COLUMN IF NOT EXISTS retrieval_mode VARCHAR(24)")
        )
        await connection.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_chunks_embedding_hnsw "
                "ON knowledge_chunks USING hnsw (embedding vector_cosine_ops)"
            )
        )
