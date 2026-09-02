import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowRight, Braces, DatabaseZap, GitBranch, LoaderCircle, Network, RefreshCcw, ScanSearch, ShieldCheck } from 'lucide-react'
import SelectField from '../components/SelectField'
import { api } from '../lib/api'
import type { GraphEdge, GraphNode, KnowledgeGraph, Product } from '../types'

type PositionedNode = GraphNode & { x: number; y: number; radius: number }

const WIDTH = 1000
const HEIGHT = 620

function nodeTone(type: string) {
  const normalized = type.toUpperCase()
  if (normalized.includes('ERROR') || normalized.includes('CAUSE') || normalized.includes('SYMPTOM')) return 'orange'
  if (normalized.includes('API') || normalized.includes('PARAMETER') || normalized.includes('STEP')) return 'blue'
  if (normalized.includes('PRODUCT') || normalized.includes('CAPABILITY') || normalized.includes('SCENARIO')) return 'lime'
  return 'paper'
}

function positionNodes(nodes: GraphNode[]): PositionedNode[] {
  const sorted = [...nodes].sort((left, right) => right.degree - left.degree || left.label.localeCompare(right.label))
  return sorted.map((node, index) => {
    if (index === 0) return { ...node, x: WIDTH / 2, y: HEIGHT / 2, radius: 22 }
    const ring = Math.floor(Math.sqrt(index / 5)) + 1
    const ringStart = ring === 1 ? 1 : 5 * (ring - 1) * (ring - 1)
    const ringSize = Math.max(8, 8 + ring * 5)
    const angle = ((index - ringStart) / ringSize) * Math.PI * 2 - Math.PI / 2 + ring * 0.32
    const distance = Math.min(265, 92 + ring * 78)
    return {
      ...node,
      x: WIDTH / 2 + Math.cos(angle) * distance * 1.38,
      y: HEIGHT / 2 + Math.sin(angle) * distance,
      radius: Math.min(19, 10 + Math.sqrt(node.degree + 1) * 2.4),
    }
  })
}

export default function GraphPage() {
  const adminKey = sessionStorage.getItem('beacon-admin-key') || ''
  const [products, setProducts] = useState<Product[]>([])
  const [productId, setProductId] = useState('')
  const [graph, setGraph] = useState<KnowledgeGraph | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(false)
  const [reindexing, setReindexing] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.products().then((items) => {
      setProducts(items)
      if (items[0]) setProductId(items[0].id)
    }).catch((reason: Error) => setError(reason.message))
  }, [])

  const load = async (quiet = false) => {
    if (!adminKey || !productId) return
    if (!quiet) setLoading(true)
    setError('')
    try {
      const result = await api.graph(adminKey, productId)
      setGraph(result)
      setSelectedId((current) => result.nodes.some((node) => node.id === current) ? current : result.nodes[0]?.id || '')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '知识图谱读取失败')
    } finally { setLoading(false) }
  }

  // Product changes are the external signal that selects a different graph workspace.
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { void load() }, [productId])

  useEffect(() => {
    if (!graph?.pending_documents) return
    const timer = window.setInterval(() => void load(true), 5000)
    return () => window.clearInterval(timer)
  }, [graph?.pending_documents]) // eslint-disable-line react-hooks/exhaustive-deps

  const rebuild = async () => {
    if (!productId || reindexing) return
    setReindexing(true); setError('')
    try {
      await api.reindexGraph(adminKey, productId)
      await load(true)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '图谱重建失败')
    } finally { setReindexing(false) }
  }

  const nodes = useMemo(() => positionNodes(graph?.nodes || []), [graph?.nodes])
  const nodeMap = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes])
  const selected = nodeMap.get(selectedId)
  const connectedEdges = useMemo(() => (graph?.edges || []).filter((edge) => edge.source === selectedId || edge.target === selectedId), [graph?.edges, selectedId])
  const neighborIds = useMemo(() => new Set(connectedEdges.flatMap((edge) => [edge.source, edge.target])), [connectedEdges])

  if (!adminKey) return (
    <div className="graph-auth-gate">
      <span><Network size={28} /></span>
      <p className="eyebrow">PROTECTED GRAPH WORKSPACE</p>
      <h1>先验证管理身份</h1>
      <p>知识图谱包含内部产品实体、错误码与依赖关系，需要先进入知识控制台完成认证。</p>
      <button onClick={() => { location.hash = 'admin' }}>前往知识控制台 <ArrowRight size={16} /></button>
    </div>
  )

  return (
    <div className="graph-page">
      <section className="graph-hero">
        <div><span className="eyebrow">DUAL-LAYER KNOWLEDGE MEMORY</span><h1>知识关系，一目了然。</h1><p>从文档中自动抽取实体与关系，在语义召回之外补足跨章节、跨文档的关联推理。</p></div>
        <div className="graph-controls">
          <SelectField ariaLabel="选择图谱产品" value={productId} onValueChange={setProductId} options={products.map((product) => ({ value: product.id, label: product.name }))} placeholder="选择产品" align="end" />
          <button className="ghost" onClick={() => void load()} disabled={loading}><RefreshCcw className={loading ? 'spin' : ''} size={15} /> 刷新</button>
          <button className="primary" onClick={() => void rebuild()} disabled={reindexing || !productId}>{reindexing ? <LoaderCircle className="spin" /> : <DatabaseZap />} 重建图谱</button>
        </div>
      </section>

      {error && <div className="graph-alert" role="alert"><AlertTriangle size={16} />{error}</div>}

      <section className="graph-metrics">
        <article><Network /><div><small>实体节点</small><strong>{graph?.nodes.length || 0}</strong></div></article>
        <article><GitBranch /><div><small>关系边</small><strong>{graph?.edges.length || 0}</strong></div></article>
        <article><ShieldCheck /><div><small>已图谱化文档</small><strong>{graph?.indexed_documents || 0}</strong></div></article>
        <article className={graph?.pending_documents ? 'working' : ''}><ScanSearch /><div><small>等待 / 处理中</small><strong>{graph?.pending_documents || 0}</strong></div></article>
      </section>

      <section className="graph-workbench">
        <div className="graph-canvas">
          <header><div><span className="eyebrow">RELATION MAP</span><h2>产品知识网络</h2></div><div className="graph-legend"><span className="lime">产品能力</span><span className="blue">接口步骤</span><span className="orange">故障排障</span><span className="paper">其他实体</span></div></header>
          {loading && !graph ? <div className="graph-loading"><LoaderCircle className="spin" /><span>正在读取图谱工作区</span></div> : nodes.length ? (
            <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="产品知识图谱">
              <defs><filter id="node-glow"><feGaussianBlur stdDeviation="5" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs>
              <g className="graph-edge-layer">{(graph?.edges || []).map((edge: GraphEdge) => {
                const source = nodeMap.get(edge.source); const target = nodeMap.get(edge.target)
                if (!source || !target) return null
                const active = !selectedId || edge.source === selectedId || edge.target === selectedId
                return <line key={edge.id} x1={source.x} y1={source.y} x2={target.x} y2={target.y} className={active ? 'active' : 'muted'} />
              })}</g>
              <g className="graph-node-layer">{nodes.map((node) => {
                const active = node.id === selectedId || neighborIds.has(node.id)
                return <g key={node.id} className={`graph-node ${nodeTone(node.entity_type)} ${active ? 'active' : 'muted'}`} transform={`translate(${node.x} ${node.y})`} role="button" tabIndex={0} aria-label={`${node.label}，${node.entity_type}`} onClick={() => setSelectedId(node.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setSelectedId(node.id) }}>
                  <circle r={node.radius + 8} className="node-aura" />
                  <circle r={node.radius} className="node-core" filter={node.id === selectedId ? 'url(#node-glow)' : undefined} />
                  <text y={node.radius + 19}>{node.label.length > 12 ? `${node.label.slice(0, 12)}…` : node.label}</text>
                </g>
              })}</g>
            </svg>
          ) : <div className="graph-empty"><Braces size={34} /><h3>{graph?.pending_documents ? '正在构建知识关系' : '还没有可展示的图谱'}</h3><p>{graph?.pending_documents ? 'LightRAG 正在从文档中提取实体、关系与证据映射，完成后此处会自动刷新。' : '上传真实产品资料或点击“重建图谱”，系统会自动生成关系网络。'}</p></div>}
        </div>

        <aside className="graph-inspector">
          <header><span className="eyebrow">ENTITY INSPECTOR</span><h2>实体档案</h2></header>
          {selected ? <>
            <div className={`entity-sigil ${nodeTone(selected.entity_type)}`}><Network size={25} /></div>
            <span className="entity-type">{selected.entity_type}</span>
            <h3>{selected.label}</h3>
            <p>{selected.description || '该实体来自知识文档抽取，暂无独立摘要。'}</p>
            <div className="entity-degree"><span>连接强度</span><strong>{selected.degree.toString().padStart(2, '0')}</strong></div>
            <div className="relation-list"><small>直接关系</small>{connectedEdges.slice(0, 8).map((edge) => {
              const peerId = edge.source === selected.id ? edge.target : edge.source
              const peer = nodeMap.get(peerId)
              return <button key={edge.id} onClick={() => setSelectedId(peerId)}><i /><span><strong>{edge.relation}</strong><small>{peer?.label || peerId}</small></span><ArrowRight size={13} /></button>
            })}</div>
          </> : <div className="inspector-empty">选择一个节点查看它的类型、描述与直接关系。</div>}
          <footer><span>{graph?.engine || 'LightRAG 1.5.6'}</span><span>BAAI/bge-m3</span><span>自适应检索</span></footer>
        </aside>
      </section>
    </div>
  )
}
