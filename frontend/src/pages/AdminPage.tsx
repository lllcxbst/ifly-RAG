import { FormEvent, useEffect, useState } from 'react'
import { Activity, AlertTriangle, ArrowRight, BarChart3, Boxes, Check, Database, FileCheck2, FileText, KeyRound, LoaderCircle, MessageCircle, PackagePlus, Play, Plus, RefreshCcw, Trash2, Users, X } from 'lucide-react'
import FileDropZone from '../components/FileDropZone'
import SelectField from '../components/SelectField'
import { api } from '../lib/api'
import type { DashboardStats, DocumentRecord, Product, ProductCreate } from '../types'

const emptyProduct: ProductCreate = { name: '', slug: '', description: '', support_contact: '请联系部门技术支持' }

function slugifyProductName(value: string) {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 80)
}

export default function AdminPage() {
  const [adminKey, setAdminKey] = useState(() => sessionStorage.getItem('beacon-admin-key') || '')
  const [authorized, setAuthorized] = useState(false)
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [documents, setDocuments] = useState<DocumentRecord[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [uploadProductId, setUploadProductId] = useState('')
  const [sourceType, setSourceType] = useState('官方文档')
  const [uploadProgress, setUploadProgress] = useState<{ percent: number; label: string } | null>(null)
  const [productDialogOpen, setProductDialogOpen] = useState(false)
  const [newProduct, setNewProduct] = useState<ProductCreate>(emptyProduct)
  const [slugTouched, setSlugTouched] = useState(false)
  const [productBusy, setProductBusy] = useState(false)
  const [productError, setProductError] = useState('')
  const [notice, setNotice] = useState('')
  const [evaluation, setEvaluation] = useState<{ total: number; passed: number; metrics: { accuracy: number; by_category: Record<string, number> } } | null>(null)

  const load = async (key = adminKey) => {
    setBusy(true); setError('')
    try {
      const [dashboard, docs, productList] = await Promise.all([api.dashboard(key), api.documents(key), api.products()])
      setStats(dashboard); setDocuments(docs); setProducts(productList)
      setUploadProductId((current) => productList.some((product) => product.id === current) ? current : productList[0]?.id || '')
      setAuthorized(true)
      sessionStorage.setItem('beacon-admin-key', key)
    } catch (reason) {
      setAuthorized(false); setError(reason instanceof Error ? reason.message : '认证失败')
    } finally { setBusy(false) }
  }

  // Restore a session-scoped admin key once; later key edits must not auto-submit.
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { if (adminKey) void load(adminKey) }, [])

  useEffect(() => {
    if (!productDialogOpen) return
    const previousOverflow = document.body.style.overflow
    const closeOnEscape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape' && !productBusy) setProductDialogOpen(false) }
    document.body.style.overflow = 'hidden'
    addEventListener('keydown', closeOnEscape)
    return () => { document.body.style.overflow = previousOverflow; removeEventListener('keydown', closeOnEscape) }
  }, [productDialogOpen, productBusy])

  if (!authorized) return (
    <div className="admin-gate">
      <div className="gate-card">
        <span className="gate-icon"><KeyRound size={30} /></span>
        <span className="eyebrow">RESTRICTED KNOWLEDGE CONTROL</span>
        <h1>进入知识控制台</h1>
        <p>管理入口与公开问答隔离。密钥只保存在当前浏览器会话，不会写入知识库。</p>
        <form onSubmit={(event) => { event.preventDefault(); void load() }}>
          <label>管理密钥<input type="password" value={adminKey} onChange={(event) => setAdminKey(event.target.value)} autoComplete="current-password" placeholder="输入 X-Admin-Key" /></label>
          {error && <span className="form-error"><AlertTriangle size={14} /> {error}</span>}
          <button disabled={!adminKey || busy}>{busy ? <LoaderCircle className="spin" /> : <KeyRound />} 验证并进入</button>
        </form>
      </div>
    </div>
  )

  const upload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedFile) { setError('请先选择或拖入一份资料文件'); return }
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    form.set('product_id', uploadProductId)
    form.set('source_type', sourceType)
    form.append('file', selectedFile, selectedFile.name)
    setBusy(true); setError(''); setUploadProgress({ percent: 5, label: '正在校验文件' })
    const indexingTimer = window.setInterval(() => setUploadProgress((current) => {
      if (!current || current.percent < 68 || current.percent >= 92) return current
      const percent = Math.min(92, current.percent + 1)
      return { percent, label: percent < 80 ? '正在解析并切分知识片段' : '正在生成 BAAI/bge-m3 向量索引' }
    }), 550)
    try {
      const document = await api.upload(adminKey, form, setUploadProgress)
      window.clearInterval(indexingTimer)
      setUploadProgress({ percent: 100, label: `语义索引完成 · ${document.chunk_count} 个片段 · 图谱正在后台构建` })
      formElement.reset(); setSelectedFile(null); setTitle(''); await load()
      window.setTimeout(() => setUploadProgress(null), 3600)
    } catch (reason) {
      window.clearInterval(indexingTimer)
      setUploadProgress(null); setError(reason instanceof Error ? reason.message : '上传失败'); setBusy(false)
    }
  }
  const remove = async (document: DocumentRecord) => {
    if (!confirm(`确定删除“${document.title}”及其全部索引片段吗？`)) return
    await api.removeDocument(adminKey, document.id); await load()
  }
  const runEvaluation = async () => {
    setBusy(true); setError('')
    try { setEvaluation(await api.runEvaluation(adminKey, products[0]?.id)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : '评测失败') }
    finally { setBusy(false) }
  }
  const createProduct = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!newProduct.name.trim()) { setProductError('请填写产品名称'); return }
    if (!/^[a-z0-9][a-z0-9-]{1,79}$/.test(newProduct.slug)) {
      setProductError('请填写至少 2 位的英文标识，只能使用小写字母、数字和连字符')
      return
    }
    setProductBusy(true); setProductError('')
    try {
      const created = await api.createProduct(adminKey, {
        ...newProduct,
        name: newProduct.name.trim(),
        description: newProduct.description.trim(),
        support_contact: newProduct.support_contact.trim() || '请联系部门技术支持',
      })
      await load()
      setUploadProductId(created.id)
      setNewProduct(emptyProduct); setSlugTouched(false); setProductDialogOpen(false)
      setNotice(`“${created.name}”已加入产品目录，现在可以为它上传资料。`)
      window.setTimeout(() => setNotice(''), 5000)
    } catch (reason) {
      setProductError(reason instanceof Error ? reason.message : '产品创建失败')
    } finally { setProductBusy(false) }
  }

  const slugValid = /^[a-z0-9][a-z0-9-]{1,79}$/.test(newProduct.slug)
  const productReady = Boolean(newProduct.name.trim()) && slugValid

  return (
    <div className="admin-page">
      <section className="admin-hero">
        <div><span className="eyebrow">KNOWLEDGE OPERATIONS</span><h1>知识控制台</h1><p>让每一次回答，都有经过校准的依据。</p></div>
        <div className="admin-actions"><button className="product-action" onClick={() => { setProductError(''); setProductDialogOpen(true) }}><PackagePlus size={16} /> 新增产品</button><button className="ghost" onClick={() => void load()}><RefreshCcw size={16} /> 刷新</button><span><i /> 索引服务正常</span></div>
      </section>

      {error && <div className="admin-alert"><AlertTriangle size={17} />{error}<button onClick={() => setError('')}>关闭</button></div>}
      {notice && <div className="admin-notice" role="status"><Check size={17} />{notice}<button onClick={() => setNotice('')}>关闭</button></div>}

      <section className="metric-grid">
        <Metric icon={<Database />} label="知识文档" value={stats?.documents || 0} note={`${stats?.chunks || 0} 个检索片段`} tone="lime" />
        <Metric icon={<MessageCircle />} label="服务会话" value={stats?.conversations || 0} note={`${stats?.messages || 0} 条消息`} tone="blue" />
        <Metric icon={<Activity />} label="可回答率" value={`${Math.round((stats?.answer_rate || 0) * 100)}%`} note="基于置信度阈值" tone="orange" />
        <Metric icon={<Users />} label="好评率" value={stats?.helpful_rate == null ? '—' : `${Math.round(stats.helpful_rate * 100)}%`} note="来自用户反馈" tone="paper" />
      </section>

      <div className="admin-columns">
        <section className="admin-card knowledge-card">
          <header><div><span className="eyebrow">INCREMENTAL INGESTION</span><h2>知识入库</h2></div><span>{documents.length} FILES</span></header>
          <form className="upload-form" onSubmit={upload}>
            <FileDropZone file={selectedFile} disabled={busy} onError={setError} onFile={(file) => {
              setSelectedFile(file)
              if (file && !title.trim()) setTitle(file.name.replace(/\.[^.]+$/, ''))
            }} />
            <div className="upload-controls">
              <div className="upload-fields">
                <div className="field-label"><span>所属产品 <small>{products.length} 个可用</small></span><SelectField required ariaLabel="选择所属产品" value={uploadProductId} onValueChange={setUploadProductId} options={products.map((product) => ({ value: product.id, label: product.name }))} placeholder="选择产品" menuLabel={`${products.length} 个产品`} /></div>
                <label>资料标题<input name="title" value={title} onChange={(event) => setTitle(event.target.value)} required placeholder="例如：API 接入指南 v2.3" /></label>
                <div className="field-label"><span>来源类型 <small>4 个可用</small></span><SelectField ariaLabel="选择来源类型" value={sourceType} onValueChange={setSourceType} options={['官方文档', 'FAQ', '导师访谈', '故障复盘'].map((value) => ({ value, label: value }))} menuLabel="4 个来源类型" /></div>
                <label>原文链接（可选）<input name="source_url" type="url" placeholder="https://…" /></label>
              </div>
              {uploadProgress && <div className={`upload-progress${uploadProgress.percent === 100 ? ' complete' : ''}`} role="status" aria-live="polite">
                <div><span>{uploadProgress.label}</span><strong>{uploadProgress.percent}%</strong></div>
                <i><b style={{ width: `${uploadProgress.percent}%` }} /></i>
              </div>}
              <button className="primary" disabled={busy || !selectedFile || !uploadProductId}>{busy && uploadProgress ? <LoaderCircle className="spin" /> : <Plus />} {busy && uploadProgress ? '正在建立索引' : '解析并增量索引'}</button>
            </div>
          </form>
          <div className="document-list">
            {documents.map((document) => (
              <article key={document.id}>
                <span className={`doc-icon ${document.status}`}><FileText /></span>
                <div><strong>{document.title}</strong><small>{document.source_type} · {document.original_filename || '文本录入'} · v{document.version} · 图谱{document.graph_status === 'ready' ? '已就绪' : document.graph_status === 'processing' ? '构建中' : document.graph_status === 'failed' ? '失败' : document.graph_status === 'unavailable' ? '未启用' : '等待中'}</small></div>
                <span className={`doc-status ${document.status}`}>{document.status === 'ready' ? <FileCheck2 /> : document.status === 'processing' ? <LoaderCircle className="spin" /> : <AlertTriangle />}{document.status === 'ready' ? `${document.chunk_count} 片段` : document.status}</span>
                <button className="icon-button danger" onClick={() => void remove(document)} aria-label={`删除 ${document.title}`}><Trash2 /></button>
              </article>
            ))}
            {!documents.length && <div className="list-empty">还没有知识文档，上传第一份产品资料。</div>}
          </div>
        </section>

        <aside className="admin-side">
          <section className="admin-card eval-card">
            <header><div><span className="eyebrow">QUALITY GATE</span><h2>30 题回归评测</h2></div><BarChart3 /></header>
            {evaluation ? <>
              <div className="eval-score"><strong>{Math.round(evaluation.metrics.accuracy * 100)}</strong><span>%<small>整体可用率</small></span></div>
              <div className="eval-bars">{Object.entries(evaluation.metrics.by_category).map(([key, value]) => <div key={key}><span>{categoryLabel(key)}</span><i><b style={{ width: `${value * 100}%` }} /></i><strong>{Math.round(value * 100)}%</strong></div>)}</div>
              <p>{evaluation.passed} / {evaluation.total} 条通过自动断言。结果已保存，可用于优化前后对比。</p>
            </> : <div className="eval-intro"><div><i /><i /><i /></div><p>覆盖功能介绍、使用方法、问题排障各 10 题，并验证未知问题是否正确转人工。</p></div>}
            <button className="primary" onClick={() => void runEvaluation()} disabled={busy}>{busy ? <LoaderCircle className="spin" /> : <Play />} 运行全量评测</button>
          </section>

          <section className="admin-card recent-card">
            <header><div><span className="eyebrow">LIVE SIGNALS</span><h2>最近提问</h2></div><span className="pulse" /></header>
            <div>{stats?.recent_questions?.map((item, index) => <article key={`${item.created_at}-${index}`}><span>{String(index + 1).padStart(2, '0')}</span><p>{item.content}<small>{new Date(item.created_at).toLocaleString('zh-CN')}</small></p></article>)}</div>
            {!stats?.recent_questions?.length && <div className="list-empty">等待第一条真实提问。</div>}
          </section>
        </aside>
      </div>

      {productDialogOpen && <div className="product-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !productBusy) setProductDialogOpen(false) }}>
        <section className="product-dialog" role="dialog" aria-modal="true" aria-labelledby="product-dialog-title">
          <header>
            <div className="product-dialog-mark"><PackagePlus size={24} /></div>
            <div><span className="eyebrow">PRODUCT CATALOG</span><h2 id="product-dialog-title">新增产品</h2><p>先建立产品边界，再为它导入专属知识。</p></div>
            <button className="dialog-close" onClick={() => setProductDialogOpen(false)} disabled={productBusy} aria-label="关闭新增产品窗口"><X size={18} /></button>
          </header>
          <div className="product-dialog-body">
            <form className="product-form" onSubmit={createProduct} noValidate>
              <div className="product-form-grid">
                <label>产品名称<input autoFocus value={newProduct.name} onChange={(event) => {
                  const name = event.target.value
                  setNewProduct((current) => ({ ...current, name, slug: slugTouched ? current.slug : slugifyProductName(name) }))
                  setProductError('')
                }} maxLength={120} placeholder="例如：AI UI" /></label>
                <label>英文标识 <small>{newProduct.slug ? (slugValid ? '格式正确' : '至少输入 2 位') : '根据英文名称自动生成'}</small><div className={`slug-input${newProduct.slug && !slugValid ? ' invalid' : ''}`}><span>/</span><input value={newProduct.slug} onChange={(event) => {
                  setSlugTouched(true)
                  setNewProduct((current) => ({ ...current, slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/^-+/, '').replace(/-{2,}/g, '-') }))
                  setProductError('')
                }} minLength={2} maxLength={80} inputMode="url" placeholder="customer-data-platform" aria-invalid={Boolean(newProduct.slug && !slugValid)} /></div></label>
              </div>
              <label>产品简介<textarea value={newProduct.description} onChange={(event) => setNewProduct((current) => ({ ...current, description: event.target.value }))} rows={4} maxLength={800} placeholder="说明产品解决什么问题、适合哪些使用场景…" /></label>
              <label>技术支持方式<input value={newProduct.support_contact} onChange={(event) => setNewProduct((current) => ({ ...current, support_contact: event.target.value }))} maxLength={240} placeholder="例如：通过内部工单联系数据平台团队" /></label>
              {productError && <div className="product-form-error"><AlertTriangle size={15} />{productError}</div>}
              <div className="product-form-note"><Boxes size={16} /><span>创建后会自动成为知识入库的当前产品；不同产品的检索索引彼此隔离。</span></div>
              <div className={`product-readiness ${productReady ? 'ready' : 'waiting'}`} role="status" aria-live="polite">
                {productReady ? <Check size={14} /> : <AlertTriangle size={14} />}
                <span>{productReady ? '信息完整，可以创建' : !newProduct.name.trim() ? '填写产品名称后即可继续' : '还需要填写有效的英文标识'}</span>
              </div>
              <footer><button type="button" className="ghost" onClick={() => setProductDialogOpen(false)} disabled={productBusy}>取消</button><button className="primary" disabled={productBusy}>{productBusy ? <LoaderCircle className="spin" /> : <PackagePlus />} 创建并选择 <ArrowRight size={15} /></button></footer>
            </form>
            <aside className="product-catalog">
              <div className="catalog-count"><strong>{products.length.toString().padStart(2, '0')}</strong><span>个现有产品<br /><small>ACTIVE CATALOG</small></span></div>
              <div className="catalog-list">{products.map((product, index) => <article key={product.id}>
                <span>{String(index + 1).padStart(2, '0')}</span><div><strong>{product.name}</strong><small>/{product.slug} · {documents.filter((document) => document.product_id === product.id).length} 份资料</small></div><i />
              </article>)}</div>
              <p>产品创建后不会自动拥有知识，需要继续上传 Markdown、PDF 或其他资料。</p>
            </aside>
          </div>
        </section>
      </div>}
    </div>
  )
}

function Metric({ icon, label, value, note, tone }: { icon: React.ReactNode; label: string; value: string | number; note: string; tone: string }) {
  return <article className={`metric ${tone}`}><span>{icon}</span><div><small>{label}</small><strong>{value}</strong><p>{note}</p></div></article>
}

function categoryLabel(key: string) {
  return { capability: '功能介绍', usage: '使用方法', troubleshooting: '问题排障' }[key] || key
}
