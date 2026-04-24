// Facelift Phase 5 — TaskRow.
//
// Extracted from ListView's inline renderRow. One <tr> = one task.
// Kept behavior-preserving: same markup, same styles, same class names.
// Caller owns sort/group/virtualization and threads the per-task
// props through here.

import { Copy, Check, Loader2, Clock } from 'lucide-react'
import { STATUS_OPTIONS, PRIORITY_COLOR, STATUS_COLOR, TYPE_STYLE, VIEWER_COLORS, MERGE_STATUS } from '../../constants'

const PRIORITY_CYCLE = ['low', 'medium', 'high']

function relativeTime(dateStr) {
  if (!dateStr) return '—'
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function getLastUpdated(task) {
  if (task.activity_log && task.activity_log.length > 0) {
    return task.activity_log[task.activity_log.length - 1].timestamp
  }
  return task.created_at
}

export default function TaskRow({
  task,
  onSelectTask,
  selectable,
  selectedIds = [],
  onToggleSelect,
  activeAgents = [],
  taskViewers = {},
  recentlyUpdatedIds = [],
  githubLinks = {},
  copiedId,
  editingCell,
  setEditingCell,
  handleCopyId,
  handleImmediateUpdate,
  handleInlineUpdate,
}) {
  const isAgentRunning = activeAgents.some(a => a.taskId === task.id)
  const viewers = taskViewers[task.id] || []
  const justUpdated = recentlyUpdatedIds.includes(task.id)
  const pc = PRIORITY_COLOR[task.priority] || PRIORITY_COLOR.medium
  const ts = TYPE_STYLE[task.type || 'fullstack'] || TYPE_STYLE.fullstack
  const isSelected = selectedIds.includes(task.id)

  return (
    <tr
      onClick={() => onSelectTask(task)}
      className="cursor-pointer"
      style={{
        borderBottom: '0.5px solid var(--separator)',
        borderLeft: `3px solid ${pc}`,
        background: isSelected ? 'color-mix(in srgb, var(--accent-app) 8%, transparent)' : justUpdated ? 'color-mix(in srgb, var(--accent-app) 6%, transparent)' : 'transparent',
        transition: `background var(--duration-fast) var(--ease-default)`,
      }}
      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'color-mix(in srgb, var(--accent-app) 4%, transparent)' }}
      onMouseLeave={e => { if (!isSelected && !justUpdated) e.currentTarget.style.background = 'transparent' }}
    >
      {selectable && (
        <td style={{ padding: '8px' }} onClick={e => e.stopPropagation()}>
          <input type="checkbox" checked={isSelected} onChange={() => onToggleSelect(task.id)} style={{ accentColor: 'var(--accent-app)', cursor: 'pointer' }} />
        </td>
      )}
      {/* ID */}
      <td style={{ padding: '8px 12px' }}>
        <div className="flex items-center gap-1.5">
          {(() => {
            const link = githubLinks[task.id]
            const ms = link?.pr_state ? MERGE_STATUS[link.pr_state] : null
            return ms ? <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: ms.dotColor, flexShrink: 0 }} title={`PR ${ms.label}`} /> : null
          })()}
          <button onClick={(e) => handleCopyId(e, task.id)} className="apple-press flex items-center gap-1" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-medium)', color: 'var(--text-tertiary)', background: 'var(--fill-secondary)', padding: '2px 8px', borderRadius: 'var(--radius-sm)' }} title="Copy ID">
            {copiedId === task.id ? <Check className="w-2.5 h-2.5" style={{ color: 'var(--apple-green)' }} /> : <Copy className="w-2.5 h-2.5" />}
            {task.id}
          </button>
          {isAgentRunning && <Loader2 className="w-3 h-3 animate-spin" style={{ color: 'var(--accent-app)' }} />}
        </div>
      </td>
      {/* Title */}
      <td style={{ padding: '8px 12px' }}>
        <div className="flex items-center gap-2">
          <span className="truncate max-w-[400px]" style={{ fontSize: 'var(--text-subhead)', fontWeight: 'var(--font-medium)', color: 'var(--text-app)' }}>{task.title}</span>
          {viewers.length > 0 && (
            <div className="flex -space-x-1.5 shrink-0">
              {viewers.slice(0, 3).map((v, i) => (
                <div key={v} className="w-5 h-5 rounded-full flex items-center justify-center text-white" style={{ fontSize: '8px', fontWeight: 'var(--font-semibold)', backgroundColor: VIEWER_COLORS[i % VIEWER_COLORS.length], border: '2px solid var(--bg-card)' }} title={v}>{v[0]?.toUpperCase()}</div>
              ))}
            </div>
          )}
        </div>
      </td>
      {/* Status */}
      <td style={{ padding: '8px 12px' }} onClick={e => e.stopPropagation()}>
        <select value={task.status} onChange={(e) => handleImmediateUpdate(task.id, 'status', e.target.value)} className="cursor-pointer focus:outline-none bg-transparent" style={{ fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-semibold)', color: STATUS_COLOR[task.status] || 'var(--text-muted)', border: 'none', padding: '2px' }}>
          {STATUS_OPTIONS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </td>
      {/* Priority */}
      <td style={{ padding: '8px 12px' }} onClick={e => e.stopPropagation()}>
        <select value={task.priority} onChange={(e) => handleImmediateUpdate(task.id, 'priority', e.target.value)} className="cursor-pointer focus:outline-none bg-transparent" style={{ fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-semibold)', color: pc, border: 'none', padding: '2px', textTransform: 'capitalize' }}>
          {PRIORITY_CYCLE.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </td>
      {/* Assignee */}
      <td style={{ padding: '8px 12px' }} onClick={e => e.stopPropagation()}>
        {editingCell?.taskId === task.id && editingCell?.field === 'assignee' ? (
          <input autoFocus defaultValue={task.assignee || ''} onBlur={(e) => handleInlineUpdate(task.id, 'assignee', e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleInlineUpdate(task.id, 'assignee', e.target.value); if (e.key === 'Escape') setEditingCell(null) }} className="w-full focus:outline-none" style={{ background: 'var(--fill-secondary)', borderRadius: 'var(--radius-sm)', padding: '2px 8px', fontSize: 'var(--text-caption1)', color: 'var(--text-app)', border: 'none', boxShadow: '0 0 0 2px color-mix(in srgb, var(--accent-app) 30%, transparent)' }} />
        ) : (
          <button onClick={() => setEditingCell({ taskId: task.id, field: 'assignee' })} className="flex items-center gap-1.5" style={{ fontSize: 'var(--text-caption1)', color: task.assignee ? 'var(--text-muted)' : 'var(--text-tertiary)', transition: `color var(--duration-fast)` }}>
            {task.assignee ? (
              <>
                <div className="w-4 h-4 rounded-full flex items-center justify-center text-white shrink-0" style={{ fontSize: '8px', fontWeight: 'var(--font-semibold)', background: 'var(--gray-2)' }}>{task.assignee.charAt(0).toUpperCase()}</div>
                <span className="truncate max-w-[80px]">{task.assignee}</span>
              </>
            ) : '—'}
          </button>
        )}
      </td>
      {/* Type */}
      <td style={{ padding: '8px 12px' }}>
        {task.type && (
          <span style={{ fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-semibold)', textTransform: 'uppercase', color: ts.color, background: ts.bg, padding: '2px 8px', borderRadius: 'var(--radius-sm)', display: 'inline-block' }}>{task.type}</span>
        )}
      </td>
      {/* Project */}
      <td style={{ padding: '8px 12px' }}>
        <span className="truncate max-w-[100px] block" style={{ fontSize: 'var(--text-caption1)', color: 'var(--text-muted)' }}>{task.project || '—'}</span>
      </td>
      {/* Component */}
      <td style={{ padding: '8px 12px' }}>
        <span className="truncate max-w-[120px] block" style={{ fontSize: 'var(--text-caption1)', color: 'var(--text-muted)' }}>{task.component || '—'}</span>
      </td>
      {/* Due */}
      <td style={{ padding: '8px 12px' }}>
        {task.due_date ? (() => {
          const diff = Math.ceil((new Date(task.due_date) - new Date()) / (1000 * 60 * 60 * 24))
          const c = diff < 0 ? 'var(--apple-red)' : diff <= 3 ? 'var(--apple-orange)' : 'var(--apple-green)'
          const label = diff < 0 ? `${Math.abs(diff)}d overdue` : diff === 0 ? 'Today' : `${diff}d`
          return <span style={{ fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-semibold)', color: c }}>{label}</span>
        })() : <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)', opacity: 0.4 }}>—</span>}
      </td>
      {/* Updated */}
      <td style={{ padding: '8px 12px' }}>
        <span className="flex items-center gap-1" style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }}>
          <Clock className="w-3 h-3" />{relativeTime(getLastUpdated(task))}
        </span>
      </td>
    </tr>
  )
}
