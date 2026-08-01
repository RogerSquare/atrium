import { useState, useRef, useEffect, useMemo, useCallback, memo } from 'react'
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd'
import { Rows3, LayoutGrid, Layers, ChevronDown, ChevronRight, ChevronLeft, CheckSquare, Plus } from 'lucide-react'
import TaskCard from './TaskCard'
import useIsMobile from '../hooks/useIsMobile'
import { Select, Button, Checkbox } from './ui'

const COLUMNS = [
  { id: 'draft', title: 'Draft' },
  { id: 'todo', title: 'To Do' },
  { id: 'in_progress', title: 'In Progress' },
  { id: 'review', title: 'Review' },
  { id: 'done', title: 'Done' }
]

const SWIMLANE_OPTIONS = [
  { key: 'none', label: 'No swimlanes' },
  { key: 'assignee', label: 'Assignee' },
  { key: 'type', label: 'Type' },
  { key: 'priority', label: 'Priority' },
  { key: 'component', label: 'Component' },
]

const STALE_THRESHOLDS = { in_progress: 3, review: 7 } // days

function isTaskStale(task) {
  const threshold = STALE_THRESHOLDS[task.status]
  if (!threshold) return false
  const log = task.activity_log || []
  const lastActivity = log.length > 0 ? log[log.length - 1].timestamp : task.created_at
  if (!lastActivity) return false
  const daysSince = (Date.now() - new Date(lastActivity).getTime()) / (1000 * 60 * 60 * 24)
  return daysSince >= threshold
}

function Board({ tasks, onUpdateTask, onSelectTask, activeAgents = [], onStartAgent, onStopAgent, taskViewers = {}, shellSessions = {}, currentUser, selectable, selectedIds = [], onToggleSelect, onShiftSelect, onToggleSelectColumn, recentlyUpdatedIds = [], onToggleBulkSelect, githubLinks = {}, onCreateTask }) {
  const priorityOrder = { high: 0, medium: 1, low: 2 }
  const isMobile = useIsMobile()
  const [compactMode, setCompactMode] = useState(() => localStorage.getItem('taskBoardCompact') === 'true')
  const [swimlaneBy, setSwimlaneBy] = useState(() => localStorage.getItem('taskBoardSwimlane') || 'none')
  const [draftCollapsed, setDraftCollapsed] = useState(() => localStorage.getItem('taskBoardDraftCollapsed') === 'true')
  const [collapsedLanes, setCollapsedLanes] = useState({})
  const [activeColumn, setActiveColumn] = useState('todo')
  const scrollRef = useRef(null)
  const touchStartX = useRef(null)

  const sortTasks = useCallback((taskList) => {
    return [...taskList].sort((a, b) => {
      const pA = priorityOrder[a.priority] !== undefined ? priorityOrder[a.priority] : 1
      const pB = priorityOrder[b.priority] !== undefined ? priorityOrder[b.priority] : 1
      return pA - pB
    })
  }, [])

  const staleIds = useMemo(() => {
    const ids = new Set()
    for (const task of tasks) {
      if (isTaskStale(task)) ids.add(task.id)
    }
    return ids
  }, [tasks])

  const standardStatusIds = COLUMNS.map(c => c.id)
  const uncategorizedTasks = useMemo(() => tasks.filter(t => !standardStatusIds.includes(t.status)), [tasks])

  const displayColumns = useMemo(() => {
    const cols = [...COLUMNS]
    if (uncategorizedTasks.length > 0) {
      cols.unshift({ id: 'uncategorized', title: 'Uncategorized', isSafety: true })
    }
    return cols
  }, [uncategorizedTasks.length])

  const columnTasks = useMemo(() => {
    const map = {}
    for (const col of displayColumns) {
      const colList = col.isSafety ? uncategorizedTasks : tasks.filter(t => t.status === col.id)
      map[col.id] = sortTasks(colList)
    }
    return map
  }, [tasks, displayColumns, uncategorizedTasks, sortTasks])

  const onDragEnd = useCallback((result) => {
    const { destination, source, draggableId } = result
    if (!destination) return
    if (destination.droppableId === source.droppableId) return
    if (destination.droppableId === 'uncategorized') return
    onUpdateTask(draggableId, { status: destination.droppableId })
  }, [onUpdateTask])

  const handleTouchStart = (e) => { touchStartX.current = e.touches[0].clientX }
  const handleTouchEnd = (e) => {
    if (touchStartX.current === null) return
    const diff = touchStartX.current - e.changedTouches[0].clientX
    touchStartX.current = null
    if (Math.abs(diff) < 60) return
    const currentIdx = displayColumns.findIndex(c => c.id === activeColumn)
    if (diff > 0 && currentIdx < displayColumns.length - 1) setActiveColumn(displayColumns[currentIdx + 1].id)
    else if (diff < 0 && currentIdx > 0) setActiveColumn(displayColumns[currentIdx - 1].id)
  }

  const toggleCompact = useCallback(() => {
    setCompactMode(prev => { localStorage.setItem('taskBoardCompact', String(!prev)); return !prev })
  }, [])

  const toggleDraftCollapsed = useCallback(() => {
    setDraftCollapsed(prev => { localStorage.setItem('taskBoardDraftCollapsed', String(!prev)); return !prev })
  }, [])

  const handleSwimlaneChange = useCallback((value) => {
    setSwimlaneBy(value)
    localStorage.setItem('taskBoardSwimlane', value)
    setCollapsedLanes({})
  }, [])

  const toggleLane = useCallback((lane) => {
    setCollapsedLanes(prev => ({ ...prev, [lane]: !prev[lane] }))
  }, [])

  const swimlanes = useMemo(() => {
    if (swimlaneBy === 'none') return null
    const lanes = new Map()
    for (const task of tasks) {
      if (!standardStatusIds.includes(task.status)) continue
      const key = task[swimlaneBy] || 'Unassigned'
      if (!lanes.has(key)) lanes.set(key, [])
      lanes.get(key).push(task)
    }
    return lanes
  }, [tasks, swimlaneBy, standardStatusIds])

  const onDragEndSwimlane = useCallback((result) => {
    const { destination, source, draggableId } = result
    if (!destination) return
    const destStatus = destination.droppableId.split('__')[0]
    const srcStatus = source.droppableId.split('__')[0]
    if (destStatus === srcStatus) return
    if (destStatus === 'uncategorized') return
    onUpdateTask(draggableId, { status: destStatus })
  }, [onUpdateTask])

  // Flat ordered list of task IDs for shift-click range selection
  const orderedTaskIds = useMemo(() => {
    const ids = []
    for (const col of displayColumns) {
      const colTasks = columnTasks[col.id] || []
      for (const t of colTasks) ids.push(t.id)
    }
    return ids
  }, [displayColumns, columnTasks])

  const renderCard = (task, isDragging) => (
    <TaskCard
      task={task}
      onUpdateTask={onUpdateTask}
      onClick={() => onSelectTask(task)}
      isDragging={isDragging}
      agentRunning={activeAgents.some(a => a.taskId === task.id)}
      viewers={(taskViewers[task.id] || []).filter(u => u !== currentUser)}
      shellSession={shellSessions[task.id]}
      selectable={selectable}
      selected={selectedIds.includes(task.id)}
      onToggleSelect={onToggleSelect}
      onShiftSelect={onShiftSelect}
      orderedTaskIds={orderedTaskIds}
      justUpdated={recentlyUpdatedIds.includes(task.id)}
      compact={compactMode}
      isStale={staleIds.has(task.id)}
      githubLinks={githubLinks}
    />
  )

  const renderDroppable = (col, colTasks, droppableId) => (
    <Droppable droppableId={droppableId} isDropDisabled={col.isSafety}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.droppableProps}
          className="flex-1 flex flex-col gap-2 min-h-[60px]"
          style={{
            padding: 'var(--space-2)',
            borderRadius: 'var(--radius-md)',
            background: snapshot.isDraggingOver ? 'color-mix(in srgb, var(--accent-app) 6%, transparent)' : 'transparent',
            transition: `background var(--duration-fast) var(--ease-default)`,
          }}
        >
          {colTasks.map((task, index) => (
            <Draggable key={task.id} draggableId={task.id} index={index}>
              {(provided, snapshot) => (
                <div
                  ref={provided.innerRef}
                  {...provided.draggableProps}
                  {...provided.dragHandleProps}
                  style={provided.draggableProps.style}
                >
                  {renderCard(task, snapshot.isDragging)}
                </div>
              )}
            </Draggable>
          ))}
          {provided.placeholder}
        </div>
      )}
    </Droppable>
  )

  // Empty board (ui-topbar-create-001, usability P0-2): a first session used
  // to land on five bare "No tasks" columns with no explanation and no way
  // forward. Modeled on the LoopsView empty state. Covers both the truly-empty
  // workspace and an empty filter/project scope — the FilterBar above already
  // shows counts + Reset for the latter.
  if (tasks.length === 0) {
    return (
      <div
        data-testid="board-empty-state"
        style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--text-muted)' }}
      >
        <LayoutGrid className="w-8 h-8" style={{ margin: '0 auto var(--space-3)', color: 'var(--text-tertiary)' }} />
        <div style={{ fontSize: 'var(--text-subhead)', color: 'var(--text-app)', marginBottom: '4px' }}>
          No tasks here yet
        </div>
        <div style={{ fontSize: 'var(--text-caption1)', maxWidth: '420px', margin: '0 auto' }}>
          Tasks move across the board as work happens: draft → todo → in progress → review → done.
          Agents pick up <em>todo</em> tasks and stop at <em>review</em> for your approval.
        </div>
        {onCreateTask && (
          <Button
            variant="primary"
            onClick={onCreateTask}
            data-testid="board-empty-create"
            style={{ margin: 'var(--space-4) auto 0' }}
          >
            <Plus className="w-4 h-4" /> Create your first task
          </Button>
        )}
      </div>
    )
  }

  // Mobile: tabbed single-column view
  if (isMobile) {
    const activeCol = displayColumns.find(c => c.id === activeColumn) || displayColumns[0]
    const colTasks = columnTasks[activeCol.id] || []

    return (
      <div>
        {/* Segmented control for columns — grid wrapper around Button primitives */}
        <div
          role="tablist"
          className="mb-3"
          style={{
            padding: 'var(--space-1)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--bg-secondary)',
            display: 'grid',
            gap: 'var(--space-1)',
            gridTemplateColumns: `repeat(${displayColumns.length}, 1fr)`,
          }}
        >
          {displayColumns.map(col => {
            const count = col.isSafety ? uncategorizedTasks.length : tasks.filter(t => t.status === col.id).length
            const isActive = col.id === activeColumn
            return (
              <Button
                key={col.id}
                variant={col.isSafety ? 'danger' : isActive ? 'secondary' : 'ghost'}
                size="sm"
                pill={false}
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveColumn(col.id)}
                className="justify-center"
                style={{
                  minHeight: '44px',
                  background: isActive ? 'var(--bg-card)' : 'transparent',
                  border: isActive ? 'var(--border-hairline)' : '1px solid transparent',
                  color: col.isSafety ? 'var(--apple-red)' : isActive ? 'var(--text-app)' : 'var(--text-muted)',
                }}
              >
                {col.title}
                <span
                  style={{
                    minWidth: '18px',
                    height: '18px',
                    fontSize: 'var(--text-caption2)',
                    fontWeight: 'var(--font-semibold)',
                    borderRadius: 'var(--radius-full)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: isActive ? 'var(--accent-app)' : 'var(--fill-primary)',
                    color: isActive ? 'white' : 'var(--text-muted)',
                  }}
                >
                  {count}
                </span>
              </Button>
            )
          })}
        </div>

        <div
          ref={scrollRef}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          className="flex flex-col gap-2 min-h-[200px]"
          style={{
            padding: 'var(--space-3)',
            borderRadius: 'var(--radius-md)',
            background: activeCol.isSafety ? 'color-mix(in srgb, var(--apple-red) 6%, transparent)' : 'var(--bg-secondary)',
            border: 'var(--border-hairline)',
            transition: `background var(--duration-normal) var(--ease-default)`,
          }}
        >
          {colTasks.length === 0 && (
            <p className="text-center py-8" style={{ fontSize: 'var(--text-footnote)', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>No tasks</p>
          )}
          {colTasks.map(task => (
            <div key={task.id}>{renderCard(task, false)}</div>
          ))}
        </div>
      </div>
    )
  }

  // Desktop
  return (
    <DragDropContext onDragEnd={swimlanes ? onDragEndSwimlane : onDragEnd}>
      {/* Board toolbar */}
      <div className="flex items-center gap-2 mb-3 px-1">
        {/* Left group: swimlanes + compact */}
        <div className="flex items-center gap-2">
          <Layers className="w-3.5 h-3.5" style={{ color: 'var(--text-tertiary)' }} />
          <Select
            pill
            active={swimlaneBy !== 'none'}
            value={swimlaneBy}
            onChange={(e) => handleSwimlaneChange(e.target.value)}
            className="facelift-pill"
            style={{ padding: '0 var(--space-2)' }}
          >
            {SWIMLANE_OPTIONS.map(opt => <option key={opt.key} value={opt.key}>{opt.label}</option>)}
          </Select>
          <Button
            variant={compactMode ? 'secondary' : 'ghost'}
            size="sm"
            className="facelift-pill"
            onClick={toggleCompact}
            title={compactMode ? 'Switch to full cards' : 'Switch to compact cards'}
          >
            {compactMode ? <LayoutGrid className="w-3.5 h-3.5" /> : <Rows3 className="w-3.5 h-3.5" />}
            {compactMode ? 'Full' : 'Compact'}
          </Button>
        </div>

        {/* Spacer */}
        <div className="flex-1" />
        {onToggleBulkSelect && (
          <Button
            variant={selectable ? 'secondary' : 'ghost'}
            size="sm"
            className="facelift-pill"
            onClick={onToggleBulkSelect}
            title="Multi-select (Ctrl+Shift+A)"
            aria-label={selectable ? 'Exit multi-select mode' : 'Enter multi-select mode'}
            aria-pressed={selectable}
          >
            <CheckSquare className="w-3.5 h-3.5" />
            Select
          </Button>
        )}
      </div>

      {swimlanes ? (
        <div className="space-y-3">
          {/* Sticky column headers */}
          <div className="flex overflow-x-auto px-1" style={{ gap: 'var(--space-1)' }}>
            {displayColumns.filter(c => !c.isSafety).map(col => {
              const allColTasks = tasks.filter(t => t.status === col.id)
              const allSelected = selectable && allColTasks.length > 0 && allColTasks.every(t => selectedIds.includes(t.id))
              return (
                <div
                  key={col.id}
                  className={`flex-1 text-center flex items-center justify-center gap-2${selectable ? ' cursor-pointer' : ''}`}
                  style={{
                    minWidth: '240px', padding: 'var(--space-2) 0', borderRadius: 'var(--radius-sm)',
                    background: allSelected ? 'color-mix(in srgb, var(--accent-app) 12%, var(--fill-secondary))' : 'var(--fill-secondary)',
                    transition: `all var(--duration-fast) var(--ease-default)`,
                  }}
                  onClick={selectable && onToggleSelectColumn ? () => onToggleSelectColumn(allColTasks.map(t => t.id)) : undefined}
                  onKeyDown={selectable && onToggleSelectColumn ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleSelectColumn(allColTasks.map(t => t.id)) } } : undefined}
                  role={selectable ? 'button' : undefined}
                  tabIndex={selectable ? 0 : undefined}
                  aria-label={selectable ? `Select all ${col.title} tasks${allSelected ? ' (all selected)' : ''}` : undefined}
                  title={selectable ? `Click to select all ${col.title} tasks` : undefined}
                >
                  {selectable && (
                    <Checkbox
                      checked={Boolean(allSelected)}
                      indeterminate={!allSelected && allColTasks.some(t => selectedIds.includes(t.id))}
                      onChange={() => onToggleSelectColumn?.(allColTasks.map(t => t.id))}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Select all ${col.title}`}
                    />
                  )}
                  <span style={{ fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-semibold)', color: 'var(--text-muted)' }}>{col.title}</span>
                </div>
              )
            })}
          </div>

          {Array.from(swimlanes.entries()).map(([laneName, laneTasks]) => {
            const isCollapsed = collapsedLanes[laneName]
            return (
              <div key={laneName} className="overflow-hidden" style={{ borderRadius: 'var(--radius-md)', background: 'var(--bg-secondary)', border: 'var(--border-hairline)' }}>
                <button
                  onClick={() => toggleLane(laneName)}
                  className="w-full flex items-center gap-2 text-left apple-press"
                  style={{ padding: 'var(--space-3) var(--space-4)', borderBottom: isCollapsed ? 'none' : '0.5px solid var(--separator)' }}
                >
                  {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" style={{ color: 'var(--text-tertiary)' }} /> : <ChevronDown className="w-3.5 h-3.5" style={{ color: 'var(--text-tertiary)' }} />}
                  <span style={{ fontSize: 'var(--text-footnote)', fontWeight: 'var(--font-semibold)', color: 'var(--text-app)' }}>{laneName}</span>
                  <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }}>{laneTasks.length} tasks</span>
                </button>

                {!isCollapsed && (
                  <div className="flex overflow-x-auto" style={{ padding: 'var(--space-3)' }}>
                    {displayColumns.filter(c => !c.isSafety).map((col, colIdx, arr) => {
                      const colTasks = sortTasks(laneTasks.filter(t => t.status === col.id))
                      return (
                        <div
                          key={col.id}
                          className="flex-1 flex flex-col"
                          style={{
                            minWidth: '240px',
                            padding: '0 var(--space-2)',
                            borderRight: colIdx < arr.length - 1 ? '0.5px solid var(--separator)' : 'none',
                          }}
                        >
                          {/* Column label + count inside each lane */}
                          <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-2)', padding: '0 var(--space-2)' }}>
                            <span style={{ fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-semibold)', color: 'var(--text-muted)' }}>{col.title}</span>
                            <span style={{ fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-semibold)', color: 'var(--text-tertiary)', background: 'var(--fill-secondary)', padding: '0 var(--space-2)', borderRadius: 'var(--radius-full)', minWidth: '20px', textAlign: 'center' }}>{colTasks.length}</span>
                          </div>
                          {renderDroppable(col, colTasks, `${col.id}__${laneName}`)}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {displayColumns.map(col => {
            const colTasks = columnTasks[col.id] || []
            // Collapsed Draft column → thin clickable rail that reclaims horizontal space
            if (col.id === 'draft' && draftCollapsed) {
              return (
                <button
                  key={col.id}
                  type="button"
                  onClick={toggleDraftCollapsed}
                  className="apple-press flex flex-col items-center self-stretch"
                  title={`Expand Draft column (${colTasks.length})`}
                  aria-label={`Expand Draft column, ${colTasks.length} tasks`}
                  aria-expanded={false}
                  style={{
                    flex: '0 0 auto',
                    width: '40px',
                    minHeight: '160px',
                    gap: 'var(--space-3)',
                    borderRadius: 'var(--radius-md)',
                    padding: 'var(--space-3) 0',
                    background: 'var(--bg-secondary)',
                    border: 'var(--border-hairline)',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    // Anchor the apple-press scale(0.97) to the top so the
                    // top-aligned chevron doesn't slide downward on click — on a
                    // full-height rail a center-origin scale pushes the click
                    // target out from under the cursor (worse the higher you click).
                    transformOrigin: 'top center',
                    transition: `background var(--duration-normal) var(--ease-default)`,
                  }}
                >
                  <ChevronRight className="w-3.5 h-3.5" style={{ color: 'var(--text-tertiary)' }} />
                  <span style={{ fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-semibold)', color: 'var(--text-tertiary)', background: 'var(--fill-secondary)', padding: 'var(--space-1)', borderRadius: 'var(--radius-full)', minWidth: '24px', textAlign: 'center' }}>
                    {colTasks.length}
                  </span>
                  <span style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-semibold)', letterSpacing: 'var(--tracking-wide)', color: 'var(--text-muted)' }}>
                    Draft
                  </span>
                </button>
              )
            }
            return (
              <div
                key={col.id}
                className="flex-1 min-w-[280px] flex flex-col"
                style={{
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-4)',
                  background: col.isSafety ? 'color-mix(in srgb, var(--apple-red) 6%, transparent)' : 'var(--bg-secondary)',
                  border: 'var(--border-hairline)',
                  transition: `background var(--duration-normal) var(--ease-default)`,
                }}
              >
                <div
                  className={`flex justify-between items-center mb-3 px-2${selectable && !col.isSafety ? ' cursor-pointer' : ''}`}
                  onClick={selectable && !col.isSafety && onToggleSelectColumn ? () => onToggleSelectColumn(colTasks.map(t => t.id)) : undefined}
                  onKeyDown={selectable && !col.isSafety && onToggleSelectColumn ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleSelectColumn(colTasks.map(t => t.id)) } } : undefined}
                  role={selectable && !col.isSafety ? 'button' : undefined}
                  tabIndex={selectable && !col.isSafety ? 0 : undefined}
                  aria-label={selectable && !col.isSafety ? `Select all ${col.title} tasks${colTasks.length > 0 && colTasks.every(t => selectedIds.includes(t.id)) ? ' (all selected)' : ''}` : undefined}
                  title={selectable && !col.isSafety ? `Click to select all ${col.title} tasks` : undefined}
                  style={selectable && !col.isSafety ? { borderRadius: 'var(--radius-sm)', padding: 'var(--space-1) var(--space-2)', margin: '0 0 var(--space-2) 0', transition: `all var(--duration-fast) var(--ease-default)`, background: colTasks.length > 0 && colTasks.every(t => selectedIds.includes(t.id)) ? 'color-mix(in srgb, var(--accent-app) 12%, transparent)' : undefined } : undefined}
                >
                  <div className="flex items-center gap-2">
                    {col.id === 'draft' && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); toggleDraftCollapsed() }}
                        className="apple-press"
                        title="Collapse Draft column"
                        aria-label="Collapse Draft column"
                        aria-expanded={true}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '20px', height: '20px', borderRadius: 'var(--radius-sm)', color: 'var(--text-tertiary)', background: 'transparent', border: 'none', cursor: 'pointer' }}
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {selectable && !col.isSafety && (
                      <Checkbox
                        checked={colTasks.length > 0 && colTasks.every(t => selectedIds.includes(t.id))}
                        indeterminate={colTasks.some(t => selectedIds.includes(t.id)) && !colTasks.every(t => selectedIds.includes(t.id))}
                        onChange={() => onToggleSelectColumn?.(colTasks.map(t => t.id))}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Select all ${col.title}`}
                      />
                    )}
                    <span style={{ fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-semibold)', color: col.isSafety ? 'var(--apple-red)' : 'var(--text-muted)', letterSpacing: 'var(--tracking-wide)' }}>{col.title}</span>
                  </div>
                  <span style={{ fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-semibold)', color: 'var(--text-tertiary)', background: 'var(--fill-secondary)', padding: 'var(--space-1) var(--space-2)', borderRadius: 'var(--radius-full)', minWidth: '24px', textAlign: 'center' }}>
                    {colTasks.length}
                  </span>
                </div>
                {renderDroppable(col, colTasks, col.id)}
              </div>
            )
          })}
        </div>
      )}
    </DragDropContext>
  )
}

export default memo(Board)
