import { memo, useState, useCallback, useMemo, useRef, useEffect, Fragment } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowUp, ArrowDown, ChevronRight, ChevronDown, Layers, Columns3, Check } from 'lucide-react'
import TaskRow from './viz/TaskRow'
import { Select, Button } from './ui'
import useIsMobile from '../hooks/useIsMobile'
import { buildThreadRows, BUCKET_STANDALONE, BUCKET_ORPHAN } from '../lib/taskThreads'
import { STATUS_OPTIONS, STATUS_COLOR, PRIORITY_COLOR } from '../constants'
import {
  ALL_COLUMNS, LOCKED, loadVisibleColumns, saveVisibleColumns,
  toggleColumn, resolveColumns, phaseOf,
} from '../lib/listColumns'

const GROUP_BY_OPTIONS = [
  { key: 'status', label: 'Status' },
  // Thread = parent/subtask families ∪ research→plan→implement chains
  // stitched via depends_on (lib/taskThreads.js). Replaced the old
  // parent-only tree (ui-list-redesign-impl-001).
  { key: 'thread', label: 'Thread' },
  { key: 'assignee', label: 'Assignee' },
  { key: 'priority', label: 'Priority' },
  { key: 'type', label: 'Type' },
  { key: 'component', label: 'Component' },
  { key: 'none', label: 'No grouping' },
]

// Status groups render in lifecycle order with their display labels, not in
// whatever order the sort happened to surface them — "Review" above "Done",
// always. Done starts collapsed: measured 2026-08, 84% of this board's rows
// were done tasks, and an ungrouped wall of finished work was the single
// biggest new-user complaint about this view.
const STATUS_GROUP_ORDER = ['draft', 'todo', 'in_progress', 'waiting_input', 'review', 'done']
const statusLabel = (id) => STATUS_OPTIONS.find(s => s.id === id)?.label || id
const DONE_GROUP_LABEL = statusLabel('done')

// Group-key fallbacks respect the glossary: "Unassigned" belongs to the
// assignee dimension only (ui-copy-glossary-001).
const GROUP_FALLBACK = { assignee: 'Unassigned', component: 'No component', type: 'No type', priority: 'No priority' }

// Pre-redesign persisted value; the old key maps onto its successor.
const migrateGroupBy = (stored) => (stored === 'parent' ? 'thread' : stored)

function getLastUpdated(task) {
  if (task.activity_log && task.activity_log.length > 0) {
    return task.activity_log[task.activity_log.length - 1].timestamp
  }
  return task.created_at
}

function relativeShort(dateStr) {
  if (!dateStr) return '—'
  const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function ListView({ tasks, onSelectTask, onUpdateTask, activeAgents = [], taskViewers = {}, currentUser, selectable, selectedIds = [], onToggleSelect, onShiftSelect, recentlyUpdatedIds = [], githubLinks = {}, onCreateTask }) {
  const isMobile = useIsMobile()
  const [sortKey, setSortKey] = useState(() => localStorage.getItem('taskBoardListSort') || 'priority')
  const [sortDir, setSortDir] = useState(() => localStorage.getItem('taskBoardListDir') || 'asc')
  // Status grouping is the DEFAULT for first-time users; a stored choice
  // (including an explicit 'none') always wins (ui-list-redesign-impl-001).
  const [groupBy, setGroupBy] = useState(() => migrateGroupBy(localStorage.getItem('taskBoardListGroup')) || 'status')
  // Done starts collapsed on the default status view. Session state only —
  // toggling is cheap, persisting a collapse map is not worth the staleness.
  const [collapsedGroups, setCollapsedGroups] = useState(() =>
    (migrateGroupBy(localStorage.getItem('taskBoardListGroup')) || 'status') === 'status'
      ? { [DONE_GROUP_LABEL]: true }
      : {}
  )
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

  const handleGroupByChange = useCallback((value) => {
    setGroupBy(value)
    localStorage.setItem('taskBoardListGroup', value)
    // Fresh grouping, fresh collapse state — except the status view keeps
    // its Done-starts-collapsed default.
    setCollapsedGroups(value === 'status' ? { [DONE_GROUP_LABEL]: true } : {})
    setCollapsedNodes({})
  }, [])
  const toggleGroup = useCallback((groupName) => { setCollapsedGroups(prev => ({ ...prev, [groupName]: !prev[groupName] })) }, [])
  const expandAllGroups = useCallback(() => { setCollapsedGroups({}); setCollapsedNodes({}) }, [])
  const collapseAllGroups = useCallback(() => {
    if (groupBy === 'none') return
    if (groupBy === 'thread') {
      // Collapse every display-parent, so only thread roots remain. The
      // display tree (not raw parent_task) is the truth here — a chain's
      // middle task is a display parent even with no parent_task field.
      const { threads } = buildThreadRows(sortedTasks)
      const parents = {}
      for (const th of threads) {
        for (const row of th.rows) { if (row.childCount > 0) parents[row.task.id] = true }
      }
      setCollapsedNodes(parents)
      return
    }
    const all = {}
    sortedTasks.forEach(t => {
      const key = groupBy === 'status'
        ? statusLabel(t.status)
        : (t[groupBy] || GROUP_FALLBACK[groupBy] || '—')
      all[key] = true
    })
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

  // Thread mode is its own shape, so it is built separately from the flat
  // key-based grouping below.
  const threadData = useMemo(
    () => (groupBy === 'thread' ? buildThreadRows(sortedTasks, collapsedNodes) : null),
    [groupBy, sortedTasks, collapsedNodes]
  )

  const groupedTasks = useMemo(() => {
    if (groupBy === 'none' || groupBy === 'thread') return null
    const groups = new Map()
    if (groupBy === 'status') {
      // Lifecycle order, seeded up front so Map insertion order is the
      // render order; empty statuses are pruned after.
      for (const id of STATUS_GROUP_ORDER) groups.set(statusLabel(id), [])
      for (const task of sortedTasks) {
        const key = statusLabel(task.status)
        if (!groups.has(key)) groups.set(key, []) // unknown status → its own group at the end
        groups.get(key).push(task)
      }
      for (const [key, list] of groups) { if (list.length === 0) groups.delete(key) }
      return groups
    }
    for (const task of sortedTasks) {
      const key = task[groupBy] || GROUP_FALLBACK[groupBy] || '—'
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(task)
    }
    return groups
  }, [sortedTasks, groupBy])

  // Clipboard writes can reject (unfocused page, non-secure context) — the
  // check feedback still shows, and an unhandled rejection would trip vite's
  // dev error overlay over the whole app.
  const handleCopyId = useCallback((e, id) => { e.stopPropagation(); navigator.clipboard?.writeText(id).catch(() => {}); setCopiedId(id); setTimeout(() => setCopiedId(null), 1500) }, [])

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

  // The keyboard's view of the table: every task row currently rendered, in
  // render order, collapse-aware. Shift-click range selection reuses the same
  // order (ui-list-redesign-impl-001, keyboard + selection parity).
  const visibleOrderedTasks = useMemo(() => {
    if (threadData) {
      const out = []
      for (const th of threadData.threads) for (const row of th.rows) out.push(row.task)
      if (!collapsedGroups[BUCKET_STANDALONE]) out.push(...threadData.standalone)
      if (!collapsedGroups[BUCKET_ORPHAN]) out.push(...threadData.orphans)
      return out
    }
    if (groupedTasks) {
      const out = []
      for (const [name, list] of groupedTasks.entries()) {
        if (!collapsedGroups[name]) out.push(...list)
      }
      return out
    }
    return sortedTasks
  }, [threadData, groupedTasks, collapsedGroups, sortedTasks])
  const visibleOrderedIds = useMemo(() => visibleOrderedTasks.map(t => t.id), [visibleOrderedTasks])

  // Roving keyboard focus. ↑/↓ move, Enter opens, Esc clears. Bound on the
  // scroll container (tabIndex 0) so it never fights the inline editors —
  // keys originating from an input/select are ignored.
  const [focusedId, setFocusedId] = useState(null)

  const scrollRowIntoView = useCallback((taskId, index) => {
    if (shouldVirtualize) {
      rowVirtualizer.scrollToIndex(index, { align: 'auto' })
      return
    }
    tableContainerRef.current?.querySelector(`[data-row-id="${CSS.escape(taskId)}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [shouldVirtualize, rowVirtualizer])

  const handleKeyDown = useCallback((e) => {
    const tag = e.target.tagName
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter' && e.key !== 'Escape') return

    if (e.key === 'Escape') { setFocusedId(null); return }

    const idx = focusedId ? visibleOrderedIds.indexOf(focusedId) : -1
    if (e.key === 'Enter') {
      if (idx >= 0) { e.preventDefault(); onSelectTask(visibleOrderedTasks[idx]) }
      return
    }

    e.preventDefault() // arrows must move focus, not scroll the container
    const next = e.key === 'ArrowDown'
      ? Math.min(idx + 1, visibleOrderedIds.length - 1)
      : Math.max(idx <= 0 ? 0 : idx - 1, 0)
    const nextId = visibleOrderedIds[next]
    if (!nextId) return
    setFocusedId(nextId)
    scrollRowIntoView(nextId, next)
  }, [focusedId, visibleOrderedIds, visibleOrderedTasks, onSelectTask, scrollRowIntoView])

  // '/' anywhere (outside a typing context) jumps to the FilterBar search —
  // the box exists two components up but nothing ever focused it from here.
  useEffect(() => {
    const handler = (e) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) return
      const search = document.querySelector('[data-testid="filter-search"]')
      if (search) { e.preventDefault(); search.focus() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

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
      onShiftSelect={onShiftSelect}
      orderedTaskIds={visibleOrderedIds}
      isFocused={focusedId === task.id}
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

  // Shared zero-state: the filters explanation plus a way OUT of the empty
  // screen, matching the Board's empty-state CTA (implicit-affordance 'add').
  const emptyState = (
    <div className="text-center flex flex-col items-center gap-3" style={{ padding: '48px 24px' }}>
      <span style={{ fontSize: 'var(--text-subhead)', color: 'var(--text-tertiary)' }}>No tasks match the current filters</span>
      {onCreateTask && (
        <Button size="sm" onClick={onCreateTask} data-testid="list-empty-create">New Task</Button>
      )}
    </div>
  )

  // Below MOBILE_BREAKPOINT the 640px table would mean sideways scrolling —
  // rows become compact cards instead (ui-list-redesign-impl-001, Q5).
  // Grouping and collapse still work; column picker and checkboxes don't
  // apply here (bulk mode stays a desktop tool).
  if (isMobile) {
    const cardMeta = (t) => [
      statusLabel(t.status),
      t.priority,
      relativeShort(getLastUpdated(t)),
    ]
    const renderCard = (task, depth = 0) => {
      const pc = PRIORITY_COLOR[task.priority] || PRIORITY_COLOR.medium
      return (
        <button
          key={task.id}
          data-testid="list-card"
          onClick={() => onSelectTask(task)}
          className="apple-press w-full text-left"
          style={{
            marginLeft: depth ? Math.min(depth, 4) * 12 + 'px' : 0,
            width: depth ? `calc(100% - ${Math.min(depth, 4) * 12}px)` : '100%',
            padding: '10px 12px',
            borderRadius: 'var(--radius-md)',
            border: 'none',
            borderLeft: `3px solid ${pc}`,
            background: 'var(--bg-card)',
            cursor: 'pointer',
          }}
        >
          <div className="truncate" style={{ fontSize: 'var(--text-subhead)', fontWeight: 'var(--font-medium)', color: 'var(--text-app)' }}>{task.title}</div>
          <div className="flex items-center gap-2" style={{ marginTop: '2px', fontSize: 'var(--text-caption2)' }}>
            <span style={{ color: STATUS_COLOR[task.status] || 'var(--text-muted)', fontWeight: 'var(--font-semibold)' }}>{cardMeta(task)[0]}</span>
            <span style={{ color: pc, textTransform: 'capitalize' }}>{cardMeta(task)[1]}</span>
            <span style={{ color: 'var(--text-tertiary)' }}>{cardMeta(task)[2]}</span>
          </div>
        </button>
      )
    }
    const mobileHeader = (name, count) => (
      <button
        key={`__h_${name}`}
        onClick={() => toggleGroup(name)}
        className="apple-press w-full flex items-center gap-2 text-left"
        style={{ padding: '8px 4px', background: 'transparent', border: 'none', cursor: 'pointer' }}
      >
        {collapsedGroups[name] ? <ChevronRight className="w-3.5 h-3.5" style={{ color: 'var(--text-tertiary)' }} /> : <ChevronDown className="w-3.5 h-3.5" style={{ color: 'var(--text-tertiary)' }} />}
        <span style={{ fontSize: 'var(--text-footnote)', fontWeight: 'var(--font-semibold)', color: 'var(--text-app)' }}>{name}</span>
        <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }}>{count}</span>
      </button>
    )
    return (
      <div className="flex flex-col gap-2 h-full min-h-0" data-testid="list-mobile">
        <div className="flex items-center gap-2 px-1">
          <Layers className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-tertiary)' }} />
          <Select pill active={groupBy !== 'none'} value={groupBy} onChange={(e) => handleGroupByChange(e.target.value)} aria-label="Group tasks by" data-testid="list-group-by">
            {GROUP_BY_OPTIONS.map(opt => <option key={opt.key} value={opt.key}>{opt.label}</option>)}
          </Select>
          <div className="flex-1" />
          <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }}>{tasks.length} tasks</span>
        </div>
        <div className="overflow-y-auto custom-scrollbar flex-1 flex flex-col gap-1.5" style={{ minHeight: 0, paddingBottom: 'var(--space-4)' }}>
          {sortedTasks.length === 0 ? emptyState : threadData ? (
            <>
              {threadData.threads.map(th => th.rows.map(row => renderCard(row.task, row.depth)))}
              {threadData.standalone.length > 0 && mobileHeader(BUCKET_STANDALONE, threadData.standalone.length)}
              {!collapsedGroups[BUCKET_STANDALONE] && threadData.standalone.map(t => renderCard(t))}
              {threadData.orphans.length > 0 && mobileHeader(BUCKET_ORPHAN, threadData.orphans.length)}
              {!collapsedGroups[BUCKET_ORPHAN] && threadData.orphans.map(t => renderCard(t))}
            </>
          ) : groupedTasks ? (
            Array.from(groupedTasks.entries()).map(([name, list]) => (
              <Fragment key={name}>
                {mobileHeader(name, list.length)}
                {!collapsedGroups[name] && list.map(t => renderCard(t))}
              </Fragment>
            ))
          ) : (
            sortedTasks.map(t => renderCard(t))
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 h-full min-h-0">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-1">
        <div className="flex items-center gap-2">
          <Layers className="w-3.5 h-3.5" style={{ color: 'var(--text-tertiary)' }} />
          {/* Shared Select, same control the Board toolbar uses — the last
              native <select> in this toolbar (ui-list-redesign-impl-001). */}
          <Select
            pill
            active={groupBy !== 'none'}
            value={groupBy}
            onChange={(e) => handleGroupByChange(e.target.value)}
            aria-label="Group tasks by"
            data-testid="list-group-by"
          >
            {GROUP_BY_OPTIONS.map(opt => <option key={opt.key} value={opt.key}>{opt.label}</option>)}
          </Select>
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
      <div
        ref={tableContainerRef}
        tabIndex={0}
        role="region"
        aria-label="Task list — arrow keys move, Enter opens"
        onKeyDown={handleKeyDown}
        className={`overflow-x-auto custom-scrollbar flex-1 focus:outline-none ${shouldVirtualize ? 'overflow-y-auto' : ''}`}
        style={{ borderRadius: 'var(--radius-md)', background: 'var(--bg-secondary)', border: 'var(--border-hairline)', minHeight: 0 }}
      >
      <table className="w-full min-w-[640px] border-collapse">
        <thead>
          <tr style={{ borderBottom: '0.5px solid var(--separator)' }}>
            {selectable && (
              <th style={{ width: '40px', padding: '10px 8px' }}>
                <input type="checkbox" aria-label="Select all tasks" checked={selectedIds.length === tasks.length && tasks.length > 0} onChange={() => { if (selectedIds.length === tasks.length) { tasks.forEach(t => onToggleSelect(t.id)) } else { tasks.filter(t => !selectedIds.includes(t.id)).forEach(t => onToggleSelect(t.id)) } }} style={{ accentColor: 'var(--accent-app)', cursor: 'pointer' }} />
              </th>
            )}
            {columns.map(col => (
              <th key={col.key} onClick={() => col.sortable && handleSort(col.key)} aria-sort={sortKey === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined} className={`${col.width} select-none ${col.sortable ? 'cursor-pointer' : ''}`} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-semibold)', color: 'var(--text-tertiary)', letterSpacing: 'var(--tracking-wide)', transition: `color var(--duration-fast)` }} onMouseEnter={e => e.currentTarget.style.color = 'var(--text-app)'} onMouseLeave={e => e.currentTarget.style.color = 'var(--text-tertiary)'}>
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
              <td colSpan={colCount}>{emptyState}</td>
            </tr>
          ) : threadData ? (
            <>
              {/* Threads first — a root with descendants (family, chain, or
                  both), rendered as an indented subtree. */}
              {threadData.threads.map(thread => (
                <Fragment key={thread.root.id}>
                  {thread.rows.map(row => renderRow(row.task, row))}
                </Fragment>
              ))}

              {/* Then the flat majority. Collapsed by default would hide most
                  of the board, so this bucket starts open. */}
              {threadData.standalone.length > 0 && (
                <Fragment key="__standalone__">
                  <tr onClick={() => toggleGroup(BUCKET_STANDALONE)} className="cursor-pointer apple-press" style={{ borderBottom: '0.5px solid var(--separator)', background: 'var(--fill-secondary)' }}>
                    <td colSpan={colCount} style={{ padding: '10px 12px' }}>
                      <div className="flex items-center gap-2">
                        {collapsedGroups[BUCKET_STANDALONE] ? <ChevronRight className="w-3.5 h-3.5" style={{ color: 'var(--text-tertiary)' }} /> : <ChevronDown className="w-3.5 h-3.5" style={{ color: 'var(--text-tertiary)' }} />}
                        <span style={{ fontSize: 'var(--text-footnote)', fontWeight: 'var(--font-semibold)', color: 'var(--text-app)' }}>{BUCKET_STANDALONE}</span>
                        <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }}>{threadData.standalone.length} tasks</span>
                      </div>
                    </td>
                  </tr>
                  {!collapsedGroups[BUCKET_STANDALONE] && threadData.standalone.map(t => renderRow(t))}
                </Fragment>
              )}

              {/* Children whose parent isn't in the current view — usually
                  because a filter hid it. Surfaced rather than dropped, since
                  silently vanishing rows read as data loss. */}
              {threadData.orphans.length > 0 && (
                <Fragment key="__orphans__">
                  <tr onClick={() => toggleGroup(BUCKET_ORPHAN)} className="cursor-pointer apple-press" style={{ borderBottom: '0.5px solid var(--separator)', background: 'var(--fill-secondary)' }}>
                    <td colSpan={colCount} style={{ padding: '10px 12px' }}>
                      <div className="flex items-center gap-2">
                        {collapsedGroups[BUCKET_ORPHAN] ? <ChevronRight className="w-3.5 h-3.5" style={{ color: 'var(--text-tertiary)' }} /> : <ChevronDown className="w-3.5 h-3.5" style={{ color: 'var(--text-tertiary)' }} />}
                        <span style={{ fontSize: 'var(--text-footnote)', fontWeight: 'var(--font-semibold)', color: 'var(--text-app)' }}>{BUCKET_ORPHAN}</span>
                        <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }}>{threadData.orphans.length} tasks</span>
                        <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)', opacity: 0.7 }}>parent hidden by a filter, or missing</span>
                      </div>
                    </td>
                  </tr>
                  {!collapsedGroups[BUCKET_ORPHAN] && threadData.orphans.map(t => renderRow(t))}
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
