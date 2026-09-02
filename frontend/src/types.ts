export type Product = {
  id: string
  name: string
  slug: string
  description: string
  support_contact: string
  is_active: boolean
  created_at: string
}

export type ProductCreate = Pick<Product, 'name' | 'slug' | 'description' | 'support_contact'>

export type Citation = {
  index: number
  chunk_id: string
  document_id: string
  title: string
  heading: string
  source_type: string
  source_url?: string
  excerpt: string
  score: number
  retrieval_source: 'semantic' | 'graph' | 'both'
}

export type ChatResult = {
  conversation_id: string
  message_id: string
  answer: string
  category: 'capability' | 'usage' | 'troubleshooting'
  confidence: number
  needs_human: boolean
  support_contact?: string
  citations: Citation[]
  suggested_questions: string[]
  latency_ms: number
  demo_mode: boolean
  retrieval_mode: 'semantic' | 'graph' | 'parallel'
  retrieval_reason: string
  graph_entities: string[]
}

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  result?: ChatResult
  pending?: boolean
}

export type DocumentRecord = {
  id: string
  product_id: string
  title: string
  source_type: string
  source_url?: string
  original_filename?: string
  status: 'processing' | 'ready' | 'failed'
  version: number
  chunk_count: number
  graph_status: 'pending' | 'processing' | 'ready' | 'failed' | 'unavailable'
  graph_error_message?: string
  error_message?: string
  created_at: string
  updated_at: string
}

export type GraphNode = {
  id: string
  label: string
  entity_type: string
  description: string
  degree: number
}

export type GraphEdge = {
  id: string
  source: string
  target: string
  relation: string
  description: string
  weight: number
}

export type KnowledgeGraph = {
  product_id: string
  nodes: GraphNode[]
  edges: GraphEdge[]
  indexed_documents: number
  pending_documents: number
  failed_documents: number
  is_truncated: boolean
  engine: string
}

export type DashboardStats = {
  products: number
  documents: number
  chunks: number
  conversations: number
  messages: number
  answer_rate: number
  helpful_rate?: number
  recent_questions: Array<{ content: string; created_at: string }>
}
