import { useState } from 'react'
import { X } from 'lucide-react'
import ModalOverlay from './ModalOverlay'
import { Button, Input, Select, Checkbox } from './ui'

// Mirror of the backend enums (lib/loops.js). Kept in sync by hand — the
// backend validates anyway, so a drift here just surfaces as a 400.
const WATCH_OPTIONS = [
  { value: 'prs', label: 'Pull requests' },
  { value: 'ci', label: 'CI / checks' },
  { value: 'commits', label: 'Commits / pushes' },
  { value: 'issues', label: 'Issues' },
]
const ACTION_OPTIONS = [
  { value: 'update_fields', label: 'Update task fields' },
  { value: 'comment', label: 'Comment on task' },
  { value: 'ai_summary', label: 'AI summary (hook-tracked agent)' },
]

const labelStyle = {
  display: 'block',
  fontSize: 'var(--text-caption1)',
  fontWeight: 'var(--font-semibold)',
  color: 'var(--text-muted)',
  marginBottom: 'var(--space-1)',
}

function CheckboxRow({ option, checked, onToggle }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer', padding: '3px 0' }}>
      <Checkbox checked={checked} onChange={() => onToggle(option.value)} aria-label={option.label} />
      <span style={{ fontSize: 'var(--text-footnote)', color: 'var(--text-app)' }}>{option.label}</span>
    </label>
  )
}

/**
 * Create/edit a loop. `loop` null = create mode. `onSubmit(body)` returns a
 * promise; the modal stays open and shows the error if it rejects.
 */
export default function LoopModal({ loop, initialProject, projects = [], onSubmit, onClose }) {
  const editing = !!loop
  const [name, setName] = useState(loop?.name || '')
  const [scope, setScope] = useState(loop?.scope || 'project')
  const namedProjects = projects.filter((p) => (p.folder || p) !== 'Root')
  const [project, setProject] = useState(loop?.project || initialProject || namedProjects[0]?.folder || '')
  const [repo, setRepo] = useState(loop?.repo || '')
  const [watch, setWatch] = useState(loop?.watch || ['prs', 'ci'])
  const [actions, setActions] = useState(loop?.actions || ['update_fields', 'comment'])
  const [intervalMin, setIntervalMin] = useState(loop ? Math.round(loop.interval_ms / 60000) : 5)
  const [enabled, setEnabled] = useState(loop ? loop.enabled : true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const toggle = (setter) => (value) =>
    setter((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      await onSubmit({
        name: name.trim(),
        scope,
        project: scope === 'project' ? project : null,
        repo: scope === 'global' ? repo.trim() : null,
        watch,
        actions,
        interval_ms: Math.max(60000, Math.round(Number(intervalMin) * 60000)),
        enabled,
      })
      onClose()
    } catch (err) {
      setError(err.message + (err.details ? ` (${Object.values(err.details).join('; ')})` : ''))
      setSaving(false)
    }
  }

  return (
    <ModalOverlay onClose={onClose} titleId="loop-modal-title">
      <form
        onSubmit={handleSubmit}
        data-testid="loop-modal"
        className="w-full sm:max-w-md"
        style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-popover)', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}
      >
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--space-4)', borderBottom: '0.5px solid var(--separator)' }}>
          <h2 id="loop-modal-title" style={{ fontSize: 'var(--text-subhead)', fontWeight: 'var(--font-semibold)', color: 'var(--text-app)' }}>
            {editing ? 'Edit loop' : 'New loop'}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" style={{ color: 'var(--text-muted)' }}>
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="custom-scrollbar" style={{ padding: 'var(--space-4)', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <div>
            <label style={labelStyle} htmlFor="loop-name">Name</label>
            <Input id="loop-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Atrium PR watcher" fullWidth autoFocus />
          </div>

          <div>
            <label style={labelStyle} htmlFor="loop-scope">Scope</label>
            <Select id="loop-scope" fullWidth value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="project">Project</option>
              <option value="global">Independent (repo)</option>
            </Select>
          </div>

          {scope === 'project' ? (
            <div>
              <label style={labelStyle} htmlFor="loop-project">Project</label>
              <Select id="loop-project" fullWidth value={project} onChange={(e) => setProject(e.target.value)}>
                {namedProjects.length === 0 && <option value="">(no projects)</option>}
                {namedProjects.map((p) => (
                  <option key={p.id || p.folder} value={p.folder || p}>{p.name || p.folder || p}</option>
                ))}
              </Select>
            </div>
          ) : (
            <div>
              <label style={labelStyle} htmlFor="loop-repo">Repository (owner/name)</label>
              <Input id="loop-repo" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="RogerSquare/atrium" fullWidth />
            </div>
          )}

          <div>
            <span style={labelStyle}>Watch</span>
            {WATCH_OPTIONS.map((o) => (
              <CheckboxRow key={o.value} option={o} checked={watch.includes(o.value)} onToggle={toggle(setWatch)} />
            ))}
          </div>

          <div>
            <span style={labelStyle}>On change</span>
            {ACTION_OPTIONS.map((o) => (
              <CheckboxRow key={o.value} option={o} checked={actions.includes(o.value)} onToggle={toggle(setActions)} />
            ))}
          </div>

          <div>
            <label style={labelStyle} htmlFor="loop-interval">Poll interval (minutes)</label>
            <Input id="loop-interval" type="number" min="1" value={intervalMin} onChange={(e) => setIntervalMin(e.target.value)} fullWidth />
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer' }}>
            <Checkbox checked={enabled} onChange={(e) => setEnabled(e.target.checked)} aria-label="Enabled" />
            <span style={{ fontSize: 'var(--text-footnote)', color: 'var(--text-app)' }}>Enabled</span>
          </label>

          {error && (
            <div style={{ fontSize: 'var(--text-caption1)', color: 'var(--apple-red)' }}>{error}</div>
          )}
        </div>

        <footer style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', padding: 'var(--space-4)', borderTop: '0.5px solid var(--separator)' }}>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving} disabled={saving || !name.trim() || watch.length === 0}>
            {editing ? 'Save' : 'Create'}
          </Button>
        </footer>
      </form>
    </ModalOverlay>
  )
}
