import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, Check, ChevronRight, Copy, ExternalLink, GitMerge, Headphones, MessageSquareText, Network, RotateCcw, Search, ShieldCheck, ThumbsDown, ThumbsUp } from 'lucide-react'
import AnswerText from '../components/AnswerText'
import RetrievalRadar from '../components/RetrievalRadar'
import SelectField from '../components/SelectField'
import { api } from '../lib/api'
import type { ChatMessage, Citation, Product } from '../types'

const starters = [
  { tag: '能力', text: '这个产品是做什么的，适合哪些场景？' },
  { tag: '接入', text: '接入平台前需要准备什么？' },
  { tag: '排障', text: '调用返回 AUTH_001 怎么解决？' },
]

function sessionKey() {
  const stored = localStorage.getItem('beacon-session')
  if (stored) return stored
  const value = crypto.randomUUID()
  localStorage.setItem('beacon-session', value)
  return value
}

export default function ChatPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [productId, setProductId] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [question, setQuestion] = useState('')
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const busy = messages.some((message) => message.pending)
  const selectedProduct = products.find((product) => product.id === productId)

  useEffect(() => {
    api.products().then((items) => {
      setProducts(items)
      if (items[0]) setProductId(items[0].id)
    }).catch((reason: Error) => setError(reason.message))
  }, [])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    const shortcut = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        document.querySelector<HTMLTextAreaElement>('#question')?.focus()
      }
    }
    addEventListener('keydown', shortcut)
    return () => removeEventListener('keydown', shortcut)
  }, [])

  const ask = async (value = question) => {
    const trimmed = value.trim()
    if (!trimmed || busy) return
    setError('')
    setQuestion('')
    setActiveCitation(null)
    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: trimmed }
    const pendingId = crypto.randomUUID()
    setMessages((current) => [...current, userMessage, { id: pendingId, role: 'assistant', content: '', pending: true }])
    try {
      const result = await api.chat(trimmed, sessionKey(), productId)
      setMessages((current) => current.map((message) => message.id === pendingId
        ? { id: result.message_id, role: 'assistant', content: result.answer, result }
        : message))
    } catch (reason) {
      setMessages((current) => current.filter((message) => message.id !== pendingId))
      setError(reason instanceof Error ? reason.message : '请求失败，请稍后再试')
    }
  }

  const submit = (event: FormEvent) => { event.preventDefault(); void ask() }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void ask() }
  }
  const copy = async (id: string, text: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(id)
    setTimeout(() => setCopied(''), 1200)
  }

  const latestCitations = useMemo(() => [...messages].reverse().find((message) => message.result)?.result?.citations || [], [messages])
  const shownCitation = activeCitation || latestCitations[0]

  return (
    <div className="chat-layout">
      <section className="conversation-panel">
        <div className="conversation-head">
          <div>
            <span className="eyebrow">VERIFIED SUPPORT CHANNEL</span>
            <h1>有依据，才回答。</h1>
          </div>
          <div className="product-select">
            <span>当前产品</span>
            <SelectField
              ariaLabel="选择当前产品"
              className="product-select-control"
              value={productId}
              onValueChange={setProductId}
              options={products.map((product) => ({ value: product.id, label: product.name }))}
              placeholder="选择产品"
              align="end"
            />
          </div>
        </div>

        <div className="message-list" ref={listRef} aria-live="polite">
          {messages.length === 0 && (
            <div className="welcome-state">
              <div className="signal-orbit"><ShieldCheck size={34} /><i /><i /></div>
              <h2>把问题交给知识，而不是想象。</h2>
              <p>{selectedProduct?.description || '正在读取可用产品…'}</p>
              <div className="starter-grid">
                {starters.map((starter) => (
                  <button key={starter.text} onClick={() => void ask(starter.text)}>
                    <span>{starter.tag}</span><strong>{starter.text}</strong><ChevronRight size={16} />
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((message) => message.role === 'user' ? (
            <div className="user-message" key={message.id}><span>你的问题</span><p>{message.content}</p></div>
          ) : message.pending ? <RetrievalRadar key={message.id} /> : (
            <article className="assistant-message" key={message.id}>
              <div className="message-meta">
                <span className={`category ${message.result?.category}`}>{labelCategory(message.result?.category)}</span>
                <span className={`retrieval-mode ${message.result?.retrieval_mode}`} title={message.result?.retrieval_reason}>{retrievalIcon(message.result?.retrieval_mode)} {labelRetrieval(message.result?.retrieval_mode)}</span>
                <span>置信度 {Math.round((message.result?.confidence || 0) * 100)}%</span>
                <span>{message.result?.latency_ms} ms</span>
              </div>
              {!!message.result?.graph_entities.length && <div className="graph-trace"><Network size={14} /><span>图谱命中</span>{message.result.graph_entities.slice(0, 5).map((entity) => <i key={entity}>{entity}</i>)}</div>}
              {message.result?.needs_human && <div className="handoff"><Headphones size={18} /><span><strong>建议人工介入</strong>知识依据不足或问题超出边界</span></div>}
              <AnswerText text={message.content} citations={message.result?.citations || []} onCitation={(index) => setActiveCitation(message.result?.citations.find((item) => item.index === index) || null)} />
              <footer className="answer-actions">
                <span>{message.result?.citations.length || 0} 个可追溯来源</span>
                <button onClick={() => void copy(message.id, message.content)} aria-label="复制回答">{copied === message.id ? <Check size={15} /> : <Copy size={15} />}</button>
                <button onClick={() => message.result && void api.feedback(message.result.message_id, true)} aria-label="回答有帮助"><ThumbsUp size={15} /></button>
                <button onClick={() => message.result && void api.feedback(message.result.message_id, false)} aria-label="回答没帮助"><ThumbsDown size={15} /></button>
              </footer>
              {!!message.result?.suggested_questions.length && <div className="followups">
                {message.result.suggested_questions.map((item) => <button key={item} onClick={() => void ask(item)}>{item}</button>)}
              </div>}
            </article>
          ))}
        </div>

        {error && <div className="error-toast" role="alert">{error}<button onClick={() => setError('')}>关闭</button></div>}
        <form className="composer" onSubmit={submit}>
          <textarea id="question" value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={onKeyDown}
            placeholder="描述功能、接入或报错问题…" maxLength={2000} rows={2} aria-label="输入产品问题" />
          <div className="composer-foot"><span><MessageSquareText size={14} /> Enter 发送 · Shift + Enter 换行</span>
            <button type="submit" disabled={busy || question.trim().length < 2} aria-label="发送问题"><ArrowUp size={19} /></button></div>
        </form>
      </section>

      <aside className="evidence-panel">
        <div className="evidence-head"><div><span className="eyebrow">EVIDENCE DESK</span><h2>答案依据</h2></div><span>{latestCitations.length.toString().padStart(2, '0')}</span></div>
        {shownCitation ? (
          <div className="evidence-card" key={shownCitation.chunk_id}>
            <div className="paper-tab">SOURCE {shownCitation.index}</div>
            <span className="source-type">{shownCitation.source_type}</span>
            <h3>{shownCitation.title}</h3>
            <h4>{shownCitation.heading}</h4>
            <blockquote>{shownCitation.excerpt}</blockquote>
            <div className="evidence-score"><span>{shownCitation.retrieval_source === 'graph' ? '图谱关联' : shownCitation.retrieval_source === 'both' ? '双路校准' : '语义匹配'}</span><div><i style={{ width: `${shownCitation.score * 100}%` }} /></div><strong>{Math.round(shownCitation.score * 100)}%</strong></div>
            {shownCitation.source_url && <a href={shownCitation.source_url} target="_blank" rel="noreferrer">打开原始文档 <ExternalLink size={14} /></a>}
          </div>
        ) : (
          <div className="evidence-empty"><div className="empty-lines"><i /><i /><i /><i /></div><h3>来源将在这里展开</h3><p>回答中的数字标记都可以点击，并会定位到支撑结论的原文片段。</p></div>
        )}
        {latestCitations.length > 1 && <div className="evidence-list">{latestCitations.map((citation) => (
          <button className={shownCitation?.chunk_id === citation.chunk_id ? 'active' : ''} key={citation.chunk_id} onClick={() => setActiveCitation(citation)}>
            <span>{citation.index}</span><div><strong>{citation.heading}</strong><small>{citation.title}</small></div>
          </button>
        ))}</div>}
        <div className="trust-note"><RotateCcw size={16} /><span>知识库支持增量更新<br /><small>无需重新训练模型</small></span></div>
      </aside>
    </div>
  )
}

function labelCategory(value?: string) {
  return { capability: '功能介绍', usage: '使用方法', troubleshooting: '问题排障' }[value || ''] || '知识问答'
}

function labelRetrieval(value?: string) {
  return { semantic: '语义检索', graph: '图谱检索', parallel: '并行检索' }[value || ''] || '自动检索'
}

function retrievalIcon(value?: string) {
  if (value === 'graph') return <Network size={13} />
  if (value === 'parallel') return <GitMerge size={13} />
  return <Search size={13} />
}
