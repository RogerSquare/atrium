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
const DAY_OPTIONS = [
  { value: 'mon', label: 'Mon' }, { value: 'tue', label: 'Tue' }, { value: 'wed', label: 'Wed' },
  { value: 'thu', label: 'Thu' }, { value: 'fri', label: 'Fri' }, { value: 'sat', label: 'Sat' }, { value: 'sun', label: 'Sun' },
]
const ALL_DAYS = DAY_OPTIONS.map((d) => d.value)
// UI mirror of WORKER_DEFAULTS (lib/loops.js)
const WORKER_DEFAULTS = {
  base_branch: 'main', branch_prefix: 'loop/',
  setup_command: '', test_command: '', lint_command: '', build_command: '',
  require_checks_pass: true, open_pr: true, draft_pr: false, max_runs_per_day: 10,
}

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
  const [mode, setMode] = useState(loop?.mode || 'watcher')
  const [enabled, setEnabled] = useState(loop ? loop.enabled : true)
  // Trigger (feat-hub-rethink-impl-001): interval polling OR daily at a time.
  const [trigger, setTrigger] = useState(loop?.schedule ? 'schedule' : 'interval')
  const [schedTime, setSchedTime] = useState(loop?.schedule?.time || '09:00')
  const [schedDays, setSchedDays] = useState(loop?.schedule?.days || ALL_DAYS)
  // Playbook instructions (required for playbook mode — the playbook IS the prompt).
  const [instructions, setInstructions] = useState(loop?.instructions || '')
  // Worker execution params, surfaced at last.
  const [worker, setWorker] = useState({ ...WORKER_DEFAULTS, ...(loop?.worker || {}) })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const toggle = (setter) => (value) =>
    setter((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]))
  const setW = (field) => (value) => setWorker((prev) => ({ ...prev, [field]: value }))

  const isPlaybook = mode === 'playbook'
  const isWorker = mode === 'worker'
  const submitDisabled = saving || !name.trim()
    || (mode === 'watcher' && watch.length === 0)
    || (isPlaybook && !instructions.trim())
    || (trigger === 'schedule' && schedDays.length === 0)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      await onSubmit({
        name: name.trim(),
        scope,
        project: scope === 'project' ? project : null,
        repo: scope === 'global' && !isPlaybook ? repo.trim() : null,
        watch,
        actions,
        mode,
        interval_ms: Math.max(60000, Math.round(Number(intervalMin) * 60000)),
        schedule: trigger === 'schedule' ? { time: schedTime, days: schedDays } : null,
        enabled,
        ...(isPlaybook ? { instructions } : {}),
        ...(isWorker ? { worker: { ...worker, max_runs_per_day: Math.max(0, Math.round(Number(worker.max_runs_per_day) || 0)) } } : {}),
      })
      onClose()
    } catch (err) {
      setError(err.message + (err.details ? ` (${Object.values(err.details).join('; ')})` : ''))
      setSaving(false)
    }
  }

  const workerText = (id, label, field, placeholder = '') => (
    <div>
      <label style={labelStyle} htmlFor={id}>{label}</label>
      <Input id={id} value={worker[field] ?? ''} onChange={(e) => setW(field)(e.target.value)} placeholder={placeholder} fullWidth />
    </div>
  )

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
              <option value="global">{isPlaybook ? 'Standalone (no project)' : 'Independent (repo)'}</option>
            </Select>
          </div>

          <div>
            <label style={labelStyle} htmlFor="loop-mode">Mode</label>
            <Select id="loop-mode" fullWidth value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="watcher">Watcher — react to GitHub changes</option>
              <option value="worker">Worker — autonomously pick up & execute todo tasks</option>
              <option value="playbook">Playbook — run written instructions on a schedule</option>
            </Select>
            {isWorker && (
              <div style={{ marginTop: '4px', fontSize: 'var(--text-caption2)', color: 'var(--apple-orange)' }}>
                ⚠ When enabled, this loop will claim todo tasks in the project and let an agent implement them up to a PR (never merges). Review the Instructions tab first; keep it disabled until you trust it.
              </div>
            )}
            {isPlaybook && (
              <div style={{ marginTop: '4px', fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }}>
                No GitHub involved — each run executes your playbook (no tools) and lands in the run history.
              </div>
            )}
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
          ) : !isPlaybook ? (
            <div>
              <label style={labelStyle} htmlFor="loop-repo">Repository (owner/name)</label>
              <Input id="loop-repo" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="RogerSquare/atrium" fullWidth />
            </div>
          ) : null}

          {isPlaybook && (
            <div>
              <label style={labelStyle} htmlFor="loop-playbook">Playbook (required — this is the prompt)</label>
              <textarea
                id="loop-playbook"
                data-testid="loop-playbook-instructions"
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="e.g. Summarize the project's open work: what moved, what's stuck, what needs the human next."
                spellCheck={false}
                style={{ width: '100%', minHeight: 120, padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)', border: '0.5px solid var(--separator)', background: 'var(--fill-secondary)', color: 'var(--text-app)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-caption2)', resize: 'vertical' }}
              />
            </div>
          )}

          {!isPlaybook && (
            <div>
              <span style={labelStyle}>Watch</span>
              {WATCH_OPTIONS.map((o) => (
                <CheckboxRow key={o.value} option={o} checked={watch.includes(o.value)} onToggle={toggle(setWatch)} />
              ))}
            </div>
          )}

          {!isPlaybook && (
            <div>
              <span style={labelStyle}>On change</span>
              {ACTION_OPTIONS.map((o) => (
                <CheckboxRow key={o.value} option={o} checked={actions.includes(o.value)} onToggle={toggle(setActions)} />
              ))}
            </div>
          )}

          <div>
            <span style={labelStyle}>Trigger</span>
            <div role="radiogroup" aria-label="Trigger" style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
              {[['interval', 'Every N minutes'], ['schedule', 'Daily at a time']].map(([v, l]) => (
                <label key={v} style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: 'var(--text-footnote)', color: 'var(--text-app)' }}>
                  <input type="radio" name="loop-trigger" value={v} checked={trigger === v} onChange={() => setTrigger(v)} data-testid={`loop-trigger-${v}`} />
                  {l}
                </label>
              ))}
            </div>
            {trigger === 'interval' ? (
              <div>
                <label style={labelStyle} htmlFor="loop-interval">Poll interval (minutes)</label>
                <Input id="loop-interval" type="number" min="1" value={intervalMin} onChange={(e) => setIntervalMin(e.target.value)} fullWidth />
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                <div>
                  <label style={labelStyle} htmlFor="loop-sched-time">Time (server-local)</label>
                  <Input id="loop-sched-time" data-testid="loop-schedule-time" type="time" value={schedTime} onChange={(e) => setSchedTime(e.target.value)} fullWidth />
                </div>
                <div>
                  <span style={labelStyle}>Days</span>
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                    {DAY_OPTIONS.map((d) => {
                      const on = schedDays.includes(d.value)
                      return (
                        <button
                          key={d.value}
                          type="button"
                          data-testid={`loop-day-${d.value}`}
                          aria-pressed={on}
                          onClick={() => toggle(setSchedDays)(d.value)}
                          className="apple-press"
                          style={{
                            padding: '3px 8px', borderRadius: 'var(--radius-full)', fontSize: 'var(--text-caption2)',
                            border: '0.5px solid var(--separator)', cursor: 'pointer',
                            background: on ? 'var(--accent-app)' : 'var(--fill-secondary)',
                            color: on ? '#fff' : 'var(--text-muted)',
                          }}
                        >
                          {d.label}
                        </button>
                      )
                    })}
                  </div>
                  {schedDays.length === 0 && (
                    <div style={{ marginTop: '4px', fontSize: 'var(--text-caption2)', color: 'var(--apple-red)' }}>Pick at least one day.</div>
                  )}
                </div>
              </div>
            )}
          </div>

          {isWorker && (
            <div data-testid="loop-worker-section" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', padding: 'var(--space-3)', border: '0.5px solid var(--separator)', borderRadius: 'var(--radius-sm)' }}>
              <span style={{ ...labelStyle, marginBottom: 0 }}>Worker execution</span>
              {workerText('loop-w-base', 'Base branch', 'base_branch', 'main')}
              {workerText('loop-w-prefix', 'Branch prefix', 'branch_prefix', 'loop/')}
              {workerText('loop-w-setup', 'Setup command', 'setup_command', 'npm install')}
              {workerText('loop-w-test', 'Test command', 'test_command', 'npm test')}
              {workerText('loop-w-lint', 'Lint command', 'lint_command', 'npm run lint')}
              {workerText('loop-w-build', 'Build command', 'build_command', 'npm run build')}
              <div>
                <label style={labelStyle} htmlFor="loop-w-cap">Max runs per day (0 = unlimited)</label>
                <Input id="loop-w-cap" data-testid="loop-worker-cap" type="number" min="0" value={worker.max_runs_per_day} onChange={(e) => setW('max_runs_per_day')(e.target.value)} fullWidth />
              </div>
              {[['require_checks_pass', 'Checks must pass before the PR'], ['open_pr', 'Open a PR when done'], ['draft_pr', 'PR as draft']].map(([f, l]) => (
                <label key={f} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer' }}>
                  <Checkbox checked={!!worker[f]} onChange={(e) => setW(f)(e.target.checked)} aria-label={l} />
                  <span style={{ fontSize: 'var(--text-footnote)', color: 'var(--text-app)' }}>{l}</span>
                </label>
              ))}
            </div>
          )}

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
          <Button type="submit" variant="primary" loading={saving} disabled={submitDisabled}>
            {editing ? 'Save' : 'Create'}
          </Button>
        </footer>
      </form>
    </ModalOverlay>
  )
}
