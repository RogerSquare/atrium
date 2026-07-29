import { useState, useEffect } from 'react'
import { X, Play, Pencil, Trash2, Sparkles, Settings2, FileText, Activity, TerminalSquare, AlertCircle } from 'lucide-react'
import ModalOverlay from './ModalOverlay'
import LoopTerminal from './LoopTerminal'
import { Button, Badge, Checkbox } from './ui'

// feat-loopsv2-detail-001: first-class loop detail view ("loops act like tasks").
// Config + Activity are live; Instructions + Terminal are honest placeholders
// that their own phases (instructions-001 / terminal-001) will fill in.

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

// Human-readable description of what the loop does, derived from its toggles.
// This is the read-only preview of the "system instructions" the config implies;
// editable instructions + a template library land in feat-loopsv2-instructions-001.
function describeLoop(loop) {
  const target = loop.scope === 'project' ? `project "${loop.project}"` : `repo ${loop.repo}`
  const watch = (loop.watch || []).join(', ') || 'nothing'
  const acts = []
  if ((loop.actions || []).includes('update_fields')) acts.push('set github_branch/github_pr_url on matching tasks')
  if ((loop.actions || []).includes('comment')) acts.push('post a comment describing each change')
  if ((loop.actions || []).includes('ai_summary')) acts.push('run an AI summary on high-signal events (PR opened/merged, CI failure)')
  if ((loop.watch || []).includes('issues')) acts.push('create a draft task for each new GitHub issue')
  return [
    `Every ${Math.round((loop.interval_ms || 0) / 60000)} min, watch ${target} for: ${watch}.`,
    'On a change, it will:',
    ...acts.map((a) => `  • ${a}`),
    '',
    'A merged PR moves a mid-flight (todo/in_progress) task to review — never to done (humans merge).',
  ].join('\n')
}

const TABS = [
  { id: 'config', label: 'Config', icon: Settings2 },
  { id: 'instructions', label: 'Instructions', icon: FileText },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'terminal', label: 'Terminal', icon: TerminalSquare },
]
const TAB_KEY = 'loopDetailActiveTab'

function AgentRun({ run }) {
  const [open, setOpen] = useState(false)
  const dot = run.status === 'done' ? 'var(--apple-green)' : run.status === 'error' ? 'var(--apple-red)' : 'var(--apple-blue)'
  return (
    <div data-testid="agent-run" style={{ borderTop: '0.5px dashed var(--separator)', padding: '8px 0' }}>
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

function Row({ label, children }) {
  return (
    <div style={{ display: 'flex', gap: 'var(--space-3)', padding: '6px 0', borderBottom: '0.5px solid var(--separator)' }}>
      <div style={{ width: 120, flexShrink: 0, fontSize: 'var(--text-caption1)', color: 'var(--text-muted)' }}>{label}</div>
      <div style={{ flex: 1, minWidth: 0, fontSize: 'var(--text-caption1)', color: 'var(--text-app)' }}>{children}</div>
    </div>
  )
}

export default function LoopDetailModal({ loop, runs = [], onClose, onEdit, onRun, onToggle, onDelete, onSummarize, onFetchRuns, onUpdate, onFetchInstructions, templates = [], onFetchTemplates, onCreateTemplate, socketRef, onStartTerminal, onFetchTerminalRuns, activity = [], onFetchActivity }) {
  const [activeTab, setActiveTab] = useState(() => {
    try { const s = localStorage.getItem(TAB_KEY); if (s && TABS.some((t) => t.id === s)) return s } catch { /* ignore */ }
    return 'config'
  })
  const [pr, setPr] = useState('')
  const [summarizing, setSummarizing] = useState(false)
  const [busy, setBusy] = useState(false)
  const status = STATUS_STYLE[loop.status] || STATUS_STYLE.idle

  useEffect(() => { onFetchRuns(loop.id) }, [loop.id, onFetchRuns])
  useEffect(() => { if (activeTab === 'activity' && onFetchActivity) onFetchActivity(loop.id) }, [activeTab, loop.id, onFetchActivity])
  const pick = (id) => { setActiveTab(id); try { localStorage.setItem(TAB_KEY, id) } catch { /* ignore */ } }

  // Instructions editor (feat-loopsv2-instructions-001)
  const [instr, setInstr] = useState(null)   // { generated, override, effective }
  const [draft, setDraft] = useState('')
  const [savingInstr, setSavingInstr] = useState(false)
  const [showGen, setShowGen] = useState(false)
  useEffect(() => {
    let alive = true
    onFetchInstructions(loop.id).then((d) => { if (alive) { setInstr(d); setDraft(d.effective || '') } }).catch(() => {})
    onFetchTemplates()
    return () => { alive = false }
  }, [loop.id, onFetchInstructions, onFetchTemplates])
  const dirty = draft !== (instr?.effective ?? '')
  const saveInstr = async () => {
    setSavingInstr(true)
    try { await onUpdate(loop.id, { instructions: draft }); const d = await onFetchInstructions(loop.id); setInstr(d); setDraft(d.effective || '') }
    catch (e) { alert(e.message) } finally { setSavingInstr(false) }
  }
  const resetInstr = async () => {
    setSavingInstr(true)
    try { await onUpdate(loop.id, { instructions: null }); const d = await onFetchInstructions(loop.id); setInstr(d); setDraft(d.effective || '') }
    catch (e) { alert(e.message) } finally { setSavingInstr(false) }
  }
  const saveTemplate = async () => {
    const name = window.prompt('Save these instructions as a template named:')
    if (!name) return
    try { await onCreateTemplate(name, draft) } catch (e) { alert(e.message) }
  }
  const applyTemplate = (e) => { const t = templates.find((x) => x.id === e.target.value); if (t) setDraft(t.body) }

  // Terminal runs (feat-loopsv2-terminal-001)
  const [termRuns, setTermRuns] = useState([])
  const [termRunId, setTermRunId] = useState(null)
  const [termPr, setTermPr] = useState('')
  const [starting, setStarting] = useState(false)
  useEffect(() => {
    if (activeTab !== 'terminal' || !onFetchTerminalRuns) return
    onFetchTerminalRuns(loop.id).then((rs) => {
      setTermRuns(rs || [])
      setTermRunId((cur) => cur || (rs && rs[0] && rs[0].run_id) || null)
    }).catch(() => {})
  }, [activeTab, loop.id, onFetchTerminalRuns])
  const startTerm = async () => {
    if (!termPr) { alert('Enter a PR number to run a summary in the terminal'); return }
    setStarting(true)
    try {
      const runId = await onStartTerminal(loop.id, { pr_number: Number(termPr) })
      setTermRunId(runId); setTermPr('')
      const rs = await onFetchTerminalRuns(loop.id); setTermRuns(rs || [])
    } catch (e) { alert(e.message) } finally { setStarting(false) }
  }

  const run = async () => { setBusy(true); try { await onRun(loop.id) } finally { setBusy(false) } }
  const summarize = async () => {
    setSummarizing(true)
    try { await onSummarize(loop.id, pr ? { pr_number: Number(pr) } : {}); setPr('') }
    catch (e) { alert(e.message) }
    finally { setSummarizing(false) }
  }

  return (
    <ModalOverlay onClose={onClose} titleId="loop-detail-title">
      <div
        data-testid="loop-detail"
        className="w-full sm:max-w-2xl"
        style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-popover)', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}
      >
        <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-4)', borderBottom: '0.5px solid var(--separator)' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: status.color }} title={status.label} />
          <h2 id="loop-detail-title" style={{ fontSize: 'var(--text-subhead)', fontWeight: 'var(--font-semibold)', color: 'var(--text-app)', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{loop.name}</h2>
          <Badge preset="muted">{loop.scope === 'project' ? (loop.project || 'project') : (loop.repo || 'global')}</Badge>
          <button type="button" onClick={onClose} aria-label="Close" style={{ color: 'var(--text-muted)' }}><X className="w-4 h-4" /></button>
        </header>

        {/* Tab bar */}
        <div style={{ display: 'flex', gap: '2px', padding: '6px var(--space-4)', borderBottom: '0.5px solid var(--separator)' }}>
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              data-testid={`loop-tab-${id}`}
              onClick={() => pick(id)}
              className="apple-press flex items-center gap-1.5"
              style={{ padding: '4px 10px', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-medium)', color: activeTab === id ? 'var(--text-app)' : 'var(--text-muted)', background: activeTab === id ? 'var(--fill-secondary)' : 'transparent' }}
            >
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          ))}
        </div>

        <div className="custom-scrollbar" style={{ padding: 'var(--space-4)', overflowY: 'auto', flex: 1 }}>
          {activeTab === 'config' && (
            <div>
              <Row label="Status"><span style={{ color: status.color, fontWeight: 'var(--font-semibold)' }}>{status.label}</span>{loop.last_error ? ` — ${loop.last_error}` : ''}</Row>
              <Row label="Scope">{loop.scope === 'project' ? `project · ${loop.project}` : `independent · ${loop.repo}`}</Row>
              <Row label="Mode">{loop.mode === 'worker' ? <span style={{ color: 'var(--apple-orange)', fontWeight: 'var(--font-semibold)' }}>worker (autonomous)</span> : 'watcher'}</Row>
              <Row label="Watch">{(loop.watch || []).map((w) => <Badge key={w} preset="muted" style={{ marginRight: 4 }}>{w}</Badge>)}</Row>
              <Row label="On change">{(loop.actions || []).join(', ') || '—'}</Row>
              <Row label="Interval">every {Math.round((loop.interval_ms || 0) / 60000)} min</Row>
              <Row label="Enabled">
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <Checkbox checked={loop.enabled} onChange={(e) => onToggle(loop, e.target.checked)} aria-label="Enabled" />
                  <span>{loop.enabled ? 'enabled' : 'disabled'}</span>
                </label>
              </Row>
              <Row label="Last / next run">ran {relTime(loop.last_run_at)}{loop.enabled && loop.next_run_at ? ` · next ${relTime(loop.next_run_at)}` : ''}</Row>
              <div style={{ display: 'flex', gap: '8px', marginTop: 'var(--space-4)' }}>
                <Button size="sm" variant="secondary" loading={busy} onClick={run}><Play className="w-3.5 h-3.5" /> Run now</Button>
                <Button size="sm" variant="secondary" onClick={() => onEdit(loop)}><Pencil className="w-3.5 h-3.5" /> Edit</Button>
                <Button size="sm" variant="danger" onClick={() => onDelete(loop)}><Trash2 className="w-3.5 h-3.5" /> Delete</Button>
              </div>
            </div>
          )}

          {activeTab === 'instructions' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 'var(--text-caption1)', color: 'var(--text-muted)' }}>
                  Agent instructions — {instr?.override ? <b style={{ color: 'var(--apple-orange)' }}>custom override</b> : 'generated from the config'}. Fed to the agent on every run.
                </span>
                {dirty && <Badge preset="muted">unsaved</Badge>}
              </div>
              <textarea
                data-testid="loop-instructions"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                spellCheck={false}
                style={{ width: '100%', minHeight: 240, padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)', border: '0.5px solid var(--separator)', background: 'var(--fill-secondary)', color: 'var(--text-app)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-caption2)', resize: 'vertical' }}
              />
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                <Button size="sm" variant="primary" loading={savingInstr} onClick={saveInstr} disabled={!dirty}>Save</Button>
                <Button size="sm" variant="secondary" onClick={resetInstr} disabled={!instr?.override}>Reset to generated</Button>
                <Button size="sm" variant="secondary" onClick={saveTemplate} disabled={!draft.trim()}>Save as template</Button>
                <select value="" onChange={applyTemplate} aria-label="Apply template" style={{ padding: '4px 8px', borderRadius: 'var(--radius-sm)', border: '0.5px solid var(--separator)', background: 'var(--fill-secondary)', color: 'var(--text-app)', fontSize: 'var(--text-caption1)' }}>
                  <option value="">Apply template…</option>
                  {templates.map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
                </select>
              </div>
              <button onClick={() => setShowGen((v) => !v)} style={{ marginTop: 10, fontSize: 'var(--text-caption2)', color: 'var(--accent-app)' }}>
                {showGen ? 'hide' : 'view'} generated default
              </button>
              {showGen && (
                <pre className="custom-scrollbar" style={{ marginTop: 6, padding: 'var(--space-2)', background: 'var(--fill-secondary)', borderRadius: 'var(--radius-sm)', whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-caption2)', color: 'var(--text-muted)' }}>
{instr?.generated || describeLoop(loop)}
                </pre>
              )}
            </div>
          )}

          {activeTab === 'activity' && (
            <div>
              {/* Audit trail — everything this loop changed (feat-loopsv2-activity-001) */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                <Activity className="w-3.5 h-3.5" style={{ color: 'var(--accent-app)' }} />
                <span style={{ fontWeight: 'var(--font-semibold)', color: 'var(--text-app)' }}>Audit trail</span>
              </div>
              {activity.length === 0 ? (
                <div style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)', marginBottom: 'var(--space-4)' }}>Nothing recorded yet — actions appear here as the loop runs.</div>
              ) : (
                <div style={{ marginBottom: 'var(--space-4)' }}>
                  {activity.slice(0, 60).map((a) => (
                    <div key={a.id} data-testid="loop-activity-entry" style={{ display: 'flex', gap: '8px', padding: '4px 0', borderBottom: '0.5px solid var(--separator)', alignItems: 'baseline' }}>
                      <Badge preset="muted" style={{ flexShrink: 0 }}>{a.type}</Badge>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--text-caption1)', color: 'var(--text-app)' }}>{a.message}</span>
                      <span style={{ flexShrink: 0, fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }}>{relTime(a.ts)}</span>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
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
                <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }}>full context is saved per run for review</span>
              </div>
              {runs.length === 0
                ? <div style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }}>No AI runs yet.</div>
                : runs.map((r) => <AgentRun key={r.id} run={r} />)}

              <div style={{ marginTop: 'var(--space-4)', fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)', marginBottom: '4px' }}>Last engine tick:</div>
              <pre className="custom-scrollbar" style={{ padding: 'var(--space-2)', background: 'var(--fill-secondary)', borderRadius: 'var(--radius-sm)', overflowX: 'auto', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-caption2)', color: 'var(--text-app)' }}>
{loop.last_result ? JSON.stringify(loop.last_result, null, 2) : 'No run yet.'}
              </pre>
            </div>
          )}

          {activeTab === 'terminal' && (
            <div>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap' }}>
                <input
                  value={termPr}
                  onChange={(e) => setTermPr(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="PR #"
                  inputMode="numeric"
                  aria-label="PR number to run in terminal"
                  style={{ width: 70, padding: '4px 8px', borderRadius: 'var(--radius-sm)', border: '0.5px solid var(--separator)', background: 'var(--fill-secondary)', color: 'var(--text-app)', fontSize: 'var(--text-caption1)' }}
                />
                <Button size="sm" variant="primary" loading={starting} onClick={startTerm}><TerminalSquare className="w-3.5 h-3.5" /> Run in terminal</Button>
                {termRuns.length > 0 && (
                  <select
                    value={termRunId || ''}
                    onChange={(e) => setTermRunId(e.target.value)}
                    aria-label="Select a terminal run to view"
                    style={{ padding: '4px 8px', borderRadius: 'var(--radius-sm)', border: '0.5px solid var(--separator)', background: 'var(--fill-secondary)', color: 'var(--text-app)', fontSize: 'var(--text-caption1)' }}
                  >
                    {termRuns.map((r) => (
                      <option key={r.run_id} value={r.run_id}>{r.label || r.run_id} · {r.status}</option>
                    ))}
                  </select>
                )}
                <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }}>runs the agent in a live PTY; output is persisted for replay</span>
              </div>
              <LoopTerminal loopId={loop.id} runId={termRunId} socketRef={socketRef} />
            </div>
          )}
        </div>
      </div>
    </ModalOverlay>
  )
}
