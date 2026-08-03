import { useState, useEffect } from 'react'
import { Play, Repeat, Bot, BookOpen, Activity } from 'lucide-react'
import useLoops from '../hooks/useLoops'
import { apiFetch } from '../config'
import { Badge, Checkbox } from './ui'

// Hub Overview (feat-hub-rethink-impl-001) — automation health at a glance:
// one card per loop (status, next run, last result, enable, run-now) plus a
// merged newest-first activity feed across every loop. Cards open the full
// cockpit via onOpenLoop (HubView switches to the Loops tab). Live over the
// same loop_updated / loop_activity sockets the rest of the app uses.

const MODE_META = {
  watcher: { label: 'watcher', icon: Repeat, color: 'var(--text-muted)' },
  worker: { label: 'worker', icon: Bot, color: 'var(--apple-orange)' },
  playbook: { label: 'playbook', icon: BookOpen, color: 'var(--accent-app)' },
}
const STATUS_COLOR = { idle: 'var(--text-muted)', running: 'var(--apple-blue)', error: 'var(--apple-red)' }

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

function triggerLabel(loop) {
  if (loop.schedule) {
    const days = loop.schedule.days || []
    const set = new Set(days)
    const d = days.length === 7 ? 'daily' : days.length === 5 && !set.has('sat') && !set.has('sun') ? 'weekdays' : days.join(' ')
    return `${d} ${loop.schedule.time}`
  }
  return `every ${Math.round((loop.interval_ms || 0) / 60000)}m`
}

// One line the human can act on, whatever the loop's mode.
function lastResultLine(loop) {
  if (loop.last_error) return { text: loop.last_error, color: 'var(--apple-red)' }
  const r = loop.last_result
  if (!r) return { text: 'no runs yet', color: 'var(--text-tertiary)' }
  if (r.playbook_run_id) return { text: `playbook run ${r.status}${r.cost_usd != null ? ` · $${Number(r.cost_usd).toFixed(2)}` : ''}`, color: 'var(--text-muted)' }
  if (r.note) return { text: r.note, color: 'var(--text-muted)' }
  if (typeof r.changes === 'number') return { text: `${r.changes} change${r.changes === 1 ? '' : 's'} detected${r.issues_created ? ` · ${r.issues_created} issue task(s)` : ''}`, color: 'var(--text-muted)' }
  if (r.claimed !== undefined) return { text: r.task ? `executing ${r.task}` : 'no eligible todo', color: 'var(--text-muted)' }
  return { text: 'ok', color: 'var(--text-muted)' }
}

function LoopCard({ loop, onOpen, onToggle, onRun }) {
  const [busy, setBusy] = useState(false)
  const meta = MODE_META[loop.mode] || MODE_META.watcher
  const last = lastResultLine(loop)
  const run = async (e) => { e.stopPropagation(); setBusy(true); try { await onRun(loop.id) } finally { setBusy(false) } }

  return (
    <div
      data-testid="hub-loop-card"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(loop.id)}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(loop.id) }}
      className="surface-card apple-press focus-visible:ring-2"
      style={{ padding: 'var(--space-3)', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '6px', textAlign: 'left' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: STATUS_COLOR[loop.status] || STATUS_COLOR.idle }} title={loop.status} />
        <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--text-subhead)', fontWeight: 'var(--font-semibold)', color: 'var(--text-app)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{loop.name}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-semibold)', color: meta.color, flexShrink: 0 }}>
          <meta.icon className="w-3.5 h-3.5" /> {meta.label}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
        <Badge preset="muted">{loop.scope === 'project' ? (loop.project || 'project') : (loop.repo || 'standalone')}</Badge>
        <Badge preset="muted">{triggerLabel(loop)}</Badge>
        <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }}>
          ran {relTime(loop.last_run_at)}{loop.enabled && loop.next_run_at ? ` · next ${relTime(loop.next_run_at)}` : ''}
        </span>
      </div>

      <div data-testid="hub-loop-last" style={{ fontSize: 'var(--text-caption1)', color: last.color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {last.text}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }} onClick={(e) => e.stopPropagation()}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
          <Checkbox checked={loop.enabled} onChange={(e) => onToggle(loop, e.target.checked)} aria-label={`Toggle ${loop.name}`} />
          <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-muted)' }}>{loop.enabled ? 'enabled' : 'disabled'}</span>
        </label>
        <span style={{ flex: 1 }} />
        <button onClick={run} disabled={busy} aria-label={`Run ${loop.name} now`} title="Run now" className="apple-press" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: 'var(--text-caption2)', color: 'var(--accent-app)', background: 'transparent', border: 'none', cursor: 'pointer', opacity: busy ? 0.5 : 1 }}>
          <Play className="w-3.5 h-3.5" /> Run now
        </button>
      </div>
    </div>
  )
}

export default function HubOverview({ socketRef, activeProject, onOpenLoop, onGoToLoops }) {
  const { loops, loading, error, updateLoop, runLoop } = useLoops(socketRef)
  const [feed, setFeed] = useState([])

  // Merged activity feed: one fetch, then live-prepend from the socket.
  useEffect(() => {
    let alive = true
    apiFetch('/api/loops/activity?limit=50')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => { if (alive && Array.isArray(data)) setFeed(data) })
      .catch(() => {})
    return () => { alive = false }
  }, [])
  useEffect(() => {
    const socket = socketRef?.current
    if (!socket) return
    const onAct = (e) => { if (e && e.loop_id) setFeed((prev) => [e, ...prev].slice(0, 50)) }
    socket.on('loop_activity', onAct)
    return () => socket.off('loop_activity', onAct)
  }, [socketRef])

  const scoped = !!activeProject && activeProject !== 'All'
  const visible = scoped ? loops.filter((l) => l.scope === 'project' && l.project === activeProject) : loops
  const visibleIds = new Set(visible.map((l) => l.id))
  const visibleFeed = scoped ? feed.filter((e) => visibleIds.has(e.loop_id)) : feed
  const nameById = Object.fromEntries(loops.map((l) => [l.id, l.name]))

  const onToggle = (loop, enabled) => updateLoop(loop.id, { enabled }).catch((e) => alert(e.message))
  const onRun = (id) => runLoop(id).catch((e) => alert(e.message))

  if (loading) return <div className="italic animate-pulse" style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--text-muted)' }}>Loading automations…</div>
  if (error) return <div style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--apple-red)' }}>Failed to load automations: {error}</div>

  return (
    <div data-testid="hub-overview" style={{ maxWidth: 880, margin: '0 auto' }}>
      {visible.length === 0 ? (
        <div className="surface-card" style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--text-muted)' }}>
          <Repeat className="w-8 h-8" style={{ margin: '0 auto var(--space-3)', color: 'var(--text-tertiary)' }} />
          <div style={{ fontSize: 'var(--text-subhead)', color: 'var(--text-app)', marginBottom: '4px' }}>
            {scoped ? `No automations for ${activeProject}` : 'No automations yet'}
          </div>
          <div style={{ fontSize: 'var(--text-caption1)', marginBottom: 'var(--space-3)' }}>
            Loops watch GitHub, execute tasks, or run scheduled playbooks.
          </div>
          <button onClick={onGoToLoops} className="apple-press" style={{ fontSize: 'var(--text-caption1)', color: 'var(--accent-app)', background: 'transparent', border: 'none', cursor: 'pointer' }}>
            Create one in the Loops tab →
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 'var(--space-3)', marginBottom: 'var(--space-5)' }}>
          {visible.map((loop) => (
            <LoopCard key={loop.id} loop={loop} onOpen={onOpenLoop} onToggle={onToggle} onRun={onRun} />
          ))}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: 'var(--space-2)' }}>
        <Activity className="w-3.5 h-3.5" style={{ color: 'var(--accent-app)' }} />
        <span style={{ fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-semibold)', color: 'var(--text-app)' }}>Recent activity</span>
      </div>
      <div className="surface-card" data-testid="hub-activity-feed" style={{ overflow: 'hidden' }}>
        {visibleFeed.length === 0 ? (
          <div style={{ padding: 'var(--space-4)', fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)', textAlign: 'center' }}>
            Nothing yet — loop actions across all automations land here.
          </div>
        ) : (
          visibleFeed.slice(0, 30).map((a) => (
            <div key={a.id} style={{ display: 'flex', gap: '8px', padding: '6px var(--space-3)', borderBottom: '0.5px solid var(--separator)', alignItems: 'baseline' }}>
              <Badge preset="muted" style={{ flexShrink: 0 }}>{a.type}</Badge>
              <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--text-caption1)', color: 'var(--text-app)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.message}>
                {nameById[a.loop_id] ? `${nameById[a.loop_id]} — ` : ''}{a.message}
              </span>
              <span style={{ flexShrink: 0, fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }}>{relTime(a.ts)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
