import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class ProductCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    slug: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{1,79}$")
    description: str = ""
    support_contact: str = "请联系部门技术支持"


class ProductOut(ProductCreate):
    id: uuid.UUID
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class DocumentOut(BaseModel):
    id: uuid.UUID
    product_id: uuid.UUID
    title: str
    source_type: str
    source_url: str | None
    original_filename: str | None
    status: str
    version: int
    chunk_count: int
    graph_status: str
    graph_error_message: str | None
    error_message: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class Citation(BaseModel):
    index: int
    chunk_id: uuid.UUID
    document_id: uuid.UUID
    title: str
    heading: str
    source_type: str
    source_url: str | None
    excerpt: str
    score: float
    retrieval_source: str = "semantic"


class ChatRequest(BaseModel):
    question: str = Field(min_length=2, max_length=2000)
    session_key: str = Field(min_length=8, max_length=80)
    product_id: uuid.UUID | None = None


class ChatResponse(BaseModel):
    conversation_id: uuid.UUID
    message_id: uuid.UUID
    answer: str
    category: str
    confidence: float
    needs_human: bool
    support_contact: str | None = None
    citations: list[Citation]
    suggested_questions: list[str]
    latency_ms: int
    demo_mode: bool
    retrieval_mode: str
    retrieval_reason: str
    graph_entities: list[str] = Field(default_factory=list)


class GraphNodeOut(BaseModel):
    id: str
    label: str
    entity_type: str
    description: str = ""
    degree: int = 0


class GraphEdgeOut(BaseModel):
    id: str
    source: str
    target: str
    relation: str
    description: str = ""
    weight: float = 1.0


class KnowledgeGraphOut(BaseModel):
    product_id: uuid.UUID
    nodes: list[GraphNodeOut]
    edges: list[GraphEdgeOut]
    indexed_documents: int
    pending_documents: int
    failed_documents: int
    is_truncated: bool = False
    engine: str = "LightRAG 1.5.6"


class FeedbackIn(BaseModel):
    message_id: uuid.UUID
    helpful: bool
    comment: str = Field(default="", max_length=1000)


class DashboardStats(BaseModel):
    products: int
    documents: int
    chunks: int
    conversations: int
    messages: int
    answer_rate: float
    helpful_rate: float | None
    recent_questions: list[dict]
