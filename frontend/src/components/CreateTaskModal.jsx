import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import ModalOverlay from './ModalOverlay'
import { apiFetch } from '../config'

export default function CreateTaskModal({ projects, activeProject, onClose, onCreateTask }) {
  const [title, setTitle] = useState('')
  const [project, setProject] = useState(activeProject === 'All' ? 'Root' : activeProject)
  const [type, setType] = useState('fullstack')
  const [priority, setPriority] = useState('medium')
  const [description, setDescription] = useState('### Description\nNew task description.\n\n### Comments\n')
  const [tags, setTags] = useState([])
  const [templates, setTemplates] = useState([])
  const [selectedTemplate, setSelectedTemplate] = useState('')

  useEffect(() => {
    apiFetch('/api/tasks/templates')
      .then(r => r.ok ? r.json() : { templates: [] })
      .then(d => setTemplates(d.templates || []))
      .catch(() => setTemplates([]))
  }, [])

  const applyTemplate = (id) => {
    setSelectedTemplate(id)
    if (!id) return
    const t = templates.find(x => x.id === id)
    if (!t?.defaults) return
    if (t.defaults.type) setType(t.defaults.type)
    if (t.defaults.priority) setPriority(t.defaults.priority)
    if (t.defaults.content) setDescription(t.defaults.content)
    if (Array.isArray(t.defaults.tags)) setTags(t.defaults.tags)
  }

  const handleSubmit = (e, status = 'todo') => {
    if (e?.preventDefault) e.preventDefault()
    if (!title.trim()) return
    onCreateTask({ title, project, type, priority, content: description, status, tags })
    onClose()
  }

  const selectStyle = {
    width: '100%',
    background: 'var(--fill-secondary)',
    border: 'none',
    borderRadius: 'var(--radius-md)',
    padding: '10px 14px',
    fontSize: 'var(--text-subhead)',
    color: 'var(--text-app)',
    cursor: 'pointer',
    outline: 'none',
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div
        className="w-full h-full sm:h-auto sm:max-w-2xl flex flex-col overflow-hidden"
        style={{ background: 'var(--bg-card)', borderRadius: '0', boxShadow: 'var(--shadow-xl)' }}
        ref={el => { if (el && window.innerWidth >= 640) el.style.borderRadius = 'var(--radius-xl)' }}
      >
        {/* Header */}
        <header className="shrink-0 flex justify-between items-center" style={{ padding: 'var(--space-4) var(--space-5)', borderBottom: '0.5px solid var(--separator)' }}>
          <h2 style={{ fontSize: 'var(--text-title3)', fontWeight: 'var(--font-semibold)', color: 'var(--text-app)' }}>New Task</h2>
          <button onClick={onClose} className="apple-press" style={{ padding: '8px', borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)' }}>
            <X className="w-[18px] h-[18px]" />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto custom-scrollbar" style={{ padding: 'var(--space-5) var(--space-6)' }}>
          {/* Template picker */}
          {templates.length > 0 && (
            <div style={{ marginBottom: 'var(--space-5)' }}>
              <label style={{ display: 'block', fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-medium)', color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }}>Template (optional)</label>
              <select value={selectedTemplate} onChange={(e) => applyTemplate(e.target.value)} style={selectStyle}>
                <option value="">— None: write from scratch —</option>
                {templates.map(t => (
                  <option key={t.id} value={t.id}>{t.name}{t.description ? ` — ${t.description}` : ''}</option>
                ))}
              </select>
            </div>
          )}

          {/* Title */}
          <div style={{ marginBottom: 'var(--space-5)' }}>
            <label style={{ display: 'block', fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-medium)', color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }}>Title</label>
            <input
              type="text"
              autoFocus
              required
              placeholder="What needs to be done?"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full focus:outline-none"
              style={{
                background: 'var(--fill-secondary)',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                padding: '12px 16px',
                fontSize: 'var(--text-title3)',
                fontWeight: 'var(--font-medium)',
                color: 'var(--text-app)',
              }}
              onFocus={e => e.target.style.boxShadow = '0 0 0 3px color-mix(in srgb, var(--accent-app) 25%, transparent)'}
              onBlur={e => e.target.style.boxShadow = 'none'}
            />
          </div>

          {/* Fields — grouped */}
          <div style={{ padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)', background: 'var(--fill-secondary)', marginBottom: 'var(--space-5)' }}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label style={{ display: 'block', fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-medium)', color: 'var(--text-tertiary)', marginBottom: '4px' }}>Project</label>
                <select value={project} onChange={(e) => setProject(e.target.value)} style={{ ...selectStyle, background: 'var(--bg-card)' }}>
                  {projects.map(p => { const f = p.folder || p; const n = p.name || p; const pid = p.id || null; return <option key={f} value={f}>{f === 'Root' ? 'Unassigned' : n}{pid && pid !== 'root' ? ` (${pid})` : ''}</option> })}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-medium)', color: 'var(--text-tertiary)', marginBottom: '4px' }}>Type</label>
                <select value={type} onChange={(e) => setType(e.target.value)} style={{ ...selectStyle, background: 'var(--bg-card)', textTransform: 'capitalize' }}>
                  <option value="frontend">Frontend</option>
                  <option value="backend">Backend</option>
                  <option value="fullstack">Fullstack</option>
                  <option value="devops">DevOps</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-medium)', color: 'var(--text-tertiary)', marginBottom: '4px' }}>Priority</label>
                <select value={priority} onChange={(e) => setPriority(e.target.value)} style={{ ...selectStyle, background: 'var(--bg-card)', textTransform: 'capitalize' }}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
            </div>
          </div>

          {/* Description */}
          <div>
            <label style={{ display: 'block', fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-medium)', color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }}>Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full resize-y focus:outline-none"
              style={{
                background: 'var(--fill-secondary)',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-4)',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-footnote)',
                color: 'var(--text-app)',
                minHeight: '150px',
              }}
              onFocus={e => e.target.style.boxShadow = '0 0 0 3px color-mix(in srgb, var(--accent-app) 20%, transparent)'}
              onBlur={e => e.target.style.boxShadow = 'none'}
            />
          </div>
        </form>

        {/* Footer */}
        <footer className="shrink-0 flex justify-end gap-3" style={{ padding: 'var(--space-4) var(--space-5)', borderTop: '0.5px solid var(--separator)' }}>
          <button type="button" onClick={onClose} className="apple-press" style={{ padding: '10px 20px', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-subhead)', fontWeight: 'var(--font-medium)', color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>
            Cancel
          </button>
          <button type="button" onClick={(e) => handleSubmit(e, 'draft')} disabled={!title.trim()} className="apple-press" style={{ padding: '10px 20px', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-subhead)', fontWeight: 'var(--font-medium)', color: 'var(--text-app)', background: 'var(--fill-secondary)', border: 'none', cursor: 'pointer', opacity: title.trim() ? 1 : 0.4 }}>
            Save as Draft
          </button>
          <button onClick={(e) => handleSubmit(e, 'todo')} disabled={!title.trim()} className="apple-press text-white" style={{ padding: '10px 24px', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-subhead)', fontWeight: 'var(--font-semibold)', background: 'var(--accent-app)', boxShadow: 'var(--shadow-sm)', border: 'none', cursor: 'pointer', opacity: title.trim() ? 1 : 0.4 }}>
            Create Task
          </button>
        </footer>
      </div>
    </ModalOverlay>
  )
}
