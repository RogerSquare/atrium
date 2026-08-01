import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import ModalOverlay from './ModalOverlay'
import { apiFetch } from '../config'
import { Button, IconButton, Input, Select } from './ui'
import { TASK_ID_REGEX, CATEGORIES, nextTaskId } from '../lib/taskId'

const TASK_ID_HELPER = 'Format: category-descriptor-NNN (e.g. feat-auth-001). Category: feat, bug, ui, opt, comp, devops, mobile.'

// The workflow controls below write these tags — previously they were magic
// strings the user had to know to type (ui-create-dejargon-001).
const PHASE_OPTIONS = [
  { id: '', label: 'None — a regular single-phase task' },
  { id: 'phase-research', label: 'Research — read the code, report findings (no code)' },
  { id: 'phase-plan', label: 'Plan — produce a phased plan from research (no code)' },
  { id: 'phase-implement', label: 'Implement — execute an approved plan' },
]
const FLAG_TOGGLES = [
  { tag: 'tdd', label: 'Test-driven', hint: 'Agent must follow red-green-refactor while implementing' },
  { tag: 'no-code', label: 'No code ships', hint: 'Docs / research / config only — skips the branch + PR requirement' },
  { tag: 'no-e2e', label: 'No UI surface', hint: 'Backend or infra only — skips the Playwright e2e requirement' },
]
const PHASE_TAGS = ['phase-research', 'phase-plan', 'phase-implement']

export default function CreateTaskModal({ projects, activeProject, onClose, onCreateTask, tasks = [] }) {
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('feat')
  const [idOverride, setIdOverride] = useState('')
  const [project, setProject] = useState(activeProject === 'All' ? 'Root' : activeProject)
  const [type, setType] = useState('fullstack')
  const [priority, setPriority] = useState('medium')
  const [description, setDescription] = useState('### Description\nNew task description.\n\n### Comments\n')
  const [tags, setTags] = useState([])
  const [templates, setTemplates] = useState([])
  const [selectedTemplate, setSelectedTemplate] = useState('')

  // The id is derived (accepted default Q10) — hand-authoring survives as an
  // advanced override, validated by the same regex the backend enforces.
  const autoId = nextTaskId(category, title, tasks)
  const overrideValid = TASK_ID_REGEX.test(idOverride)
  const taskId = idOverride ? idOverride : autoId
  const canSubmit = Boolean(title.trim()) && (idOverride === '' || overrideValid)

  const phaseTag = tags.find(t => PHASE_TAGS.includes(t)) || ''
  const setPhaseTag = (next) => {
    setTags(prev => {
      const rest = prev.filter(t => !PHASE_TAGS.includes(t))
      return next ? [...rest, next] : rest
    })
  }
  const toggleFlag = (tag) => {
    setTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])
  }

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
    if (!canSubmit) return
    onCreateTask({ id: taskId, title, project, type, priority, content: description, status, tags })
    onClose()
  }

  return (
    <ModalOverlay onClose={onClose} titleId="create-task-title">
      <div
        className="w-full h-full sm:h-auto sm:max-h-[85vh] sm:max-w-2xl flex flex-col overflow-hidden"
        style={{ background: 'var(--bg-card)', borderRadius: '0', boxShadow: 'var(--shadow-popover)' }}
        ref={el => { if (el && window.innerWidth >= 640) el.style.borderRadius = 'var(--radius-md)' }}
      >
        {/* Header */}
        <header className="shrink-0 flex justify-between items-center" style={{ padding: 'var(--space-4) var(--space-5)', borderBottom: '0.5px solid var(--separator)' }}>
          <h2 id="create-task-title" style={{ fontSize: 'var(--text-title3)', fontWeight: 'var(--font-semibold)', color: 'var(--text-app)' }}>New Task</h2>
          <IconButton onClick={onClose} title="Close" aria-label="Close">
            <X className="w-[18px] h-[18px]" />
          </IconButton>
        </header>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto custom-scrollbar" style={{ padding: 'var(--space-5) var(--space-6)' }}>
          {/* Template picker */}
          {templates.length > 0 && (
            <div style={{ marginBottom: 'var(--space-5)' }}>
              <label style={{ display: 'block', fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-medium)', color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }}>Template (optional)</label>
              <Select fullWidth value={selectedTemplate} onChange={(e) => applyTemplate(e.target.value)}>
                <option value="">— None: write from scratch —</option>
                {templates.map(t => (
                  <option key={t.id} value={t.id}>{t.name}{t.description ? ` — ${t.description}` : ''}</option>
                ))}
              </Select>
            </div>
          )}

          {/* Title */}
          <div style={{ marginBottom: 'var(--space-5)' }}>
            <label style={{ display: 'block', fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-medium)', color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }}>Title</label>
            <Input
              type="text"
              size="lg"
              autoFocus
              required
              placeholder="What needs to be done?"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full"
            />
          </div>

          {/* Category + derived id (ui-create-dejargon-001). The id used to be
              a mandatory hand-authored regex-gated field — the biggest
              first-session jargon wall. */}
          <div style={{ marginBottom: 'var(--space-5)' }}>
            <label style={{ display: 'block', fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-medium)', color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }}>Kind of work</label>
            <Select fullWidth value={category} onChange={(e) => setCategory(e.target.value)} data-testid="create-category">
              {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </Select>
            <div className="flex items-center gap-2" style={{ marginTop: 'var(--space-2)' }}>
              <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }}>Task id</span>
              <span
                data-testid="create-id-preview"
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--text-caption2)',
                  color: idOverride && !overrideValid ? 'var(--apple-red)' : 'var(--text-muted)',
                  background: 'var(--fill-secondary)',
                  padding: '2px 8px',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                {taskId}
              </span>
              <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }}>
                {idOverride ? (overrideValid ? 'manual override' : 'override is invalid') : 'generated automatically'}
              </span>
            </div>
            <details style={{ marginTop: 'var(--space-2)' }}>
              <summary style={{ cursor: 'pointer', fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }}>
                Advanced: set the id manually
              </summary>
              <Input
                type="text"
                placeholder={autoId}
                value={idOverride}
                onChange={(e) => setIdOverride(e.target.value.trim())}
                variant={idOverride && !overrideValid ? 'error' : 'default'}
                className="w-full"
                data-testid="create-id-override"
                style={{ marginTop: 'var(--space-2)', fontFamily: 'var(--font-mono, ui-monospace, monospace)' }}
              />
              <div
                style={{
                  marginTop: 'var(--space-1)',
                  fontSize: 'var(--text-caption2)',
                  color: idOverride && !overrideValid ? 'var(--apple-red)' : 'var(--text-tertiary)',
                }}
              >
                {idOverride && !overrideValid ? `"${idOverride}" doesn't match the format. ` : ''}{TASK_ID_HELPER} Leave empty to auto-generate.
              </div>
            </details>
          </div>

          {/* Fields — grouped */}
          <div style={{ padding: 'var(--space-4)', borderRadius: 'var(--radius-md)', background: 'var(--fill-secondary)', marginBottom: 'var(--space-5)' }}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label style={{ display: 'block', fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-medium)', color: 'var(--text-tertiary)', marginBottom: 'var(--space-1)' }}>Project</label>
                <Select fullWidth value={project} onChange={(e) => setProject(e.target.value)}>
                  {projects.map(p => { const f = p.folder || p; const n = p.name || p; const pid = p.id || null; return <option key={f} value={f}>{f === 'Root' ? 'Unassigned' : n}{pid && pid !== 'root' ? ` (${pid})` : ''}</option> })}
                </Select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-medium)', color: 'var(--text-tertiary)', marginBottom: 'var(--space-1)' }}>Type</label>
                <Select fullWidth value={type} onChange={(e) => setType(e.target.value)} style={{ textTransform: 'capitalize' }}>
                  <option value="frontend">Frontend</option>
                  <option value="backend">Backend</option>
                  <option value="fullstack">Fullstack</option>
                  <option value="devops">DevOps</option>
                </Select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-medium)', color: 'var(--text-tertiary)', marginBottom: 'var(--space-1)' }}>Priority</label>
                <Select fullWidth value={priority} onChange={(e) => setPriority(e.target.value)} style={{ textTransform: 'capitalize' }}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </Select>
              </div>
            </div>
          </div>

          {/* Workflow — labeled controls that write the tags agents key off
              (previously magic strings typed into a comma field). */}
          <div style={{ padding: 'var(--space-4)', borderRadius: 'var(--radius-md)', background: 'var(--fill-secondary)', marginBottom: 'var(--space-5)' }}>
            <div style={{ marginBottom: 'var(--space-3)' }}>
              <label style={{ display: 'block', fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-medium)', color: 'var(--text-tertiary)', marginBottom: 'var(--space-1)' }}>Workflow phase</label>
              <Select fullWidth value={phaseTag} onChange={(e) => setPhaseTag(e.target.value)} data-testid="create-phase">
                {PHASE_OPTIONS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              {FLAG_TOGGLES.map(f => (
                <label key={f.tag} className="flex items-start gap-2 cursor-pointer" title={f.hint}>
                  <input
                    type="checkbox"
                    checked={tags.includes(f.tag)}
                    onChange={() => toggleFlag(f.tag)}
                    data-testid={`create-flag-${f.tag}`}
                    style={{ marginTop: '2px' }}
                  />
                  <span>
                    <span style={{ fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-medium)', color: 'var(--text-app)' }}>{f.label}</span>
                    <span className="block" style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }}>{f.hint}</span>
                  </span>
                </label>
              ))}
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
          <Button type="button" variant="ghost" size="md" onClick={onClose} pill={false}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="md"
            onClick={(e) => handleSubmit(e, 'draft')}
            disabled={!canSubmit}
            pill={false}
            style={{ opacity: canSubmit ? 1 : 0.5 }}
          >
            Save as Draft
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={(e) => handleSubmit(e, 'todo')}
            disabled={!canSubmit}
            pill={false}
            style={{ opacity: canSubmit ? 1 : 0.5 }}
          >
            Create Task
          </Button>
        </footer>
      </div>
    </ModalOverlay>
  )
}
