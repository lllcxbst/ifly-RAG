import { ChangeEvent, DragEvent, KeyboardEvent, useRef, useState } from 'react'
import { FileCheck2, FileCode2, Trash2, UploadCloud } from 'lucide-react'

const ACCEPTED_EXTENSIONS = ['md', 'markdown', 'txt', 'pdf', 'docx', 'html', 'htm']
const MAX_FILE_SIZE = 20 * 1024 * 1024

type FileDropZoneProps = {
  file: File | null
  disabled?: boolean
  onFile: (file: File | null) => void
  onError: (message: string) => void
}

export default function FileDropZone({ file, disabled = false, onFile, onError }: FileDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)
  const [dragging, setDragging] = useState(false)

  const acceptFile = (candidate?: File) => {
    if (!candidate) return
    const extension = candidate.name.split('.').pop()?.toLowerCase() || ''
    if (!ACCEPTED_EXTENSIONS.includes(extension)) {
      onError('不支持该文件格式，请上传 Markdown、TXT、PDF、DOCX 或 HTML')
      return
    }
    if (candidate.size > MAX_FILE_SIZE) {
      onError('文件不能超过 20 MB')
      return
    }
    onError('')
    onFile(candidate)
  }

  const chooseFile = () => {
    if (!disabled) inputRef.current?.click()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      chooseFile()
    }
  }
  const onChange = (event: ChangeEvent<HTMLInputElement>) => acceptFile(event.target.files?.[0])
  const onDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (disabled) return
    dragDepth.current += 1
    setDragging(true)
  }
  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (!disabled) event.dataTransfer.dropEffect = 'copy'
  }
  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragging(false)
  }
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    if (!disabled) acceptFile(event.dataTransfer.files?.[0])
  }
  const removeFile = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    if (inputRef.current) inputRef.current.value = ''
    onFile(null)
    onError('')
  }

  return (
    <div
      className={`file-drop${dragging ? ' dragging' : ''}${file ? ' selected' : ''}${disabled ? ' disabled' : ''}`}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={file ? `已选择文件 ${file.name}，点击可更换` : '选择或拖入知识资料文件'}
      aria-disabled={disabled}
      onClick={chooseFile}
      onKeyDown={onKeyDown}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <span className="md-badge"><FileCode2 size={12} /> MD 推荐</span>
      {file ? (
        <div className="selected-file">
          <span className="selected-file-icon"><FileCheck2 size={22} /></span>
          <strong>{file.name}</strong>
          <span>{file.name.split('.').pop()?.toUpperCase()} · {formatBytes(file.size)} · 已就绪</span>
          <button type="button" onClick={removeFile} aria-label={`移除 ${file.name}`} disabled={disabled}><Trash2 size={14} /> 移除</button>
        </div>
      ) : (
        <div className="drop-prompt">
          <span className="drop-icon"><UploadCloud size={25} /></span>
          <strong>{dragging ? '松手即可加入' : '拖入 Markdown 资料'}</strong>
          <span>或点击选择文件</span>
          <small>.md / .markdown 优先 · 最大 20 MB</small>
        </div>
      )}
      <input ref={inputRef} className="file-input" type="file" accept=".md,.markdown,.txt,.pdf,.docx,.html,.htm" onChange={onChange} tabIndex={-1} />
    </div>
  )
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
