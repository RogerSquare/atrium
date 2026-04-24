// Facelift detail — Description tab.
//
// Always-editable markdown body (no Edit toggle — plan decision).
// Click the body to start editing; blur saves; Escape reverts.

import { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export default function DetailDescription({ task, onUpdateTask }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(task.content || '')
  const textareaRef = useRef(null)

  useEffect(() => {
    if (!editing) setDraft(task.content || '')
  }, [task.content, editing])

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [editing])

  const save = () => {
    if (draft !== task.content) onUpdateTask(task.id, { content: draft })
    setEditing(false)
  }

  const cancel = () => {
    setDraft(task.content || '')
    setEditing(false)
  }

  if (editing) {
    return (
      <textarea
        ref={textareaRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Escape') cancel()
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save()
        }}
        className="w-full h-full resize-none focus:outline-none"
        style={{
          background: 'var(--fill-secondary)',
          color: 'var(--text-app)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-3)',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-subhead)',
          border: 'var(--border-hairline)',
          minHeight: '400px',
        }}
        placeholder="Task description (Markdown)…"
      />
    )
  }

  return (
    <div
      onClick={() => setEditing(true)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') setEditing(true) }}
      className="prose prose-app max-w-none cursor-text"
      style={{ minHeight: '200px' }}
      title="Click to edit"
    >
      {task.content ? (
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{task.content}</ReactMarkdown>
      ) : (
        <p style={{ fontStyle: 'italic', color: 'var(--text-tertiary)' }}>
          No description yet. Click to add one.
        </p>
      )}
    </div>
  )
}
