import { memo, useState, useCallback, useMemo, useRef, Fragment } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowUp, ArrowDown, ChevronRight, ChevronDown, Layers, Columns3, Check } from 'lucide-react'
import TaskRow from './viz/TaskRow'
import { buildTreeRows, BUCKET_STANDALONE, BUCKET_ORPHAN } from '../lib/taskTree'
import {
  ALL_COLUMNS, LOCKED, loadVisibleColumns, saveVisibleColumns,
  toggleColumn, resolveColumns, phaseOf,
} from '../lib/listColumns'

const GROUP_BY_OPTIONS = [
  { key: 'none', label: 'No grouping' },
  { key: 'status', label: 'Status' },
  { key: 'assignee', label: 'Assignee' },
  { key: 'priority', label: 'Priority' },
  { key: 'type', label: 'Type' },
  { key: 'component', label: 'Component' },
  // Hierarchy grouping. Measured on the real board: 220 of 769 tasks carry
  // a parent_task, forming 72 families up to 3 deep.
  { key: 'parent', label: 'Parent / subtasks' },
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
  const [visibleColumns, setVisibleColumns] = useState(() => loadVisibleColumns())
  const [pickerOpen, setPickerOpen] = useState(false)
  // Tree collapse is keyed by TASK id, separate from collapsedGroups which
  // is keyed by group NAME — a task id and a group name can collide.
  const [collapsedNodes, setCollapsedNodes] = useState({})
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
        // Phase sorts in pipeline order, not alphabetically — 'implement'
        // coming before 'plan' would be actively misleading.
        case 'phase': {
          const phaseOrder = { research: 0, plan: 1, implement: 2 }
          cmp = (phaseOrder[phaseOf(a)] ?? 3) - (phaseOrder[phaseOf(b)] ?? 3); break
        }
        case 'updated': cmp = new Date(getLastUpdated(b)).getTime() - new Date(getLastUpdated(a)).getTime(); break
        case 'title': case 'id': case 'assignee': case 'type': case 'project': case 'component': case 'parent':
          cmp = ((sortKey === 'parent' ? a.parent_task : a[sortKey]) || '')
            .localeCompare((sortKey === 'parent' ? b.parent_task : b[sortKey]) || ''); break
        default: cmp = 0
      }
      return sortDir === 'desc' ? -cmp : cmp
    })
  }, [tasks, sortKey, sortDir])

  const handleGroupByChange = useCallback((value) => { setGroupBy(value); localStorage.setItem('taskBoardListGroup', value); setCollapsedGroups({}); setCollapsedNodes({}) }, [])
  const toggleGroup = useCallback((groupName) => { setCollapsedGroups(prev => ({ ...prev, [groupName]: !prev[groupName] })) }, [])
  const expandAllGroups = useCallback(() => { setCollapsedGroups({}); setCollapsedNodes({}) }, [])
  const collapseAllGroups = useCallback(() => {
    if (groupBy === 'none') return
    if (groupBy === 'parent') {
      // Collapse every task that HAS children, so only roots remain.
      const parents = {}
      sortedTasks.forEach(t => { if (t.parent_task) parents[t.parent_task] = true })
      setCollapsedNodes(parents)
      return
    }
    const all = {}
    sortedTasks.forEach(t => { all[t[groupBy] || 'Unassigned'] = true })
    setCollapsedGroups(all)
  }, [groupBy, sortedTasks])

  const handleToggleColumn = useCallback((key) => {
    setVisibleColumns(prev => {
      const next = toggleColumn(prev, key)
      saveVisibleColumns(next)
      return next
    })
  }, [])

  const columns = useMemo(() => resolveColumns(visibleColumns), [visibleColumns])

  const toggleNode = useCallback((taskId) => {
    setCollapsedNodes(prev => ({ ...prev, [taskId]: !prev[taskId] }))
  }, [])

  // Tree mode is its own shape, so it is built separately from the flat
  // key-based grouping below.
  const treeData = useMemo(
    () => (groupBy === 'parent' ? buildTreeRows(sortedTasks, collapsedNodes) : null),
    [groupBy, sortedTasks, collapsedNodes]
  )

  const groupedTasks = useMemo(() => {
    if (groupBy === 'none' || groupBy === 'parent') return null
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
  // Tree mode can't be virtualized — row heights depend on collapse state
  // that the virtualizer has no view of. Same reason the other groupings
  // opt out.
  const shouldVirtualize = groupBy === 'none' && sortedTasks.length > 50
  const rowVirtualizer = useVirtualizer({ count: shouldVirtualize ? sortedTasks.length : 0, getScrollElement: () => tableContainerRef.current, estimateSize: () => 44, overscan: 15 })

  const renderRow = (task, treeMeta = null) => (
    <TaskRow
      key={task.id}
      task={task}
      columns={visibleColumns}
      depth={treeMeta?.depth || 0}
      childCount={treeMeta?.childCount || 0}
      isCollapsed={!!collapsedNodes[task.id]}
      onToggleCollapse={toggleNode}
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

  const colCount = columns.length + (selectable ? 1 : 0)

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

        {/* Column picker. Sits beside group-by and borrows its pill styling so
            the two read as one toolbar rather than two eras of design. */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setPickerOpen(v => !v)}
            className="apple-press flex items-center gap-1.5"
            aria-expanded={pickerOpen}
            aria-haspopup="true"
            title="Choose columns"
            style={{ padding: '5px 10px', borderRadius: 'var(--radius-full)', fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-medium)', border: 'none', color: 'var(--text-muted)', background: 'var(--fill-secondary)' }}
          >
            <Columns3 className="w-3.5 h-3.5" />
            Columns
          </button>
          {pickerOpen && (
            <>
              {/* Click-away layer — a plain overlay is enough here and avoids
                  a document-level listener that would fight the table's own
                  click handling. */}
              <div onClick={() => setPickerOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
              <div
                role="menu"
                style={{
                  position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 41,
                  minWidth: '190px', padding: '6px',
                  background: 'var(--bg-card)', border: 'var(--border-hairline)',
                  borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-popover)',
                }}
              >
                {ALL_COLUMNS.map(col => {
                  const on = visibleColumns.includes(col.key)
                  const locked = LOCKED.includes(col.key)
                  return (
                    <button
                      key={col.key}
                      role="menuitemcheckbox"
                      aria-checked={on}
                      disabled={locked}
                      onClick={() => handleToggleColumn(col.key)}
                      className="w-full flex items-center gap-2 apple-press"
                      title={locked ? 'Always shown' : undefined}
                      style={{
                        padding: '6px 8px', borderRadius: 'var(--radius-sm)',
                        fontSize: 'var(--text-caption1)', textAlign: 'left',
                        background: 'transparent', border: 'none',
                        color: locked ? 'var(--text-tertiary)' : 'var(--text-app)',
                        cursor: locked ? 'default' : 'pointer',
                        opacity: locked ? 0.6 : 1,
                      }}
                    >
                      <span style={{ width: '14px', display: 'inline-flex', flexShrink: 0 }}>
                        {on && <Check className="w-3.5 h-3.5" style={{ color: 'var(--accent-app)' }} />}
                      </span>
                      {col.label}
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>

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
            {columns.map(col => (
              <th key={col.key} onClick={() => col.sortable && handleSort(col.key)} className={`${col.width} select-none ${col.sortable ? 'cursor-pointer' : ''}`} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-semibold)', color: 'var(--text-tertiary)', letterSpacing: 'var(--tracking-wide)', transition: `color var(--duration-fast)` }} onMouseEnter={e => e.currentTarget.style.color = 'var(--text-app)'} onMouseLeave={e => e.currentTarget.style.color = 'var(--text-tertiary)'}>
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
          ) : treeData ? (
            <>
              {/* Families first — a root with descendants, rendered as an
                  indented subtree. */}
              {treeData.families.map(family => (
                <Fragment key={family.root.id}>
                  {family.rows.map(row => renderRow(row.task, row))}
                </Fragment>
              ))}

              {/* Then the flat majority. Collapsed by default would hide most
                  of the board, so this bucket starts open. */}
              {treeData.standalone.length > 0 && (
                <Fragment key="__standalone__">
                  <tr onClick={() => toggleGroup(BUCKET_STANDALONE)} className="cursor-pointer apple-press" style={{ borderBottom: '0.5px solid var(--separator)', background: 'var(--fill-secondary)' }}>
                    <td colSpan={colCount} style={{ padding: '10px 12px' }}>
                      <div className="flex items-center gap-2">
                        {collapsedGroups[BUCKET_STANDALONE] ? <ChevronRight className="w-3.5 h-3.5" style={{ color: 'var(--text-tertiary)' }} /> : <ChevronDown className="w-3.5 h-3.5" style={{ color: 'var(--text-tertiary)' }} />}
                        <span style={{ fontSize: 'var(--text-footnote)', fontWeight: 'var(--font-semibold)', color: 'var(--text-app)' }}>{BUCKET_STANDALONE}</span>
                        <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }}>{treeData.standalone.length} tasks</span>
                      </div>
                    </td>
                  </tr>
                  {!collapsedGroups[BUCKET_STANDALONE] && treeData.standalone.map(t => renderRow(t))}
                </Fragment>
              )}

              {/* Children whose parent isn't in the current view — usually
                  because a filter hid it. Surfaced rather than dropped, since
                  silently vanishing rows read as data loss. */}
              {treeData.orphans.length > 0 && (
                <Fragment key="__orphans__">
                  <tr onClick={() => toggleGroup(BUCKET_ORPHAN)} className="cursor-pointer apple-press" style={{ borderBottom: '0.5px solid var(--separator)', background: 'var(--fill-secondary)' }}>
                    <td colSpan={colCount} style={{ padding: '10px 12px' }}>
                      <div className="flex items-center gap-2">
                        {collapsedGroups[BUCKET_ORPHAN] ? <ChevronRight className="w-3.5 h-3.5" style={{ color: 'var(--text-tertiary)' }} /> : <ChevronDown className="w-3.5 h-3.5" style={{ color: 'var(--text-tertiary)' }} />}
                        <span style={{ fontSize: 'var(--text-footnote)', fontWeight: 'var(--font-semibold)', color: 'var(--text-app)' }}>{BUCKET_ORPHAN}</span>
                        <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }}>{treeData.orphans.length} tasks</span>
                        <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)', opacity: 0.7 }}>parent hidden by a filter, or missing</span>
                      </div>
                    </td>
                  </tr>
                  {!collapsedGroups[BUCKET_ORPHAN] && treeData.orphans.map(t => renderRow(t))}
                </Fragment>
              )}
            </>
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
