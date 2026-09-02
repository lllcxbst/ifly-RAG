import { useEffect, useState } from 'react'
import { BookOpen, Bot, Command, Network, Settings2 } from 'lucide-react'
import ChatPage from './pages/ChatPage'
import AdminPage from './pages/AdminPage'
import GraphPage from './pages/GraphPage'

type View = 'chat' | 'admin' | 'graph'

function viewFromHash(): View {
  if (location.hash === '#admin') return 'admin'
  if (location.hash === '#graph') return 'graph'
  return 'chat'
}

export default function App() {
  const [view, setView] = useState<View>(viewFromHash)

  useEffect(() => {
    const onHash = () => setView(viewFromHash())
    addEventListener('hashchange', onHash)
    return () => removeEventListener('hashchange', onHash)
  }, [])

  const navigate = (next: View) => {
    location.hash = next === 'chat' ? '' : next
    setView(next)
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => navigate('chat')} aria-label="返回客服首页">
          <span className="brand-mark"><BookOpen size={18} /></span>
          <span>
            <strong>航标</strong>
            <small>PRODUCT SUPPORT / RAG</small>
          </span>
        </button>
        <nav aria-label="主导航">
          <button className={view === 'chat' ? 'active' : ''} onClick={() => navigate('chat')}>
            <Bot size={16} /> 智能客服
          </button>
          <button className={view === 'admin' ? 'active' : ''} onClick={() => navigate('admin')}>
            <Settings2 size={16} /> 知识控制台
          </button>
          <button className={view === 'graph' ? 'active' : ''} onClick={() => navigate('graph')}>
            <Network size={16} /> 知识图谱
          </button>
        </nav>
        <div className="system-state"><span /> 服务在线 <kbd><Command size={11} /> K</kbd></div>
      </header>
      <main>{view === 'chat' ? <ChatPage /> : view === 'admin' ? <AdminPage /> : <GraphPage />}</main>
    </div>
  )
}
