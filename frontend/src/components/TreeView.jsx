import { memo, useState, useCallback, useMemo } from 'react'
import { ChevronRight, ChevronDown, ChevronsDownUp, ChevronsUpDown, Circle, Loader2, Eye, CheckCircle2, UserCircle2 } from 'lucide-react'
import { PRIORITY_COLOR, TYPE_STYLE, VIEWER_COLORS } from '../constants'

const STATUS_ICON_STYLE = {
  todo: { icon: Circle, color: 'var(--gray-1)' },
  in_progress: { icon: Loader2, color: 'var(--apple-blue)', spin: true },
  review: { icon: Eye, color: 'var(--apple-orange)' },
  done: { icon: CheckCircle2, color: 'var(--apple-green)' },
}

function buildTree(tasks) {
  const taskMap = new Map()
  tasks.forEach(t => taskMap.set(t.id, t))
  const roots = [], children = new Map(), orphans = []
  for (const task of tasks) {
    if (!task.parent_task) roots.push(task)
    else if (taskMap.has(task.parent_task)) {
      if (!children.has(task.parent_task)) children.set(task.parent_task, [])
      children.get(task.parent_task).push(task)
    } else orphans.push(task)
  }
  const priorityOrder = { high: 0, medium: 1, low: 2 }
  const sortFn = (a, b) => {
    const aK = children.has(a.id) ? 0 : 1, bK = children.has(b.id) ? 0 : 1
    if (aK !== bK) return aK - bK
    return (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3)
  }
  roots.sort(sortFn)
  for (const [, kids] of children) kids.sort(sortFn)
  orphans.sort(sortFn)
  return { roots, children, orphans }
}

function TreeNode({ task, children: childTasks, childrenMap, depth, onSelectTask, activeAgents, taskViewers, expanded, onToggle, recentlyUpdatedIds }) {
  const isAgentRunning = activeAgents.some(a => a.taskId === task.id)
  const viewers = taskViewers[task.id] || []
  const hasChildren = childTasks && childTasks.length > 0
  const justUpdated = recentlyUpdatedIds.includes(task.id)
  const doneCount = hasChildren ? childTasks.filter(t => t.status === 'done').length : 0
  const totalCount = hasChildren ? childTasks.length : 0
  const statusDef = STATUS_ICON_STYLE[task.status] || STATUS_ICON_STYLE.todo
  const StatusIcon = statusDef.icon
  const pc = PRIORITY_COLOR[task.priority] || PRIORITY_COLOR.medium
  const ts = TYPE_STYLE[task.type || 'fullstack'] || TYPE_STYLE.fullstack

  return (
    <>
      <div
        onClick={() => onSelectTask(task)}
        className="flex items-center gap-2.5 cursor-pointer"
        style={{
          paddingLeft: `${depth * 24 + 14}px`,
          paddingRight: 'var(--space-4)',
          paddingTop: '10px',
          paddingBottom: '10px',
          minHeight: '44px',
          borderBottom: '0.5px solid var(--separator)',
          background: justUpdated ? 'color-mix(in srgb, var(--accent-app) 6%, transparent)' : 'transparent',
          transition: `background var(--duration-fast) var(--ease-default)`,
        }}
        onMouseEnter={e => { if (!justUpdated) e.currentTarget.style.background = 'color-mix(in srgb, var(--accent-app) 4%, transparent)' }}
        onMouseLeave={e => { if (!justUpdated) e.currentTarget.style.background = 'transparent' }}
      >
        {hasChildren ? (
          <button onClick={(e) => { e.stopPropagation(); onToggle(task.id) }} className="apple-press shrink-0" style={{ padding: '2px', borderRadius: 'var(--radius-xs)', color: 'var(--text-tertiary)', transition: `transform var(--duration-fast) var(--ease-default)` }}>
            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        ) : (
          <span style={{ width: '18px' }} className="shrink-0" />
        )}

        <StatusIcon className={`w-3.5 h-3.5 shrink-0 ${statusDef.spin ? 'animate-spin' : ''}`} style={{ color: statusDef.color }} />

        <span className="shrink-0" style={{ width: '7px', height: '7px', borderRadius: '50%', background: pc }} />

        <span className="shrink-0" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-medium)', color: 'var(--text-tertiary)' }}>{task.id}</span>

        <span className="truncate" style={{ fontSize: 'var(--text-subhead)', fontWeight: 'var(--font-medium)', color: 'var(--text-app)' }}>{task.title}</span>

        {hasChildren && (
          <div className="flex items-center gap-1.5 shrink-0">
            <div style={{ width: '60px', height: '4px', borderRadius: 'var(--radius-full)', background: 'var(--fill-primary)', overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: 'var(--radius-full)', background: doneCount === totalCount ? 'var(--apple-green)' : 'var(--apple-blue)', width: `${totalCount > 0 ? (doneCount / totalCount) * 100 : 0}%`, transition: `width var(--duration-slow) var(--ease-out)` }} />
            </div>
            <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)', fontWeight: 'var(--font-medium)' }}>{doneCount}/{totalCount}</span>
          </div>
        )}

        {isAgentRunning && <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" style={{ color: 'var(--accent-app)' }} />}

        <div className="flex-1" />

        {task.type && (
          <span className="shrink-0" style={{ fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-semibold)', textTransform: 'uppercase', color: ts.color, background: ts.bg, padding: '2px 8px', borderRadius: 'var(--radius-sm)' }}>{task.type}</span>
        )}

        {task.assignee && (
          <div className="flex items-center gap-1 shrink-0" style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-muted)' }}>
            <div className="w-4 h-4 rounded-full flex items-center justify-center text-white" style={{ fontSize: '8px', fontWeight: 'var(--font-semibold)', background: 'var(--gray-2)' }}>{task.assignee.charAt(0).toUpperCase()}</div>
            {task.assignee}
          </div>
        )}

        {viewers.length > 0 && (
          <div className="flex -space-x-1 shrink-0">
            {viewers.slice(0, 2).map((v, i) => (
              <div key={v} className="w-4 h-4 rounded-full flex items-center justify-center text-white" style={{ fontSize: '7px', fontWeight: 'var(--font-semibold)', backgroundColor: VIEWER_COLORS[i % 3], border: '2px solid var(--bg-card)' }} title={v}>{v[0]?.toUpperCase()}</div>
            ))}
          </div>
        )}
      </div>

      {hasChildren && expanded && childTasks.map(child => (
        <TreeNode
          key={child.id}
          task={child}
          children={childrenMap.get(child.id) || []}
          childrenMap={childrenMap}
          depth={depth + 1}
          onSelectTask={onSelectTask}
          activeAgents={activeAgents}
          taskViewers={taskViewers}
          expanded={true}
          onToggle={onToggle}
          recentlyUpdatedIds={recentlyUpdatedIds}
        />
      ))}
    </>
  )
}

function TreeView({ tasks, onSelectTask, onUpdateTask, activeAgents = [], taskViewers = {}, currentUser, selectable, selectedIds, onToggleSelect, recentlyUpdatedIds = [] }) {
  const [expandedNodes, setExpandedNodes] = useState(() => {
    const expanded = {}
    tasks.forEach(t => { if (tasks.some(c => c.parent_task === t.id)) expanded[t.id] = true })
    return expanded
  })

  const tree = useMemo(() => buildTree(tasks), [tasks])
  const toggleNode = useCallback((id) => { setExpandedNodes(prev => ({ ...prev, [id]: !prev[id] })) }, [])
  const expandAll = useCallback(() => {
    const expanded = {}
    tree.roots.forEach(t => { expanded[t.id] = true })
    for (const [parentId] of tree.children) expanded[parentId] = true
    setExpandedNodes(expanded)
  }, [tree])
  const collapseAll = useCallback(() => { setExpandedNodes({}) }, [])

  const parentCount = tree.roots.filter(r => tree.children.has(r.id)).length
  const standaloneCount = tree.roots.filter(r => !tree.children.has(r.id)).length

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-1">
        <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)', fontWeight: 'var(--font-medium)' }}>
          {parentCount} parent{parentCount !== 1 ? 's' : ''}, {standaloneCount} standalone
          {tree.orphans.length > 0 && `, ${tree.orphans.length} orphaned`}
        </span>
        <div className="flex-1" />
        <button onClick={expandAll} className="apple-press flex items-center gap-1" style={{ padding: '4px 10px', borderRadius: 'var(--radius-full)', fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-medium)', color: 'var(--text-muted)' }}>
          <ChevronsUpDown className="w-3 h-3" /> Expand all
        </button>
        <button onClick={collapseAll} className="apple-press flex items-center gap-1" style={{ padding: '4px 10px', borderRadius: 'var(--radius-full)', fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-medium)', color: 'var(--text-muted)' }}>
          <ChevronsDownUp className="w-3 h-3" /> Collapse all
        </button>
      </div>

      {/* Tree */}
      <div className="overflow-hidden" style={{ borderRadius: 'var(--radius-lg)', background: 'var(--bg-secondary)', boxShadow: 'var(--shadow-sm)' }}>
        {tree.roots.length === 0 && tree.orphans.length === 0 ? (
          <div className="text-center" style={{ padding: '48px', fontSize: 'var(--text-subhead)', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
            No tasks match the current filters
          </div>
        ) : (
          <>
            {tree.roots.map(task => (
              <TreeNode
                key={task.id}
                task={task}
                children={tree.children.get(task.id) || []}
                childrenMap={tree.children}
                depth={0}
                onSelectTask={onSelectTask}
                activeAgents={activeAgents}
                taskViewers={taskViewers}
                expanded={expandedNodes[task.id] ?? false}
                onToggle={toggleNode}
                recentlyUpdatedIds={recentlyUpdatedIds}
              />
            ))}

            {tree.orphans.length > 0 && (
              <>
                <div style={{ padding: '10px 14px', background: 'var(--fill-secondary)', borderTop: '0.5px solid var(--separator)', borderBottom: '0.5px solid var(--separator)' }}>
                  <span style={{ fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-semibold)', color: 'var(--apple-orange)' }}>
                    Orphaned ({tree.orphans.length})
                  </span>
                  <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)', marginLeft: '8px' }}>parent references missing ID</span>
                </div>
                {tree.orphans.map(task => (
                  <TreeNode
                    key={task.id}
                    task={task}
                    children={tree.children.get(task.id) || []}
                    childrenMap={tree.children}
                    depth={0}
                    onSelectTask={onSelectTask}
                    activeAgents={activeAgents}
                    taskViewers={taskViewers}
                    expanded={expandedNodes[task.id] ?? false}
                    onToggle={toggleNode}
                    recentlyUpdatedIds={recentlyUpdatedIds}
                  />
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default memo(TreeView)
