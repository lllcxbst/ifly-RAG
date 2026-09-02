import asyncio
import mimetypes
import uuid
from contextlib import asynccontextmanager, suppress

import structlog
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse
from fastapi.staticfiles import StaticFiles
from redis.asyncio import Redis

from app.api import admin, public
from app.core.config import settings
from app.core.database import init_db
from app.services.graph_indexer import backfill_pending_graphs
from app.services.graph_rag import graph_rag_service
from app.services.seed import seed_demo

logger = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await seed_demo()
    try:
        app.state.redis = Redis.from_url(settings.redis_url, decode_responses=True)
        await app.state.redis.ping()
    except Exception:
        app.state.redis = None
        logger.warning("redis_unavailable", detail="rate limiting disabled")
    app.state.graph_backfill = asyncio.create_task(backfill_pending_graphs())
    yield
    graph_backfill = getattr(app.state, "graph_backfill", None)
    if graph_backfill and not graph_backfill.done():
        graph_backfill.cancel()
        with suppress(asyncio.CancelledError):
            await graph_backfill
    await graph_rag_service.finalize()
    if app.state.redis:
        await app.state.redis.aclose()


app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    default_response_class=ORJSONResponse,
    docs_url="/api/docs" if settings.app_env != "production" else None,
    redoc_url=None,
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-Admin-Key", "X-Request-ID"],
)


@app.middleware("http")
async def request_context(request: Request, call_next):
    request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
    try:
        response = await call_next(request)
    except Exception:
        logger.exception("request_failed", request_id=request_id, path=request.url.path)
        raise
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response


app.include_router(public.router, prefix=settings.api_prefix)
app.include_router(admin.router, prefix=settings.api_prefix)

# In the production image FastAPI serves the compiled SPA. API routes are registered first.
mimetypes.add_type("font/woff2", ".woff2")
try:
    app.mount("/", StaticFiles(directory="static", html=True), name="frontend")
except RuntimeError:
    pass
