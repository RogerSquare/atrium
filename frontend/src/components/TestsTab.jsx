import { useState, useMemo, useEffect } from 'react'
import { CheckCircle2, XCircle, MinusCircle, ChevronDown, ChevronRight, ExternalLink, Play, FileText } from 'lucide-react'
import { E2E_STATUS_COLOR } from '../constants'
import { apiFetch } from '../config'

// Surfaces a task's latest test run (e2e_run JSON field) — ANY runner's
// (ui-tests-tab-generic-001): Playwright runs keep their video/trace UX;
// JUnit/exit-code runs (Swift, pytest, gradle, …) render the same per-spec
// rows plus a generic artifact list (junit.xml, job logs). The header shows
// suite + source provenance, and a suite selector appears when the task's
// project declares multiple suites in atrium.tests.json.
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
  // Auto-show video for failures (forensic evidence); keep it collapsed for
  // passing specs since the videos are largely interchangeable run-to-run.
  const [showVideo, setShowVideo] = useState(failed)
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
          {video && !showVideo && (
            <button
              onClick={() => setShowVideo(true)}
              className="inline-flex items-center gap-1 self-start apple-press"
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
              <Play className="w-3 h-3" /> Show video
            </button>
          )}
          {video && showVideo && (
            <video
              src={fileUrl(taskId, runId, video.path)}
              controls
              autoPlay={failed}
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

// Chip for the provenance stamps (feat-runners-core-001 Q5).
function ProvenanceChip({ children }) {
  return (
    <span
      style={{
        fontSize: 'var(--text-caption2)',
        fontFamily: 'var(--font-mono)',
        color: 'var(--text-muted)',
        background: 'var(--fill-secondary)',
        padding: '2px 8px',
        borderRadius: 'var(--radius-full)',
      }}
    >
      {children}
    </span>
  )
}

// The run-level artifact list for non-Playwright runs (junit.xml, job logs).
// Playwright runs skip this: their run dir holds the whole HTML report tree
// (hundreds of files) and their forensics are the per-spec video/trace.
function RunArtifacts({ taskId, runId }) {
  const [files, setFiles] = useState(null)
  useEffect(() => {
    let cancelled = false
    apiFetch(`/api/e2e-runs/${encodeURIComponent(taskId)}/${encodeURIComponent(runId)}/files`)
      .then((r) => (r.ok ? r.json() : { files: [] }))
      .then((d) => { if (!cancelled) setFiles(Array.isArray(d.files) ? d.files : []) })
      .catch(() => { if (!cancelled) setFiles([]) })
    return () => { cancelled = true }
  }, [taskId, runId])

  if (!files || files.length === 0) return null
  return (
    <div data-testid="run-artifacts" style={{ padding: 'var(--space-2) var(--space-5)', borderBottom: '0.5px solid var(--separator)' }}>
      <div style={{ fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-semibold)', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', marginBottom: 'var(--space-1)' }}>
        Artifacts
      </div>
      <div className="flex flex-wrap gap-2">
        {files.map((f) => (
          <a
            key={f.path}
            href={fileUrl(taskId, runId, f.path)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1"
            data-testid="run-artifact-link"
            style={{ fontSize: 'var(--text-caption1)', color: 'var(--accent-app)' }}
          >
            <FileText className="w-3 h-3" /> {f.path}
            <span style={{ color: 'var(--text-tertiary)' }}>({f.size < 1024 ? `${f.size} B` : `${Math.round(f.size / 1024)} KB`})</span>
          </a>
        ))}
      </div>
    </div>
  )
}

export default function TestsTab({ task }) {
  const run = task.e2e_run
  // The suites the task's project DECLARES (atrium.tests.json) — drives the
  // empty-state hint and the multi-suite selector. Stored WITH the project
  // they belong to and derived below, so switching tasks never renders a
  // stale project's suites and no state reset is needed in the effect.
  const [suitesResult, setSuitesResult] = useState({ project: null, suites: [] })
  const [selectedSuite, setSelectedSuite] = useState('')

  useEffect(() => {
    const project = task.project
    if (!project || project === 'Root' || project === 'All') return undefined
    let cancelled = false
    apiFetch(`/api/runners/suites?project=${encodeURIComponent(project)}`)
      .then((r) => (r.ok ? r.json() : { suites: [] }))
      .then((d) => { if (!cancelled) setSuitesResult({ project, suites: Array.isArray(d.suites) ? d.suites : [] }) })
      .catch(() => { if (!cancelled) setSuitesResult({ project, suites: [] }) })
    return () => { cancelled = true }
  }, [task.project])

  const suites = suitesResult.project === task.project ? suitesResult.suites : []

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

  // Legacy runs predate the provenance stamps — treat them as Playwright.
  const isPlaywrightRun = !run?.source || run.source === 'playwright-json'
  const activeSuiteId = selectedSuite || run?.suite || suites[0]?.id || ''
  const runHint = activeSuiteId && activeSuiteId !== 'playwright-e2e'
    ? `atrium_run_tests { task: "${task.id}", suite: "${activeSuiteId}" }`
    : `atrium_run_tests { task: "${task.id}" }`

  if (!run) {
    return (
      <div className="flex flex-col items-center justify-center" style={{ padding: 'var(--space-8) var(--space-6)', gap: 'var(--space-3)' }}>
        <div style={{ fontSize: 'var(--text-body)', color: 'var(--text-muted)' }}>No test runs yet for this task.</div>
        {suites.length > 0 && (
          <div data-testid="tests-empty-suites" className="flex items-center gap-2 flex-wrap justify-center">
            <span style={{ fontSize: 'var(--text-caption1)', color: 'var(--text-tertiary)' }}>
              {task.project} declares {suites.length} suite{suites.length > 1 ? 's' : ''}:
            </span>
            {suites.map((s) => <ProvenanceChip key={s.id}>{s.id}</ProvenanceChip>)}
          </div>
        )}
        <pre style={{ fontSize: 'var(--text-caption1)', color: 'var(--text-tertiary)', background: 'var(--fill-secondary)', padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)' }}>
          {runHint}
        </pre>
      </div>
    )
  }

  const summaryColor = run.failed > 0 ? E2E_STATUS_COLOR.failing : run.passed > 0 ? E2E_STATUS_COLOR.passing : E2E_STATUS_COLOR.skipped

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto custom-scrollbar">
      <div style={{ padding: 'var(--space-3) var(--space-5)', borderBottom: '0.5px solid var(--separator)', flexShrink: 0 }}>
        <div className="flex items-center gap-2 flex-wrap">
          <span style={{ fontSize: 'var(--text-body)', fontWeight: 'var(--font-semibold)', color: summaryColor }}>
            {run.passed}/{run.total} passed
          </span>
          {run.failed > 0 && <span style={{ fontSize: 'var(--text-body)', color: E2E_STATUS_COLOR.failing }}>· {run.failed} failed</span>}
          {run.skipped > 0 && <span style={{ fontSize: 'var(--text-body)', color: 'var(--text-tertiary)' }}>· {run.skipped} skipped</span>}
          <span style={{ fontSize: 'var(--text-caption1)', color: 'var(--text-tertiary)' }}>in {fmtDuration(run.duration_ms)}</span>
          {run.suite && <ProvenanceChip>{run.suite}</ProvenanceChip>}
          {run.source && <ProvenanceChip>{run.source}</ProvenanceChip>}
          <span className="ml-auto" style={{ fontSize: 'var(--text-caption1)', color: 'var(--text-tertiary)' }}>{fmtRelative(run.started_at)}</span>
        </div>
        {/* Multi-suite projects: pick a suite to see its run command. The tab
            shows the task's LAST recorded run; other suites are run via the
            hint (running from the UI is a future step). */}
        {suites.length > 1 && (
          <div className="flex items-center gap-2" style={{ marginTop: 'var(--space-2)' }}>
            <select
              data-testid="tests-suite-selector"
              aria-label="Test suite"
              value={activeSuiteId}
              onChange={(e) => setSelectedSuite(e.target.value)}
              style={{
                padding: '2px var(--space-2)',
                borderRadius: 'var(--radius-sm)',
                border: 'var(--border-hairline)',
                background: 'var(--bg-card)',
                color: 'var(--text-app)',
                fontSize: 'var(--text-caption1)',
              }}
            >
              {suites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}{s.id === run.suite ? ' (last run)' : ''}
                </option>
              ))}
            </select>
            <code style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }}>{runHint}</code>
          </div>
        )}
      </div>
      {!isPlaywrightRun && <RunArtifacts taskId={task.id} runId={run.run_id} />}
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
