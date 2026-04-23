import { useState, useEffect } from 'react'
import { Pencil, Check, X, FileText } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { API_URL, apiFetch } from '../config'

export default function ProjectDescription({ projectName }) {
  const [description, setDescription] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [editedContent, setEditedContent] = useState('')
  const [loading, setLoading] = useState(false)

  const fetchDescription = async () => {
    if (!projectName || projectName === 'All') { setDescription(''); return }
    setLoading(true)
    try {
      const res = await apiFetch(`${API_URL}/projects/${projectName}/description`)
      const data = await res.json()
      setDescription(data.content || '')
      setEditedContent(data.content || '')
    } catch (err) { console.error('Failed to fetch project description:', err) }
    finally { setLoading(false) }
  }

  useEffect(() => { fetchDescription(); setIsEditing(false) }, [projectName])

  const handleSave = async () => {
    try {
      const res = await apiFetch(`${API_URL}/projects/${projectName}/description`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: editedContent }) })
      if (res.ok) { setDescription(editedContent); setIsEditing(false) }
    } catch (err) { console.error('Failed to save:', err) }
  }

  if (!projectName || projectName === 'All' || projectName === 'Root') return null

  return (
    <div className="h-full animate-fade-in" style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', border: 'var(--border-hairline)', overflow: 'hidden' }}>
      <header className="flex justify-between items-center" style={{ padding: '12px 16px', borderBottom: '0.5px solid var(--separator)' }}>
        <div className="flex items-center gap-2">
          <div style={{ padding: '6px', borderRadius: 'var(--radius-sm)', background: 'color-mix(in srgb, var(--accent-app) 12%, transparent)' }}>
            <FileText className="w-4 h-4" style={{ color: 'var(--accent-app)' }} />
          </div>
          <span style={{ fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-semibold)', color: 'var(--text-muted)' }}>
            {projectName}
          </span>
        </div>
        <div className="flex gap-1">
          {!isEditing ? (
            <button onClick={() => setIsEditing(true)} className="apple-press" style={{ padding: '6px', borderRadius: 'var(--radius-xs)', color: 'var(--text-tertiary)' }} title="Edit">
              <Pencil className="w-3.5 h-3.5" />
            </button>
          ) : (
            <>
              <button onClick={() => setIsEditing(false)} className="apple-press" style={{ padding: '6px', borderRadius: 'var(--radius-xs)', color: 'var(--apple-red)' }} title="Cancel">
                <X className="w-3.5 h-3.5" />
              </button>
              <button onClick={handleSave} className="apple-press" style={{ padding: '6px', borderRadius: 'var(--radius-xs)', color: 'var(--apple-green)' }} title="Save">
                <Check className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </header>

      <div style={{ padding: 'var(--space-5)' }}>
        {loading ? (
          <div className="text-center animate-gentle-pulse" style={{ padding: '16px', fontSize: 'var(--text-footnote)', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>Loading...</div>
        ) : isEditing ? (
          <textarea
            value={editedContent}
            onChange={(e) => setEditedContent(e.target.value)}
            className="w-full resize-y focus:outline-none"
            style={{ minHeight: '120px', background: 'var(--fill-secondary)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-footnote)', color: 'var(--text-app)', border: 'none', boxShadow: '0 0 0 3px color-mix(in srgb, var(--accent-app) 20%, transparent)' }}
            placeholder="Project description (Markdown)..."
            autoFocus
          />
        ) : (
          <div className="prose prose-sm max-w-none prose-pre:bg-app-bg prose-pre:border prose-pre:border-app-border prose-p:text-app-text/90 prose-li:text-app-text/90 prose-headings:text-app-text prose-strong:text-app-text prose-a:text-app-accent prose-code:text-app-accent prose-code:bg-app-bg prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-blockquote:border-app-accent prose-blockquote:bg-app-bg/50 prose-hr:border-app-border">
            {description ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{description}</ReactMarkdown>
            ) : (
              <p style={{ fontSize: 'var(--text-footnote)', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>No description. Click the pencil to add one.</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
