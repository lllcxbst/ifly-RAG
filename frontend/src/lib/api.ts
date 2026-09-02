import type { ChatResult, DashboardStats, DocumentRecord, KnowledgeGraph, Product, ProductCreate } from '../types'

export type UploadProgress = { percent: number; label: string }

const BASE = import.meta.env.VITE_API_BASE_URL || '/api/v1'

async function request<T>(path: string, init?: RequestInit, adminKey?: string): Promise<T> {
  const headers = new Headers(init?.headers)
  if (!(init?.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  if (adminKey) headers.set('X-Admin-Key', adminKey)
  const response = await fetch(`${BASE}${path}`, { ...init, headers })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ detail: '请求失败' }))
    throw new Error(payload.detail || `请求失败 (${response.status})`)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export const api = {
  products: () => request<Product[]>('/products'),
  chat: (question: string, sessionKey: string, productId?: string) =>
    request<ChatResult>('/chat', {
      method: 'POST',
      body: JSON.stringify({ question, session_key: sessionKey, product_id: productId || null }),
    }),
  feedback: (messageId: string, helpful: boolean) =>
    request<void>('/feedback', { method: 'POST', body: JSON.stringify({ message_id: messageId, helpful }) }),
  dashboard: (key: string) => request<DashboardStats>('/admin/dashboard', undefined, key),
  createProduct: (key: string, product: ProductCreate) =>
    request<Product>('/admin/products', { method: 'POST', body: JSON.stringify(product) }, key),
  documents: (key: string) => request<DocumentRecord[]>('/admin/documents', undefined, key),
  graph: (key: string, productId: string, maxNodes = 180) =>
    request<KnowledgeGraph>(`/admin/graph?product_id=${encodeURIComponent(productId)}&max_nodes=${maxNodes}`, undefined, key),
  reindexGraph: (key: string, productId: string) =>
    request<{ status: string; documents: number }>(
      `/admin/graph/reindex?product_id=${encodeURIComponent(productId)}`,
      { method: 'POST' },
      key,
    ),
  upload: (key: string, form: FormData, onProgress?: (progress: UploadProgress) => void) =>
    uploadRequest<DocumentRecord>('/admin/documents', form, key, onProgress),
  removeDocument: (key: string, id: string) => request<void>(`/admin/documents/${id}`, { method: 'DELETE' }, key),
  runEvaluation: (key: string, productId?: string) =>
    request<{ total: number; passed: number; metrics: { accuracy: number; by_category: Record<string, number> } }>(
      `/admin/evaluations/run${productId ? `?product_id=${productId}` : ''}`,
      { method: 'POST' },
      key,
    ),
}

function uploadRequest<T>(path: string, form: FormData, adminKey: string, onProgress?: (progress: UploadProgress) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${BASE}${path}`)
    xhr.setRequestHeader('X-Admin-Key', adminKey)
    xhr.upload.addEventListener('loadstart', () => onProgress?.({ percent: 8, label: '正在传输文件' }))
    xhr.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable) return
      const transferred = Math.round((event.loaded / event.total) * 54)
      onProgress?.({ percent: 8 + transferred, label: `正在传输文件 ${Math.round((event.loaded / event.total) * 100)}%` })
    })
    xhr.upload.addEventListener('load', () => onProgress?.({ percent: 68, label: '正在解析文档结构' }))
    xhr.addEventListener('error', () => reject(new Error('网络连接失败，请稍后重试')))
    xhr.addEventListener('abort', () => reject(new Error('上传已取消')))
    xhr.addEventListener('load', () => {
      let payload: unknown
      try { payload = xhr.responseText ? JSON.parse(xhr.responseText) : null } catch { payload = null }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(payload as T)
        return
      }
      const detail = payload && typeof payload === 'object' && 'detail' in payload ? String(payload.detail) : `上传失败 (${xhr.status})`
      reject(new Error(detail))
    })
    xhr.send(form)
  })
}
