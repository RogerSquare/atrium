import { useState, useMemo } from 'react'
import { CheckCircle2, XCircle, MinusCircle, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react'
import { E2E_STATUS_COLOR } from '../constants'

// Surfaces a task's latest Playwright run (e2e_run JSON field) inside the
// task modal. Empty state when the task has never run; per-spec list when
// it has — failed specs expand to show the error and an inline <video>.
//
// Artifact URLs use ?token=<jwt> because the auth middleware reads the
// Authorization header only and <video src> can't carry custom headers.
// See feat-e2e-tests-tab-001-implement Phase 1 auth probe.

function getToken() {
  // The SPA stores the JWT inside the user object at localStorage.taskBoardUser
  // (see frontend/src/config.js apiFetch + AuthContext.jsx). NOT a flat 'token' key.
  try {
    const raw = localStorage.getItem('taskBoardUser')
    if (!raw) return ''
    return JSON.parse(raw).token || ''
  } catch { return '' }
}

function fmtDuration(ms) {
  if (!ms && ms !== 0) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function fmtRelative(iso) {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  const dt = Date.now() - t
  if (dt < 60_000) return 'just now'
  if (dt < 3_600_000) return `${Math.round(dt / 60_000)}m ago`
  if (dt < 86_400_000) return `${Math.round(dt / 3_600_000)}h ago`
  return `${Math.round(dt / 86_400_000)}d ago`
}

function StatusIcon({ status }) {
  if (status === 'passed' || status === 'expected') return <CheckCircle2 className="w-4 h-4" style={{ color: E2E_STATUS_COLOR.passing }} />
  if (status === 'failed' || status === 'unexpected' || status === 'timedOut') return <XCircle className="w-4 h-4" style={{ color: E2E_STATUS_COLOR.failing }} />
  return <MinusCircle className="w-4 h-4" style={{ color: E2E_STATUS_COLOR.skipped }} />
}

function fileUrl(taskId, runId, relPath) {
  const token = getToken()
  return `/api/e2e-runs/${encodeURIComponent(taskId)}/${encodeURIComponent(runId)}/files/${relPath}?token=${encodeURIComponent(token)}`
}

function SpecRow({ taskId, runId, spec }) {
  const [open, setOpen] = useState(spec.status !== 'passed' && spec.status !== 'expected')
  const failed = spec.status === 'failed' || spec.status === 'unexpected' || spec.status === 'timedOut'
  const video = (spec.attachments || []).find((a) => (a.contentType || '').startsWith('video/') && a.path)
  const trace = (spec.attachments || []).find((a) => a.name === 'trace' && a.path)
  return (
    <div style={{ borderBottom: '0.5px solid var(--separator)' }}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full text-left"
        style={{ padding: 'var(--space-2) var(--space-3)', background: 'transparent', border: 'none', cursor: 'pointer' }}
      >
        {open ? <ChevronDown className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-tertiary)' }} /> : <ChevronRight className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-tertiary)' }} />}
        <StatusIcon status={spec.status} />
        <span className="flex-1 truncate" style={{ fontSize: 'var(--text-body)', color: 'var(--text-app)' }}>{spec.title}</span>
        <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }}>{fmtDuration(spec.duration_ms)}</span>
      </button>
      {open && (
        <div style={{ padding: 'var(--space-3) var(--space-3) var(--space-4) var(--space-8)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {/* Always-on metadata grid */}
          <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 'var(--space-3)', rowGap: 'var(--space-1)', fontSize: 'var(--text-caption1)', margin: 0 }}>
            <dt style={{ color: 'var(--text-tertiary)' }}>Status</dt>
            <dd style={{ margin: 0, color: failed ? E2E_STATUS_COLOR.failing : E2E_STATUS_COLOR.passing, fontWeight: 'var(--font-semibold)', textTransform: 'capitalize' }}>{spec.status}</dd>
            <dt style={{ color: 'var(--text-tertiary)' }}>Duration</dt>
            <dd style={{ margin: 0, color: 'var(--text-app)' }}>{fmtDuration(spec.duration_ms)}</dd>
            <dt style={{ color: 'var(--text-tertiary)' }}>File</dt>
            <dd style={{ margin: 0, color: 'var(--text-app)', fontFamily: 'var(--font-mono)' }}>{spec.file || '(unknown)'}</dd>
            <dt style={{ color: 'var(--text-tertiary)' }}>Attachments</dt>
            <dd style={{ margin: 0, color: 'var(--text-app)' }}>{(spec.attachments || []).length}</dd>
          </dl>
          {spec.error && (
            <pre style={{ fontSize: 'var(--text-caption1)', color: E2E_STATUS_COLOR.failing, background: 'var(--fill-secondary)', padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)', whiteSpace: 'pre-wrap', overflowX: 'auto', margin: 0 }}>
              {spec.error}
            </pre>
          )}
          {video && (
            <video
              src={fileUrl(taskId, runId, video.path)}
              controls
              style={{ width: '100%', maxWidth: '720px', borderRadius: 'var(--radius-md)', background: '#000' }}
            />
          )}
          {trace && (
            <a
              href={`https://trace.playwright.dev/?trace=${encodeURIComponent(window.location.origin + fileUrl(taskId, runId, trace.path))}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1"
              style={{ fontSize: 'var(--text-caption1)', color: 'var(--accent-app)' }}
            >
              <ExternalLink className="w-3 h-3" /> Open in Playwright trace viewer
            </a>
          )}
          {!failed && !video && !spec.error && !trace && (
            <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
              No artifacts captured for this spec.
            </span>
          )}
        </div>
      )}
    </div>
  )
}

export default function TestsTab({ task }) {
  const run = task.e2e_run
  const grouped = useMemo(() => {
    if (!run?.specs) return []
    const map = new Map()
    for (const s of run.specs) {
      const key = s.file || '(unknown)'
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(s)
    }
    return Array.from(map.entries())
  }, [run])

  if (!run) {
    return (
      <div className="flex flex-col items-center justify-center" style={{ padding: 'var(--space-8) var(--space-6)', gap: 'var(--space-3)' }}>
        <div style={{ fontSize: 'var(--text-body)', color: 'var(--text-muted)' }}>No Playwright runs yet for this task.</div>
        <pre style={{ fontSize: 'var(--text-caption1)', color: 'var(--text-tertiary)', background: 'var(--fill-secondary)', padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)' }}>
          ATRIUM_API_TOKEN=&lt;token&gt; node backend/scripts/run-e2e.js --task {task.id}
        </pre>
      </div>
    )
  }

  const summaryColor = run.failed > 0 ? E2E_STATUS_COLOR.failing : run.passed > 0 ? E2E_STATUS_COLOR.passing : E2E_STATUS_COLOR.skipped

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto custom-scrollbar">
      <div style={{ padding: 'var(--space-3) var(--space-5)', borderBottom: '0.5px solid var(--separator)', flexShrink: 0 }}>
        <div className="flex items-center gap-2">
          <span style={{ fontSize: 'var(--text-body)', fontWeight: 'var(--font-semibold)', color: summaryColor }}>
            {run.passed}/{run.total} passed
          </span>
          {run.failed > 0 && <span style={{ fontSize: 'var(--text-body)', color: E2E_STATUS_COLOR.failing }}>· {run.failed} failed</span>}
          {run.skipped > 0 && <span style={{ fontSize: 'var(--text-body)', color: 'var(--text-tertiary)' }}>· {run.skipped} skipped</span>}
          <span style={{ fontSize: 'var(--text-caption1)', color: 'var(--text-tertiary)' }}>in {fmtDuration(run.duration_ms)}</span>
          <span className="ml-auto" style={{ fontSize: 'var(--text-caption1)', color: 'var(--text-tertiary)' }}>{fmtRelative(run.started_at)}</span>
        </div>
      </div>
      <div className="flex-1">
        {grouped.map(([file, specs]) => (
          <div key={file}>
            <div style={{ padding: 'var(--space-2) var(--space-3)', background: 'var(--fill-secondary)', fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-semibold)', color: 'var(--text-muted)' }}>
              {file}
            </div>
            {specs.map((spec, i) => (
              <SpecRow key={`${file}-${i}`} taskId={task.id} runId={run.run_id} spec={spec} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
