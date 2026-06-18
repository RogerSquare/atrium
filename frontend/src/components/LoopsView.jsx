import { useState, useEffect } from 'react'
import { Plus, Play, Pencil, Trash2, ChevronRight, AlertCircle, Repeat, Sparkles } from 'lucide-react'
import useLoops from '../hooks/useLoops'
import LoopModal from './LoopModal'
import { Button, Badge, Checkbox } from './ui'

const STATUS_STYLE = {
  idle: { color: 'var(--text-muted)', label: 'idle' },
  running: { color: 'var(--apple-blue)', label: 'running' },
  error: { color: 'var(--apple-red)', label: 'error' },
}

function relTime(iso) {
  if (!iso) return 'never'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '—'
  const diff = Date.now() - then
  const past = diff >= 0
  const s = Math.abs(Math.round(diff / 1000))
  const fmt = s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`
  return past ? `${fmt} ago` : `in ${fmt}`
}

// One AI-summary run: shows status + output inline; expand to review the FULL
// context (the exact prompt + structured PR data) the agent was given.
function AgentRun({ run }) {
  const [open, setOpen] = useState(false)
  const dot = run.status === 'done' ? 'var(--apple-green)' : run.status === 'error' ? 'var(--apple-red)' : 'var(--apple-blue)'
  return (
    <div data-testid="agent-run" style={{ borderTop: '0.5px dashed var(--separator)', padding: '6px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: dot }} />
        <span style={{ fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-semibold)', color: 'var(--text-app)' }}>
          {run.event}{run.pr_number ? ` · PR #${run.pr_number}` : ''}
        </span>
        <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }}>
          {run.status}{run.cost_usd != null ? ` · $${Number(run.cost_usd).toFixed(4)}` : ''}{run.duration_ms ? ` · ${Math.round(run.duration_ms / 1000)}s` : ''} · {relTime(run.created_at)}
        </span>
        <button onClick={() => setOpen((o) => !o)} style={{ marginLeft: 'auto', fontSize: 'var(--text-caption2)', color: 'var(--accent-app)' }}>
          {open ? 'hide context' : 'view context'}
        </button>
      </div>
      {run.status === 'done' && run.output && (
        <div style={{ marginTop: '4px', whiteSpace: 'pre-wrap', color: 'var(--text-app)', fontSize: 'var(--text-caption1)' }}>{run.output}</div>
      )}
      {run.error && <div style={{ marginTop: '4px', color: 'var(--apple-red)', fontSize: 'var(--text-caption2)' }}>{run.error}</div>}
      {open && (
        <div style={{ marginTop: '6px' }}>
          <div style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)', marginBottom: '2px' }}>
            Exact context/prompt sent to the agent{run.session_id ? ` · session ${run.session_id.slice(0, 8)}` : ''}:
          </div>
          <pre className="custom-scrollbar" style={{ maxHeight: 260, overflow: 'auto', padding: 'var(--space-2)', background: 'var(--fill-secondary)', borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-caption2)', color: 'var(--text-app)', whiteSpace: 'pre-wrap' }}>
{run.context?.prompt || '(context not captured for this run)'}
          </pre>
        </div>
      )}
    </div>
  )
}

function LoopRow({ loop, runs = [], onToggle, onRun, onEdit, onDelete, onFetchRuns, onSummarize }) {
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pr, setPr] = useState('')
  const [summarizing, setSummarizing] = useState(false)
  const status = STATUS_STYLE[loop.status] || STATUS_STYLE.idle

  useEffect(() => { if (expanded) onFetchRuns(loop.id) }, [expanded, loop.id, onFetchRuns])

  const run = async () => { setBusy(true); try { await onRun(loop.id) } finally { setBusy(false) } }
  const summarize = async () => {
    setSummarizing(true)
    try { await onSummarize(loop.id, pr ? { pr_number: Number(pr) } : {}); setPr('') }
    catch (e) { alert(e.message) }
    finally { setSummarizing(false) }
  }

  return (
    <div data-testid="loop-row" data-loop-id={loop.id} style={{ borderBottom: '0.5px solid var(--separator)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-3)' }}>
        <button
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? 'Collapse' : 'Expand'}
          style={{ color: 'var(--text-tertiary)', transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform var(--duration-fast) var(--ease-default)' }}
        >
          <ChevronRight className="w-4 h-4" />
        </button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <span style={{ fontSize: 'var(--text-subhead)', fontWeight: 'var(--font-semibold)', color: 'var(--text-app)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{loop.name}</span>
            <Badge preset="muted">{loop.scope === 'project' ? (loop.project || 'project') : (loop.repo || 'global')}</Badge>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px', flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-semibold)', color: status.color }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: status.color }} />
              {status.label}
            </span>
            {(loop.watch || []).map((w) => (
              <Badge key={w} preset="muted">{w}</Badge>
            ))}
            <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }}>
              ran {relTime(loop.last_run_at)}{loop.enabled && loop.next_run_at ? ` · next ${relTime(loop.next_run_at)}` : ''}
            </span>
          </div>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }} title={loop.enabled ? 'Enabled' : 'Disabled'}>
          <Checkbox checked={loop.enabled} onChange={(e) => onToggle(loop, e.target.checked)} aria-label={`Toggle ${loop.name}`} />
        </label>
        <button onClick={run} disabled={busy} aria-label="Run now" title="Run now" style={{ color: 'var(--text-muted)', opacity: busy ? 0.5 : 1 }}>
          <Play className="w-4 h-4" />
        </button>
        <button onClick={() => onEdit(loop)} aria-label="Edit" title="Edit" style={{ color: 'var(--text-muted)' }}>
          <Pencil className="w-4 h-4" />
        </button>
        <button onClick={() => onDelete(loop)} aria-label="Delete" title="Delete" style={{ color: 'var(--apple-red)' }}>
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {expanded && (
        <div style={{ padding: '0 var(--space-3) var(--space-3) 40px', fontSize: 'var(--text-caption1)', color: 'var(--text-muted)' }}>
          {loop.last_error && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--apple-red)', marginBottom: '6px' }}>
              <AlertCircle className="w-3.5 h-3.5" /> {loop.last_error}
            </div>
          )}
          <div>Actions: {(loop.actions || []).join(', ') || '—'} · every {Math.round((loop.interval_ms || 0) / 60000)}m</div>
          <pre className="custom-scrollbar" style={{ marginTop: '6px', padding: 'var(--space-2)', background: 'var(--fill-secondary)', borderRadius: 'var(--radius-sm)', overflowX: 'auto', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-caption2)', color: 'var(--text-app)' }}>
            {loop.last_result ? JSON.stringify(loop.last_result, null, 2) : 'No run yet.'}
          </pre>

          {/* AI summaries — run on demand + auto on high-signal events; every run's full context is reviewable */}
          <div style={{ marginTop: 'var(--space-4)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
              <Sparkles className="w-3.5 h-3.5" style={{ color: 'var(--accent-app)' }} />
              <span style={{ fontWeight: 'var(--font-semibold)', color: 'var(--text-app)' }}>AI summaries</span>
            </div>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '6px', flexWrap: 'wrap' }}>
              <input
                value={pr}
                onChange={(e) => setPr(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="PR #"
                inputMode="numeric"
                aria-label="PR number to summarize"
                style={{ width: 70, padding: '4px 8px', borderRadius: 'var(--radius-sm)', border: '0.5px solid var(--separator)', background: 'var(--fill-secondary)', color: 'var(--text-app)', fontSize: 'var(--text-caption1)' }}
              />
              <Button size="sm" variant="secondary" loading={summarizing} onClick={summarize}>Summarize</Button>
              <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }}>
                runs an agent on the PR diff; the full context it used is saved here for review
              </span>
            </div>
            {runs.length === 0 ? (
              <div style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }}>No AI runs yet.</div>
            ) : (
              runs.map((r) => <AgentRun key={r.id} run={r} />)
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Top-level Loops view (feat-loops-ui-global-001) — the home for all loops,
 * project-scoped and independent. Lives alongside Board / List / Changes.
 */
export default function LoopsView({ projects = [], activeProject, socketRef }) {
  const { loops, loading, error, createLoop, updateLoop, deleteLoop, runLoop, runsByLoop, fetchRuns, summarize } = useLoops(socketRef)
  const [modal, setModal] = useState(null) // { loop, initialProject? } | null

  // Project-scoped mode: when a single project is selected (not "All"), this
  // view becomes that project's loops tab — show only its loops and prefill
  // "new loop" with scope=project for it. Mirrors how ChangesView keys off
  // activeProject. "All" shows every loop (global + project).
  const scoped = !!activeProject && activeProject !== 'All'
  const visibleLoops = scoped
    ? loops.filter((l) => l.scope === 'project' && l.project === activeProject)
    : loops

  const onToggle = (loop, enabled) => updateLoop(loop.id, { enabled }).catch((e) => alert(e.message))
  const onDelete = (loop) => { if (window.confirm(`Delete loop "${loop.name}"?`)) deleteLoop(loop.id).catch((e) => alert(e.message)) }
  const onRun = (id) => runLoop(id).catch((e) => alert(e.message))

  return (
    <div data-testid="loops-view" data-scoped={scoped ? activeProject : 'all'} style={{ maxWidth: 880, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-title3)', fontWeight: 'var(--font-semibold)', color: 'var(--text-app)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <Repeat className="w-5 h-5" style={{ color: 'var(--accent-app)' }} /> Loops{scoped ? ` · ${activeProject}` : ''}
          </h1>
          <p style={{ fontSize: 'var(--text-caption1)', color: 'var(--text-muted)', marginTop: '2px' }}>
            {scoped
              ? `Watchers for ${activeProject}. Switch the project to "All" to see every loop.`
              : 'GitHub watchers that reflect PR / CI / commit / issue changes onto tasks.'}
          </p>
        </div>
        <Button
          variant="primary"
          onClick={() => setModal({ loop: null, initialProject: scoped ? activeProject : undefined })}
          data-testid="new-loop-button"
        >
          <Plus className="w-4 h-4" /> {scoped ? 'New loop for this project' : 'New loop'}
        </Button>
      </div>

      <div className="surface-card" style={{ overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--text-muted)' }} className="italic animate-pulse">Loading loops…</div>
        ) : error ? (
          <div style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--apple-red)' }}>Failed to load loops: {error}</div>
        ) : visibleLoops.length === 0 ? (
          <div style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--text-muted)' }}>
            <Repeat className="w-8 h-8" style={{ margin: '0 auto var(--space-3)', color: 'var(--text-tertiary)' }} />
            <div style={{ fontSize: 'var(--text-subhead)', color: 'var(--text-app)', marginBottom: '4px' }}>
              {scoped ? `No loops for ${activeProject}` : 'No loops yet'}
            </div>
            <div style={{ fontSize: 'var(--text-caption1)' }}>Create one to start watching a repo.</div>
          </div>
        ) : (
          visibleLoops.map((loop) => (
            <LoopRow key={loop.id} loop={loop} runs={runsByLoop[loop.id] || []} onToggle={onToggle} onRun={onRun} onEdit={(l) => setModal({ loop: l })} onDelete={onDelete} onFetchRuns={fetchRuns} onSummarize={summarize} />
          ))
        )}
      </div>

      {modal && (
        <LoopModal
          loop={modal.loop}
          initialProject={modal.initialProject}
          projects={projects}
          onSubmit={(body) => (modal.loop ? updateLoop(modal.loop.id, body) : createLoop(body))}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}
