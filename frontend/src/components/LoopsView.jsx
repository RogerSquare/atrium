import { useState } from 'react'
import { Plus, Play, Pencil, Trash2, Repeat } from 'lucide-react'
import useLoops from '../hooks/useLoops'
import LoopModal from './LoopModal'
import LoopDetailModal from './LoopDetailModal'
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

// A loop row — click the name to open the full detail view (feat-loopsv2-detail-001);
// the inline run/results now live in that detail modal's tabs. Row keeps the
// quick actions (toggle / run / edit / delete).
function LoopRow({ loop, onOpen, onToggle, onRun, onEdit, onDelete }) {
  const [busy, setBusy] = useState(false)
  const status = STATUS_STYLE[loop.status] || STATUS_STYLE.idle
  const run = async () => { setBusy(true); try { await onRun(loop.id) } finally { setBusy(false) } }

  return (
    <div data-testid="loop-row" data-loop-id={loop.id} style={{ borderBottom: '0.5px solid var(--separator)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-3)' }}>
        <button onClick={() => onOpen(loop)} data-testid="loop-open" title="Open loop" style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
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
        </button>

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
    </div>
  )
}

/**
 * Top-level Loops view (feat-loops-ui-global-001) — the home for all loops,
 * project-scoped and independent. Lives alongside Board / List / Changes.
 * A row opens the loop detail cockpit (feat-loopsv2-detail-001).
 */
export default function LoopsView({ projects = [], activeProject, socketRef }) {
  const { loops, loading, error, createLoop, updateLoop, deleteLoop, runLoop, runsByLoop, fetchRuns, summarize, fetchInstructions, templates, fetchTemplates, createTemplate, deleteTemplate, startTerminalRun, fetchTerminalRuns } = useLoops(socketRef)
  const [modal, setModal] = useState(null)      // { loop, initialProject? } | null  (create/edit form)
  const [detailId, setDetailId] = useState(null) // open loop's id (detail cockpit)

  const scoped = !!activeProject && activeProject !== 'All'
  const visibleLoops = scoped
    ? loops.filter((l) => l.scope === 'project' && l.project === activeProject)
    : loops
  // Resolve the open loop live from the list so the cockpit reflects socket updates.
  const detailLoop = detailId ? loops.find((l) => l.id === detailId) : null

  const onToggle = (loop, enabled) => updateLoop(loop.id, { enabled }).catch((e) => alert(e.message))
  const onDelete = (loop) => {
    if (!window.confirm(`Delete loop "${loop.name}"?`)) return
    deleteLoop(loop.id).then(() => setDetailId((cur) => (cur === loop.id ? null : cur))).catch((e) => alert(e.message))
  }
  const onRun = (id) => runLoop(id).catch((e) => alert(e.message))
  const onEdit = (loop) => { setDetailId(null); setModal({ loop }) }

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
            <LoopRow key={loop.id} loop={loop} onOpen={(l) => setDetailId(l.id)} onToggle={onToggle} onRun={onRun} onEdit={onEdit} onDelete={onDelete} />
          ))
        )}
      </div>

      {detailLoop && (
        <LoopDetailModal
          loop={detailLoop}
          runs={runsByLoop[detailLoop.id] || []}
          onClose={() => setDetailId(null)}
          onEdit={onEdit}
          onRun={onRun}
          onToggle={onToggle}
          onDelete={onDelete}
          onSummarize={summarize}
          onFetchRuns={fetchRuns}
          onUpdate={updateLoop}
          onFetchInstructions={fetchInstructions}
          templates={templates}
          onFetchTemplates={fetchTemplates}
          onCreateTemplate={createTemplate}
          onDeleteTemplate={deleteTemplate}
          socketRef={socketRef}
          onStartTerminal={startTerminalRun}
          onFetchTerminalRuns={fetchTerminalRuns}
        />
      )}

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
