import type { Citation } from '../types'

export default function AnswerText({ text, citations, onCitation }: {
  text: string
  citations: Citation[]
  onCitation: (index: number) => void
}) {
  const parts = text.split(/(\[\d+\])/g)
  return (
    <div className="answer-text">
      {parts.map((part, index) => {
        const match = part.match(/^\[(\d+)\]$/)
        if (!match) return <span key={index}>{part}</span>
        const citationIndex = Number(match[1])
        const exists = citations.some((citation) => citation.index === citationIndex)
        return exists ? (
          <button key={index} className="citation-chip" onClick={() => onCitation(citationIndex)} aria-label={`查看来源 ${citationIndex}`}>
            {citationIndex}
          </button>
        ) : <span key={index}>{part}</span>
      })}
    </div>
  )
}

