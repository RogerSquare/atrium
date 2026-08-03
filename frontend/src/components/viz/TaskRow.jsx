// Facelift Phase 5 — TaskRow.
//
// Extracted from ListView's inline renderRow. One <tr> = one task.
// Kept behavior-preserving: same markup, same styles, same class names.
// Caller owns sort/group/virtualization and threads the per-task
// props through here.

import { Copy, Check, Loader2, Clock, ChevronRight, ChevronDown, GitPullRequest } from 'lucide-react'
import { STATUS_OPTIONS, PRIORITY_COLOR, STATUS_COLOR, TYPE_STYLE, VIEWER_COLORS, MERGE_STATUS } from '../../constants'
import { Select } from '../ui'
import { DEFAULT_VISIBLE, phaseOf } from '../../lib/listColumns'

// Phase tags drive the research -> plan -> implement pipeline, so they get a
// colour each rather than one generic chip.
const PHASE_STYLE = {
  research: { color: 'var(--apple-purple, #bf5af2)', label: 'research' },
  plan:     { color: 'var(--apple-blue, #0a84ff)',   label: 'plan' },
  implement:{ color: 'var(--apple-green, #30d158)',  label: 'implement' },
}

const PRIORITY_CYCLE = ['low', 'medium', 'high']
const PR_TITLE = (ms) => 'PR ' + ms.label

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
  // Column visibility + tree position (ui-list-usability-001). Defaults keep
  // this component usable standalone (Storybook, tests) without the caller
  // having to thread list state through.
  columns = DEFAULT_VISIBLE,
  depth = 0,
  childCount = 0,
  isCollapsed = false,
  onToggleCollapse,
  // Keyboard roving focus + shift-click range selection
  // (ui-list-redesign-impl-001).
  isFocused = false,
  onShiftSelect,
  orderedTaskIds,
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
      data-row-id={task.id}
      className="cursor-pointer"
      style={{
        borderBottom: '0.5px solid var(--separator)',
        borderLeft: `3px solid ${pc}`,
        background: isFocused ? 'color-mix(in srgb, var(--accent-app) 10%, transparent)' : isSelected ? 'color-mix(in srgb, var(--accent-app) 8%, transparent)' : justUpdated ? 'color-mix(in srgb, var(--accent-app) 6%, transparent)' : 'transparent',
        // The keyboard's cursor: an inset accent line, visible on any theme
        // without shifting row height.
        boxShadow: isFocused ? 'inset 2px 0 0 var(--accent-app)' : undefined,
        transition: `background var(--duration-fast) var(--ease-default)`,
      }}
      onMouseEnter={e => { if (!isSelected && !isFocused) e.currentTarget.style.background = 'color-mix(in srgb, var(--accent-app) 4%, transparent)' }}
      onMouseLeave={e => { if (!isSelected && !justUpdated && !isFocused) e.currentTarget.style.background = 'transparent' }}
    >
      {selectable && (
        <td style={{ padding: '8px' }} onClick={e => e.stopPropagation()}>
          {/* Shift-click selects the whole range since the last click — the
              same contract Board cards use: onShiftSelect(id, orderedIds). */}
          <input
            type="checkbox"
            aria-label={`Select ${task.id}`}
            checked={isSelected}
            onChange={() => {}}
            onClick={(e) => {
              if (e.shiftKey && onShiftSelect && orderedTaskIds) onShiftSelect(task.id, orderedTaskIds)
              else onToggleSelect(task.id)
            }}
            style={{ accentColor: 'var(--accent-app)', cursor: 'pointer' }}
          />
        </td>
      )}
      {/* Cells render in the caller's column order, so the header and the
          body cannot drift apart when a column is hidden. */}
      {columns.map(key => {
        switch (key) {

        // Title is the row's ONE focal element (ui-list-redesign-impl-001,
        // Linear anatomy): high-contrast title, then muted metadata — the id
        // chip (still copyable, carries the PR-state dot), presence avatars,
        // and the agent spinner all live here now instead of separate
        // columns. It also carries the tree: indentation by depth, and a
        // disclosure triangle only when there is something to disclose.
        case 'title': {
          const link = githubLinks[task.id]
          const ms = link?.pr_state ? MERGE_STATUS[link.pr_state] : null
          return (
          <td key={key} style={{ padding: '8px 12px' }}>
            <div className="flex items-center gap-2" style={{ paddingLeft: depth ? (depth * 18) + 'px' : 0 }}>
              {childCount > 0 ? (
                <button
                  onClick={(e) => { e.stopPropagation(); onToggleCollapse?.(task.id) }}
                  className="apple-press shrink-0 flex items-center"
                  title={isCollapsed ? 'Expand subtasks' : 'Collapse subtasks'}
                  aria-label={isCollapsed ? 'Expand subtasks' : 'Collapse subtasks'}
                  aria-expanded={!isCollapsed}
                  style={{ color: 'var(--text-tertiary)', background: 'transparent', border: 'none', padding: 0 }}
                >
                  {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>
              ) : depth > 0 ? (
                // Keeps leaf titles aligned with siblings that DO have a
                // triangle, instead of jogging left by the icon width.
                <span className="shrink-0" style={{ width: '14px' }} />
              ) : null}
              <span data-testid="task-row-title" className="truncate max-w-[400px]" style={{ fontSize: 'var(--text-subhead)', fontWeight: 'var(--font-medium)', color: 'var(--text-app)' }}>{task.title}</span>
              {childCount > 0 && (
                <span className="shrink-0" style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)', background: 'var(--fill-secondary)', padding: '1px 6px', borderRadius: 'var(--radius-full)' }}>{childCount}</span>
              )}
              <button
                onClick={(e) => handleCopyId(e, task.id)}
                className="apple-press shrink-0 flex items-center gap-1"
                style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)', background: 'var(--fill-secondary)', padding: '1px 6px', borderRadius: 'var(--radius-sm)', border: 'none', cursor: 'pointer' }}
                title={ms ? `Copy ID · ${PR_TITLE(ms)}` : 'Copy ID'}
                aria-label={`Copy task id ${task.id}`}
              >
                {ms && <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: ms.dotColor, flexShrink: 0 }} />}
                {copiedId === task.id ? <Check className="w-2.5 h-2.5" style={{ color: 'var(--apple-green)' }} /> : <Copy className="w-2.5 h-2.5" />}
                {task.id}
              </button>
              {isAgentRunning && <Loader2 className="w-3 h-3 animate-spin shrink-0" style={{ color: 'var(--accent-app)' }} />}
              {viewers.length > 0 && (
                <div className="flex -space-x-1.5 shrink-0">
                  {viewers.slice(0, 3).map((v, i) => (
                    <div key={v} className="w-5 h-5 rounded-full flex items-center justify-center text-white" style={{ fontSize: '8px', fontWeight: 'var(--font-semibold)', backgroundColor: VIEWER_COLORS[i % VIEWER_COLORS.length], border: '2px solid var(--bg-card)' }} title={v}>{v[0]?.toUpperCase()}</div>
                  ))}
                </div>
              )}
            </div>
          </td>
          )
        }

        // Status/priority use the shared Select (ui-list-redesign-impl-001,
        // 'unified to siblings') — same control the Board toolbar uses,
        // keyboard-accessible for free. Color still signals state.
        case 'status': return (
          <td key={key} style={{ padding: '8px 12px' }} onClick={e => e.stopPropagation()}>
            <Select
              value={task.status}
              onChange={(e) => handleImmediateUpdate(task.id, 'status', e.target.value)}
              aria-label={`Status of ${task.id}`}
              style={{ fontWeight: 'var(--font-semibold)', color: STATUS_COLOR[task.status] || 'var(--text-muted)', background: 'transparent', padding: '2px' }}
            >
              {STATUS_OPTIONS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </Select>
          </td>
        )

        case 'priority': return (
          <td key={key} style={{ padding: '8px 12px' }} onClick={e => e.stopPropagation()}>
            <Select
              value={task.priority}
              onChange={(e) => handleImmediateUpdate(task.id, 'priority', e.target.value)}
              aria-label={`Priority of ${task.id}`}
              style={{ fontWeight: 'var(--font-semibold)', color: pc, background: 'transparent', padding: '2px', textTransform: 'capitalize' }}
            >
              {PRIORITY_CYCLE.map(p => <option key={p} value={p}>{p}</option>)}
            </Select>
          </td>
        )

        case 'phase': {
          const phase = phaseOf(task)
          const ps = phase ? PHASE_STYLE[phase] : null
          return (
            <td key={key} style={{ padding: '8px 12px' }}>
              {ps ? (
                <span style={{ fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-semibold)', color: ps.color, background: 'color-mix(in srgb, ' + ps.color + ' 14%, transparent)', padding: '2px 8px', borderRadius: 'var(--radius-sm)', display: 'inline-block' }}>{ps.label}</span>
              ) : phase ? (
                <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-muted)' }}>{phase}</span>
              ) : <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)', opacity: 0.4 }}>&mdash;</span>}
            </td>
          )
        }

        // Links straight to the PR. The ID column already carries a state dot,
        // but a dot was never clickable — this is the actual affordance.
        case 'pr': {
          const link = githubLinks[task.id]
          const url = link?.pr_url || task.github_pr_url
          const ms = link?.pr_state ? MERGE_STATUS[link.pr_state] : null
          return (
            <td key={key} style={{ padding: '8px 12px' }} onClick={e => e.stopPropagation()}>
              {url ? (
                <a href={url} target="_blank" rel="noreferrer" className="apple-press inline-flex items-center gap-1" title={ms ? PR_TITLE(ms) : 'Open pull request'} style={{ fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-medium)', color: ms?.dotColor || 'var(--text-muted)' }}>
                  <GitPullRequest className="w-3 h-3" />
                  {link?.pr_number ? '#' + link.pr_number : 'PR'}
                </a>
              ) : <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)', opacity: 0.4 }}>&mdash;</span>}
            </td>
          )
        }

        case 'assignee': return (
          <td key={key} style={{ padding: '8px 12px' }} onClick={e => e.stopPropagation()}>
            {editingCell?.taskId === task.id && editingCell?.field === 'assignee' ? (
              <input autoFocus defaultValue={task.assignee || ''} onBlur={(e) => handleInlineUpdate(task.id, 'assignee', e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleInlineUpdate(task.id, 'assignee', e.target.value); if (e.key === 'Escape') setEditingCell(null) }} className="w-full focus:outline-none" style={{ background: 'var(--fill-secondary)', borderRadius: 'var(--radius-sm)', padding: '2px 8px', fontSize: 'var(--text-caption1)', color: 'var(--text-app)', border: 'none', boxShadow: '0 0 0 2px color-mix(in srgb, var(--accent-app) 30%, transparent)' }} />
            ) : (
              <button onClick={() => setEditingCell({ taskId: task.id, field: 'assignee' })} className="flex items-center gap-1.5" style={{ fontSize: 'var(--text-caption1)', color: task.assignee ? 'var(--text-muted)' : 'var(--text-tertiary)', transition: 'color var(--duration-fast)' }}>
                {task.assignee ? (
                  <>
                    <div className="w-4 h-4 rounded-full flex items-center justify-center text-white shrink-0" style={{ fontSize: '8px', fontWeight: 'var(--font-semibold)', background: 'var(--gray-2)' }}>{task.assignee.charAt(0).toUpperCase()}</div>
                    <span className="truncate max-w-[80px]">{task.assignee}</span>
                  </>
                ) : <>&mdash;</>}
              </button>
            )}
          </td>
        )

        case 'updated': return (
          <td key={key} style={{ padding: '8px 12px' }}>
            <span className="flex items-center gap-1" style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }}>
              <Clock className="w-3 h-3" />{relativeTime(getLastUpdated(task))}
            </span>
          </td>
        )

        case 'type': return (
          <td key={key} style={{ padding: '8px 12px' }}>
            {task.type && (
              <span style={{ fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-semibold)', textTransform: 'uppercase', color: ts.color, background: ts.bg, padding: '2px 8px', borderRadius: 'var(--radius-sm)', display: 'inline-block' }}>{task.type}</span>
            )}
          </td>
        )

        case 'project': return (
          <td key={key} style={{ padding: '8px 12px' }}>
            <span className="truncate max-w-[100px] block" style={{ fontSize: 'var(--text-caption1)', color: 'var(--text-muted)' }}>{task.project || '\u2014'}</span>
          </td>
        )

        case 'component': return (
          <td key={key} style={{ padding: '8px 12px' }}>
            <span className="truncate max-w-[120px] block" style={{ fontSize: 'var(--text-caption1)', color: 'var(--text-muted)' }}>{task.component || '\u2014'}</span>
          </td>
        )

        // 'parent' column dropped (FR-036) — lineage is shown structurally
        // by the Thread grouping instead of as a raw id cell.

        // Phase tags render here too (ui-create-dejargon-001, P1-12): the
        // Tags column claiming fewer tags than the task carries reads as data
        // loss, and hides phases entirely for users who toggled the Phase
        // column off.
        case 'tags': {
          const tags = (task.tags || []).filter(x => typeof x === 'string')
          return (
            <td key={key} style={{ padding: '8px 12px' }}>
              <div className="flex items-center gap-1 flex-nowrap overflow-hidden">
                {tags.slice(0, 3).map(x => (
                  <span key={x} className="shrink-0" style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)', background: 'var(--fill-secondary)', padding: '1px 6px', borderRadius: 'var(--radius-sm)' }}>{x}</span>
                ))}
                {tags.length > 3 && <span className="shrink-0" style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }}>+{tags.length - 3}</span>}
                {tags.length === 0 && <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)', opacity: 0.4 }}>&mdash;</span>}
              </div>
            </td>
          )
        }

        default: return null
        }
      })}
    </tr>
  )
}
