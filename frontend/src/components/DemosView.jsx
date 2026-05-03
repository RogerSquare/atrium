import { useEffect, useState, useCallback } from 'react'
import { ExternalLink, FlaskConical, RefreshCw } from 'lucide-react'
import { apiFetch } from '../config'
import { E2E_STATUS_COLOR } from '../constants'

// Top-level "Demos" view — lists every directory under frontend/public/
// that contains an index.html, with cross-links to each demo's spec, the
// task that produced it, and the most recent Playwright run.
//
// Read-only v1 (see feat-demo-management-001-implement plan): no scaffold,
// no delete, no archive. Adding/removing demos happens via PR.

function fmtRelative(iso) {
  if (!iso) return ''
  const dt = Date.now() - new Date(iso).getTime()
  if (dt < 60_000) return 'just now'
  if (dt < 3_600_000) return `${Math.round(dt / 60_000)}m ago`
  if (dt < 86_400_000) return `${Math.round(dt / 3_600_000)}h ago`
  return `${Math.round(dt / 86_400_000)}d ago`
}

function DemoCard({ demo, onSelectTask, tasks }) {
  const tested = !!demo.spec_file
  const run = demo.latest_run
  const taskId = run?.task_id
  const handleTaskClick = useCallback(() => {
    if (!taskId) return
    const task = tasks.find((t) => t.id === taskId)
    if (task && onSelectTask) onSelectTask(task)
  }, [taskId, tasks, onSelectTask])

  return (
    <div
      data-testid="demo-card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
        padding: 'var(--space-4) var(--space-5)',
        background: 'var(--bg-card)',
        border: '0.5px solid var(--separator)',
        borderRadius: 'var(--radius-md)',
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div style={{ fontSize: 'var(--text-body)', fontWeight: 'var(--font-semibold)', color: 'var(--text-app)' }}>
            {demo.title}
          </div>
          <div style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', marginTop: 'var(--space-1)' }}>
            /{demo.slug}/
          </div>
        </div>
        <a
          data-testid="demo-open-link"
          href={demo.path}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 apple-press"
          style={{
            padding: 'var(--space-1) var(--space-3)',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--accent-app)',
            color: 'white',
            fontSize: 'var(--text-caption1)',
            fontWeight: 'var(--font-semibold)',
            whiteSpace: 'nowrap',
          }}
        >
          <ExternalLink className="w-3 h-3" /> Open
        </a>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span
          className="inline-flex items-center gap-1"
          style={{
            padding: '2px 8px',
            borderRadius: 'var(--radius-full)',
            fontSize: 'var(--text-caption2)',
            fontWeight: 'var(--font-semibold)',
            color: tested ? E2E_STATUS_COLOR.passing : E2E_STATUS_COLOR.skipped,
            background: `color-mix(in srgb, ${tested ? E2E_STATUS_COLOR.passing : E2E_STATUS_COLOR.skipped} 12%, transparent)`,
          }}
        >
          <FlaskConical className="w-3 h-3" />
          {tested ? `tested · ${demo.spec_file}` : 'untested'}
        </span>
        {taskId && (
          <button
            data-testid="demo-task-chip"
            onClick={handleTaskClick}
            className="inline-flex items-center gap-1 apple-press"
            style={{
              padding: '2px 8px',
              borderRadius: 'var(--radius-full)',
              border: 'none',
              background: 'var(--fill-secondary)',
              color: 'var(--text-app)',
              fontSize: 'var(--text-caption2)',
              fontWeight: 'var(--font-medium)',
              fontFamily: 'var(--font-mono)',
              cursor: 'pointer',
            }}
            title={`Open task ${taskId}`}
          >
            {taskId}
          </button>
        )}
        {run?.started_at && (
          <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }}>
            last run {fmtRelative(run.started_at)}{run.status ? ` · ${run.status}` : ''}
          </span>
        )}
      </div>
    </div>
  )
}

export default function DemosView({ tasks = [], onSelectTask }) {
  const [demos, setDemos] = useState([])
  const [state, setState] = useState('loading') // 'loading' | 'ok' | 'error'
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setState('loading')
    setError(null)
    try {
      const res = await apiFetch('/api/demos')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = await res.json()
      setDemos(Array.isArray(body) ? body : [])
      setState('ok')
    } catch (e) {
      setError(e.message)
      setState('error')
    }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div
      data-testid="demos-view"
      className="flex-1 flex flex-col min-h-0 overflow-y-auto custom-scrollbar"
      style={{ padding: 'var(--space-5) var(--space-6)' }}
    >
      <div className="flex items-center gap-3" style={{ marginBottom: 'var(--space-4)' }}>
        <h1 style={{ fontSize: 'var(--text-title2)', fontWeight: 'var(--font-semibold)', color: 'var(--text-app)' }}>
          Demos
        </h1>
        <span
          style={{
            padding: '2px 8px',
            borderRadius: 'var(--radius-full)',
            background: 'var(--fill-secondary)',
            color: 'var(--text-muted)',
            fontSize: 'var(--text-caption1)',
            fontWeight: 'var(--font-semibold)',
          }}
        >
          {demos.length}
        </span>
      </div>

      {state === 'loading' && (
        <div className="text-center py-12 italic animate-pulse" style={{ color: 'var(--text-muted)' }}>
          Loading demos…
        </div>
      )}

      {state === 'error' && (
        <div className="flex flex-col items-center justify-center" style={{ padding: 'var(--space-8) var(--space-6)', gap: 'var(--space-3)' }}>
          <div style={{ fontSize: 'var(--text-body)', color: E2E_STATUS_COLOR.failing }}>
            Could not load demos: {error}
          </div>
          <button
            onClick={load}
            className="inline-flex items-center gap-1 apple-press"
            style={{
              padding: 'var(--space-1) var(--space-3)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--fill-secondary)',
              color: 'var(--text-app)',
              fontSize: 'var(--text-caption1)',
              fontWeight: 'var(--font-medium)',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            <RefreshCw className="w-3 h-3" /> Retry
          </button>
        </div>
      )}

      {state === 'ok' && demos.length === 0 && (
        <div className="flex flex-col items-center justify-center" style={{ padding: 'var(--space-8) var(--space-6)', gap: 'var(--space-3)' }}>
          <div style={{ fontSize: 'var(--text-body)', color: 'var(--text-muted)' }}>No demos found.</div>
          <div style={{ fontSize: 'var(--text-caption1)', color: 'var(--text-tertiary)', maxWidth: '480px', textAlign: 'center' }}>
            Add a directory under <code>frontend/public/&lt;slug&gt;/</code> with an <code>index.html</code> to make it appear here.
            Pair it with a Playwright spec at <code>frontend/tests/e2e/&lt;slug&gt;.spec.js</code> for cross-linked test runs.
          </div>
        </div>
      )}

      {state === 'ok' && demos.length > 0 && (
        <div className="flex flex-col gap-3" style={{ maxWidth: '720px' }}>
          {demos.map((demo) => (
            <DemoCard key={demo.slug} demo={demo} onSelectTask={onSelectTask} tasks={tasks} />
          ))}
        </div>
      )}
    </div>
  )
}
