import { memo, useState, useCallback, useMemo, useRef, Fragment } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowUp, ArrowDown, ChevronRight, ChevronDown, Layers } from 'lucide-react'
import TaskRow from './viz/TaskRow'

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

  const renderRow = (task) => (
    <TaskRow
      key={task.id}
      task={task}
      onSelectTask={onSelectTask}
      selectable={selectable}
      selectedIds={selectedIds}
      onToggleSelect={onToggleSelect}
      activeAgents={activeAgents}
      taskViewers={taskViewers}
      recentlyUpdatedIds={recentlyUpdatedIds}
      githubLinks={githubLinks}
      copiedId={copiedId}
      editingCell={editingCell}
      setEditingCell={setEditingCell}
      handleCopyId={handleCopyId}
      handleImmediateUpdate={handleImmediateUpdate}
      handleInlineUpdate={handleInlineUpdate}
    />
  )

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
      <div ref={tableContainerRef} className={`overflow-x-auto custom-scrollbar flex-1 ${shouldVirtualize ? 'overflow-y-auto' : ''}`} style={{ borderRadius: 'var(--radius-md)', background: 'var(--bg-secondary)', border: 'var(--border-hairline)', minHeight: 0 }}>
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
