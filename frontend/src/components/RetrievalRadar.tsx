import { BrainCircuit, Check, GitMerge, ListFilter, Route, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'

const stages = [
  { label: '理解问题', detail: '识别功能、接入或排障意图', icon: BrainCircuit },
  { label: '选择检索路径', detail: '判断使用语义、图谱或并行检索', icon: Route },
  { label: '检索知识网络', detail: 'BAAI/bge-m3 与实体关系正在并行召回', icon: GitMerge },
  { label: '校准原文依据', detail: '融合排序并剔除无法追溯的结果', icon: ListFilter },
  { label: '组织引用回答', detail: '基于证据生成可追溯结论', icon: Sparkles },
]

export default function RetrievalRadar() {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const started = Date.now()
    const timer = setInterval(() => setElapsed(Date.now() - started), 240)
    return () => clearInterval(timer)
  }, [])

  const activeStage = elapsed < 650 ? 0 : elapsed < 1350 ? 1 : elapsed < 3000 ? 2 : elapsed < 4700 ? 3 : 4
  const progress = Math.min(94, Math.round(
    activeStage === 0 ? 8 + elapsed / 55
      : activeStage === 1 ? 21 + (elapsed - 650) / 55
        : activeStage === 2 ? 36 + (elapsed - 1350) / 90
          : activeStage === 3 ? 57 + (elapsed - 3000) / 95
            : 76 + (elapsed - 4700) / 650,
  ))
  const current = stages[activeStage]
  const CurrentIcon = current.icon

  return (
    <div className="processing-card" role="status" aria-live="polite">
      <header>
        <div className="processing-orbit"><CurrentIcon size={18} /></div>
        <div><strong>{current.label}</strong><span>{current.detail}</span></div>
        <b>{progress}%</b>
      </header>
      <div className="processing-track" role="progressbar" aria-label="回答生成进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
        <i style={{ width: `${progress}%` }} />
      </div>
      <ol className="processing-steps">
        {stages.map((stage, index) => {
          const Icon = stage.icon
          const state = index < activeStage ? 'done' : index === activeStage ? 'active' : 'pending'
          return <li className={state} key={stage.label}>{state === 'done' ? <Check size={13} /> : <Icon size={13} />}<span>{stage.label}</span></li>
        })}
      </ol>
    </div>
  )
}
