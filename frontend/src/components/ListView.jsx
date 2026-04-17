import { memo, useState, useCallback, useMemo, useRef, Fragment } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowUp, ArrowDown, Copy, Check, Loader2, UserCircle2, Circle, AlertCircle, CheckCircle2, Eye, Clock, ChevronRight, ChevronDown, ChevronsUpDown, Layers, GitPullRequest, GitMerge } from 'lucide-react'
import { STATUS_OPTIONS, PRIORITY_COLOR, STATUS_COLOR, TYPE_STYLE, VIEWER_COLORS, MERGE_STATUS } from '../constants'

const PRIORITY_CYCLE = ['low', 'medium', 'high']

const COLUMNS = [
  { key: 'id', label: 'ID', width: 'w-32' },
  { key: 'title', label: 'Title', width: 'flex-1 min-w-[200px]' },
  { key: 'status', label: 'Status', width: 'w-28' },
  { key: 'priority', label: 'Priority', width: 'w-24' },
  { key: 'assignee', label: 'Assignee', width: 'w-28' },
  { key: 'type', label: 'Type', width: 'w-24' },
  { key: 'project', label: 'Project', width: 'w-28' },
  { key: 'component', label: 'Component', width: 'w-32' },
  { key: 'due_date', label: 'Due', width: 'w-24' },
  { key: 'updated', label: 'Updated', width: 'w-24' },
]

const GROUP_BY_OPTIONS = [
  { key: 'none', label: 'No grouping' },
  { key: 'status', label: 'Status' },
  { key: 'assignee', label: 'Assignee' },
  { key: 'priority', label: 'Priority' },
  { key: 'type', label: 'Type' },
  { key: 'component', label: 'Component' },
]

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

function ListView({ tasks, onSelectTask, onUpdateTask, activeAgents = [], taskViewers = {}, currentUser, selectable, selectedIds = [], onToggleSelect, recentlyUpdatedIds = [], githubLinks = {} }) {
  const [sortKey, setSortKey] = useState(() => localStorage.getItem('taskBoardListSort') || 'priority')
  const [sortDir, setSortDir] = useState(() => localStorage.getItem('taskBoardListDir') || 'asc')
  const [groupBy, setGroupBy] = useState(() => localStorage.getItem('taskBoardListGroup') || 'none')
  const [collapsedGroups, setCollapsedGroups] = useState({})
  const [editingCell, setEditingCell] = useState(null)
  const [copiedId, setCopiedId] = useState(null)
  const debounceRef = useRef({})

  const handleSort = useCallback((key) => {
    setSortKey(prev => {
      const newDir = prev === key && sortDir === 'asc' ? 'desc' : 'asc'
      setSortDir(newDir)
      localStorage.setItem('taskBoardListSort', key)
      localStorage.setItem('taskBoardListDir', newDir)
      return key
    })
  }, [sortDir])

  const sortedTasks = useMemo(() => {
    const priorityOrder = { high: 0, medium: 1, low: 2 }
    const statusOrder = { in_progress: 0, todo: 1, review: 2, done: 3 }
    return [...tasks].sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'priority': cmp = (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3); break
        case 'status': cmp = (statusOrder[a.status] ?? 4) - (statusOrder[b.status] ?? 4); break
        case 'due_date': cmp = (a.due_date ? new Date(a.due_date).getTime() : Infinity) - (b.due_date ? new Date(b.due_date).getTime() : Infinity); break
        case 'updated': cmp = new Date(getLastUpdated(b)).getTime() - new Date(getLastUpdated(a)).getTime(); break
        case 'title': case 'id': case 'assignee': case 'type': case 'project': case 'component':
          cmp = (a[sortKey] || '').localeCompare(b[sortKey] || ''); break
        default: cmp = 0
      }
      return sortDir === 'desc' ? -cmp : cmp
    })
  }, [tasks, sortKey, sortDir])

  const handleGroupByChange = useCallback((value) => { setGroupBy(value); localStorage.setItem('taskBoardListGroup', value); setCollapsedGroups({}) }, [])
  const toggleGroup = useCallback((groupName) => { setCollapsedGroups(prev => ({ ...prev, [groupName]: !prev[groupName] })) }, [])
  const expandAllGroups = useCallback(() => setCollapsedGroups({}), [])
  const collapseAllGroups = useCallback(() => {
    if (groupBy === 'none') return
    const all = {}
    sortedTasks.forEach(t => { all[t[groupBy] || 'Unassigned'] = true })
    setCollapsedGroups(all)
  }, [groupBy, sortedTasks])

  const groupedTasks = useMemo(() => {
    if (groupBy === 'none') return null
    const groups = new Map()
    for (const task of sortedTasks) {
      const key = task[groupBy] || 'Unassigned'
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(task)
    }
    return groups
  }, [sortedTasks, groupBy])

  const handleCopyId = useCallback((e, id) => { e.stopPropagation(); navigator.clipboard.writeText(id); setCopiedId(id); setTimeout(() => setCopiedId(null), 1500) }, [])

  const handleInlineUpdate = useCallback((taskId, field, value) => {
    const key = `${taskId}-${field}`
    if (debounceRef.current[key]) clearTimeout(debounceRef.current[key])
    debounceRef.current[key] = setTimeout(() => { onUpdateTask(taskId, { [field]: value }); delete debounceRef.current[key] }, 300)
    setEditingCell(null)
  }, [onUpdateTask])

  const handleImmediateUpdate = useCallback((taskId, field, value) => { onUpdateTask(taskId, { [field]: value }); setEditingCell(null) }, [onUpdateTask])

  const tableContainerRef = useRef(null)
  const shouldVirtualize = groupBy === 'none' && sortedTasks.length > 50
  const rowVirtualizer = useVirtualizer({ count: shouldVirtualize ? sortedTasks.length : 0, getScrollElement: () => tableContainerRef.current, estimateSize: () => 44, overscan: 15 })

  const renderRow = (task) => {
    const isAgentRunning = activeAgents.some(a => a.taskId === task.id)
    const viewers = taskViewers[task.id] || []
    const justUpdated = recentlyUpdatedIds.includes(task.id)
    const pc = PRIORITY_COLOR[task.priority] || PRIORITY_COLOR.medium
    const ts = TYPE_STYLE[task.type || 'fullstack'] || TYPE_STYLE.fullstack

    return (
      <tr
        key={task.id}
        onClick={() => onSelectTask(task)}
        className="cursor-pointer"
        style={{
          borderBottom: '0.5px solid var(--separator)',
          borderLeft: `3px solid ${pc}`,
          background: selectedIds.includes(task.id) ? 'color-mix(in srgb, var(--accent-app) 8%, transparent)' : justUpdated ? 'color-mix(in srgb, var(--accent-app) 6%, transparent)' : 'transparent',
          transition: `background var(--duration-fast) var(--ease-default)`,
        }}
        onMouseEnter={e => { if (!selectedIds.includes(task.id)) e.currentTarget.style.background = 'color-mix(in srgb, var(--accent-app) 4%, transparent)' }}
        onMouseLeave={e => { if (!selectedIds.includes(task.id) && !recentlyUpdatedIds.includes(task.id)) e.currentTarget.style.background = 'transparent' }}
      >
        {selectable && (
          <td style={{ padding: '8px' }} onClick={e => e.stopPropagation()}>
            <input type="checkbox" checked={selectedIds.includes(task.id)} onChange={() => onToggleSelect(task.id)} style={{ accentColor: 'var(--accent-app)', cursor: 'pointer' }} />
          </td>
        )}
        {/* ID + PR status */}
        <td style={{ padding: '8px 12px' }}>
          <div className="flex items-center gap-1.5">
            <button onClick={(e) => handleCopyId(e, task.id)} className="apple-press flex items-center gap-1" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-medium)', color: 'var(--text-tertiary)', background: 'var(--fill-secondary)', padding: '2px 8px', borderRadius: 'var(--radius-sm)' }} title="Copy ID">
              {copiedId === task.id ? <Check className="w-2.5 h-2.5" style={{ color: 'var(--apple-green)' }} /> : <Copy className="w-2.5 h-2.5" />}
              {task.id}
            </button>
            {(() => {
              const link = githubLinks[task.id]
              if (!link?.pr_number) return null
              const ms = MERGE_STATUS[link.pr_state]
              if (!ms) return null
              const PrIcon = link.pr_state === 'MERGED' ? GitMerge : GitPullRequest
              return (
                <span
                  className="flex items-center gap-1"
                  style={{
                    padding: '1px 6px',
                    borderRadius: 'var(--radius-sm)',
                    background: `color-mix(in srgb, ${ms.color} 10%, transparent)`,
                    border: `1px solid color-mix(in srgb, ${ms.color} 25%, transparent)`,
                    fontSize: '10px',
                    fontWeight: 600,
                    color: ms.color,
                  }}
                  title={`PR #${link.pr_number} — ${ms.label}`}
                >
                  <PrIcon className="w-2.5 h-2.5" />
                  #{link.pr_number}
                </span>
              )
            })()}
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
                  <div key={v} className="w-5 h-5 rounded-full flex items-center justify-center text-white" style={{ fontSize: '8px', fontWeight: 'var(--font-bold)', backgroundColor: VIEWER_COLORS[i % VIEWER_COLORS.length], border: '2px solid var(--bg-card)' }} title={v}>{v[0]?.toUpperCase()}</div>
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
                  <div className="w-4 h-4 rounded-full flex items-center justify-center text-white shrink-0" style={{ fontSize: '8px', fontWeight: 'var(--font-bold)', background: 'var(--gray-2)' }}>{task.assignee.charAt(0).toUpperCase()}</div>
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

  const colCount = COLUMNS.length + (selectable ? 1 : 0)

  return (
    <div className="flex flex-col gap-3 h-full min-h-0">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-1">
        <div className="flex items-center gap-2">
          <Layers className="w-3.5 h-3.5" style={{ color: 'var(--text-tertiary)' }} />
          <select value={groupBy} onChange={(e) => handleGroupByChange(e.target.value)} className="cursor-pointer focus:outline-none" style={{ padding: '5px 10px', borderRadius: 'var(--radius-full)', fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-medium)', border: 'none', color: groupBy !== 'none' ? 'var(--accent-app)' : 'var(--text-muted)', background: groupBy !== 'none' ? 'color-mix(in srgb, var(--accent-app) 10%, transparent)' : 'var(--fill-secondary)' }}>
            {GROUP_BY_OPTIONS.map(opt => <option key={opt.key} value={opt.key}>{opt.label}</option>)}
          </select>
        </div>
        {groupBy !== 'none' && (
          <div className="flex items-center gap-1">
            <button onClick={expandAllGroups} className="apple-press" style={{ padding: '4px 10px', borderRadius: 'var(--radius-full)', fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-medium)', color: 'var(--text-muted)' }}>Expand all</button>
            <button onClick={collapseAllGroups} className="apple-press" style={{ padding: '4px 10px', borderRadius: 'var(--radius-full)', fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-medium)', color: 'var(--text-muted)' }}>Collapse all</button>
          </div>
        )}
        <div className="flex-1" />
        <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }}>{tasks.length} tasks</span>
      </div>

      {/* Table */}
      <div ref={tableContainerRef} className={`overflow-x-auto custom-scrollbar flex-1 ${shouldVirtualize ? 'overflow-y-auto' : ''}`} style={{ borderRadius: 'var(--radius-lg)', background: 'var(--bg-secondary)', boxShadow: 'var(--shadow-sm)', minHeight: 0 }}>
      <table className="w-full min-w-[900px] border-collapse">
        <thead>
          <tr style={{ borderBottom: '0.5px solid var(--separator)' }}>
            {selectable && (
              <th style={{ width: '40px', padding: '10px 8px' }}>
                <input type="checkbox" checked={selectedIds.length === tasks.length && tasks.length > 0} onChange={() => { if (selectedIds.length === tasks.length) { tasks.forEach(t => onToggleSelect(t.id)) } else { tasks.filter(t => !selectedIds.includes(t.id)).forEach(t => onToggleSelect(t.id)) } }} style={{ accentColor: 'var(--accent-app)', cursor: 'pointer' }} />
              </th>
            )}
            {COLUMNS.map(col => (
              <th key={col.key} onClick={() => handleSort(col.key)} className={`${col.width} select-none cursor-pointer`} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-semibold)', color: 'var(--text-tertiary)', letterSpacing: 'var(--tracking-wide)', transition: `color var(--duration-fast)` }} onMouseEnter={e => e.currentTarget.style.color = 'var(--text-app)'} onMouseLeave={e => e.currentTarget.style.color = 'var(--text-tertiary)'}>
                <div className="flex items-center gap-1">
                  {col.label}
                  {sortKey === col.key && (
                    sortDir === 'asc'
                      ? <ArrowUp className="w-3 h-3" style={{ color: 'var(--accent-app)' }} />
                      : <ArrowDown className="w-3 h-3" style={{ color: 'var(--accent-app)' }} />
                  )}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedTasks.length === 0 ? (
            <tr>
              <td colSpan={colCount} className="text-center" style={{ padding: '48px', fontSize: 'var(--text-subhead)', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>No tasks match the current filters</td>
            </tr>
          ) : groupedTasks ? (
            Array.from(groupedTasks.entries()).map(([groupName, groupTasks]) => {
              const isCollapsed = collapsedGroups[groupName]
              const doneCount = groupTasks.filter(t => t.status === 'done').length
              return (
                <Fragment key={groupName}>
                  <tr onClick={() => toggleGroup(groupName)} className="cursor-pointer apple-press" style={{ borderBottom: '0.5px solid var(--separator)', background: 'var(--fill-secondary)', transition: `background var(--duration-fast)` }}>
                    <td colSpan={colCount} style={{ padding: '10px 12px' }}>
                      <div className="flex items-center gap-2">
                        {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" style={{ color: 'var(--text-tertiary)' }} /> : <ChevronDown className="w-3.5 h-3.5" style={{ color: 'var(--text-tertiary)' }} />}
                        <span style={{ fontSize: 'var(--text-footnote)', fontWeight: 'var(--font-semibold)', color: 'var(--text-app)' }}>{groupName}</span>
                        <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }}>{groupTasks.length} tasks</span>
                        <div style={{ flex: '0 0 100px', height: '4px', borderRadius: 'var(--radius-full)', background: 'var(--fill-primary)', overflow: 'hidden' }}>
                          <div style={{ height: '100%', borderRadius: 'var(--radius-full)', background: 'var(--apple-green)', width: `${groupTasks.length > 0 ? (doneCount / groupTasks.length) * 100 : 0}%`, transition: `width var(--duration-slow) var(--ease-out)` }} />
                        </div>
                        <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }}>{doneCount}/{groupTasks.length}</span>
                      </div>
                    </td>
                  </tr>
                  {!isCollapsed && groupTasks.map(renderRow)}
                </Fragment>
              )
            })
          ) : shouldVirtualize ? (
            <>
              {rowVirtualizer.getVirtualItems().length === 0 && (
                <tr><td colSpan={colCount} className="text-center" style={{ padding: '48px', color: 'var(--text-tertiary)' }}>No tasks</td></tr>
              )}
              <tr style={{ height: `${rowVirtualizer.getVirtualItems()[0]?.start ?? 0}px` }}><td colSpan={colCount} /></tr>
              {rowVirtualizer.getVirtualItems().map(virtualRow => renderRow(sortedTasks[virtualRow.index]))}
              <tr style={{ height: `${rowVirtualizer.getTotalSize() - (rowVirtualizer.getVirtualItems().at(-1)?.end ?? 0)}px` }}><td colSpan={colCount} /></tr>
            </>
          ) : (
            sortedTasks.map(renderRow)
          )}
        </tbody>
      </table>
      </div>
    </div>
  )
}

export default memo(ListView)
