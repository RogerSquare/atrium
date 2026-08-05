import { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { API_URL, apiFetch } from '../config'
import useTasks from '../hooks/useTasks'
import useAgents from '../hooks/useAgents'
import useShellSessions from '../hooks/useShellSessions'
import useUndoRedo from '../hooks/useUndoRedo'

// Two-context split (Phase 2 of opt-perf-audit-001-implement, Path C from
// the plan). Goal: keep the public `useTaskContext()` API working for every
// existing consumer while letting new code subscribe to a narrower slice.
//
//   useTaskData()    — high-churn slice. Re-fires on keystrokes / fetch
//                      ticks / filter toggles / drag updates / etc.
//                      Holds: tasks, filtered/derived tasks, projects,
//                      selectedTask, activeProject, all filter* state,
//                      searchQuery, recentlyUpdatedIds, githubLinks,
//                      loading, agent state, bulk-select state, errorToast.
//   useTaskActions() — stable slice. Refs change rarely (handler identity
//                      churn only when their useCallback deps change).
//                      Holds: every mutation handler, fetchData, undoRedo,
//                      bulk-select handlers, showError/setErrorToast.
//   useTaskContext() — compat shim. DEPRECATED but kept working: subscribes
//                      to BOTH contexts and returns their merge so legacy
//                      consumers see no change. Phase 3 will migrate
//                      hot-path consumers off it for the actual perf win.
const TaskHighChurnContext = createContext(null)
const TaskStableContext = createContext(null)

export function TaskProvider({ user, socketRef, children }) {
  const taskState = useTasks(user, socketRef)
  const agents = useAgents(user, socketRef, taskState.fetchData)
  const shell = useShellSessions(user, socketRef)
  const undoRedo = useUndoRedo(taskState.tasks, taskState.handleUpdateTask)

  // Slice 5: when filterShellActive is on, narrow taskState.filteredTasks
  // to tasks that have an alive web-shell PTY in the registry. The base
  // filteredTasks is computed inside useTasks (which doesn't see
  // shellSessions); the intersection happens here so both inputs are in
  // scope. Pass-through identity when the filter is off, so consumers
  // don't see a fresh array reference on every snapshot tick.
  const filteredTasksWithShell = useMemo(() => {
    if (!taskState.filterShellActive) return taskState.filteredTasks
    return taskState.filteredTasks.filter(t => shell.shellSessions[t.id])
  }, [taskState.filteredTasks, taskState.filterShellActive, shell.shellSessions])

  // --- Bulk selection ---
  const [bulkSelectMode, setBulkSelectMode] = useState(false)
  const [selectedTaskIds, setSelectedTaskIds] = useState([])
  const [batchLoading, setBatchLoading] = useState(false)
  const [errorToast, setErrorToast] = useState(null)
  const lastSelectedRef = useRef(null)

  const showError = useCallback((msg) => setErrorToast(msg), [])

  const toggleSelectTask = useCallback((id) => {
    lastSelectedRef.current = id
    setSelectedTaskIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id])
  }, [])

  const shiftSelectTask = useCallback((id, orderedIds) => {
    const anchor = lastSelectedRef.current
    if (!anchor || !orderedIds.includes(anchor) || !orderedIds.includes(id)) {
      lastSelectedRef.current = id
      setSelectedTaskIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id])
      return
    }
    const startIdx = orderedIds.indexOf(anchor)
    const endIdx = orderedIds.indexOf(id)
    const rangeIds = orderedIds.slice(Math.min(startIdx, endIdx), Math.max(startIdx, endIdx) + 1)
    setSelectedTaskIds(prev => {
      const merged = new Set(prev)
      rangeIds.forEach(rid => merged.add(rid))
      return Array.from(merged)
    })
  }, [])

  const toggleSelectColumn = useCallback((columnTaskIds) => {
    setSelectedTaskIds(prev => {
      const allSelected = columnTaskIds.length > 0 && columnTaskIds.every(id => prev.includes(id))
      if (allSelected) {
        const colSet = new Set(columnTaskIds)
        return prev.filter(id => !colSet.has(id))
      } else {
        const merged = new Set(prev)
        columnTaskIds.forEach(id => merged.add(id))
        return Array.from(merged)
      }
    })
  }, [])

  const selectAllVisible = useCallback(() => {
    setSelectedTaskIds(taskState.filteredTasks.map(t => t.id))
  }, [taskState.filteredTasks])

  const deselectAll = useCallback(() => setSelectedTaskIds([]), [])

  const exitBulkMode = useCallback(() => {
    setBulkSelectMode(false)
    setSelectedTaskIds([])
  }, [])

  const handleBatchUpdate = useCallback(async (updates) => {
    if (selectedTaskIds.length === 0 || batchLoading) return
    setBatchLoading(true)
    const undoEntries = selectedTaskIds.map(id => {
      const task = taskState.tasks.find(t => t.id === id)
      if (!task) return null
      const prev = {}
      for (const key of Object.keys(updates)) prev[key] = task[key]
      return { id, prev, next: updates }
    }).filter(Boolean)

    try {
      const res = await apiFetch(`${API_URL}/tasks/batch`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedTaskIds, updates, updated_by: user?.username })
      })
      if (res.ok) {
        const field = Object.keys(updates)[0]
        const label = field === 'status' ? `Moved ${undoEntries.length} tasks to ${updates.status.replace('_', ' ')}`
          : field === 'priority' ? `Changed ${undoEntries.length} tasks to ${updates.priority} priority`
          : field === 'assignee' ? `Assigned ${undoEntries.length} tasks to ${updates.assignee || 'nobody'}`
          : `Updated ${undoEntries.length} tasks`
        undoRedo.pushBatchUndo(undoEntries, label)
        exitBulkMode()
      } else {
        showError(`Batch update failed (${res.status})`)
      }
    } catch (error) {
      showError('Batch update failed — network error')
    } finally {
      setBatchLoading(false)
    }
  }, [selectedTaskIds, user?.username, exitBulkMode, showError, batchLoading, taskState.tasks, undoRedo])

  const handleBatchDelete = useCallback(async () => {
    if (selectedTaskIds.length === 0 || batchLoading) return
    setBatchLoading(true)
    try {
      const res = await apiFetch(`${API_URL}/tasks/batch`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedTaskIds })
      })
      if (res.ok) {
        exitBulkMode()
      } else {
        showError(`Batch delete failed (${res.status})`)
      }
    } catch (error) {
      showError('Batch delete failed — network error')
    } finally {
      setBatchLoading(false)
    }
  }, [selectedTaskIds, exitBulkMode, showError, batchLoading])

  // Keyboard: Escape to exit bulk mode, Ctrl+Shift+A to toggle
  useEffect(() => {
    const handleKeyDown = (e) => {
      const tag = e.target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return
      if (e.key === 'Escape' && bulkSelectMode) {
        exitBulkMode()
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'A') {
        e.preventDefault()
        setBulkSelectMode(prev => {
          if (prev) { setSelectedTaskIds([]); return false }
          return true
        })
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [bulkSelectMode, exitBulkMode])

  // --- High-churn context value ---
  // Re-fires on every keystroke / filter toggle / fetch tick. Includes:
  //   - Task data: tasks, projects, archivedProjects, loading, recentlyUpdatedIds, githubLinks.
  //   - Filter state + setters (setters are React-stable, but we keep state and its setter together for ergonomics).
  //   - Derived: filteredTasks, uniqueAssignees, activeFilterCount.
  //   - Selection / scope: selectedTask, activeProject + setActiveProject.
  //   - Agent observation state (taskViewers churns frequently as users join/leave tasks).
  //   - Bulk-select state (mode + selected ids + batch loading flag).
  //   - errorToast (transient, but cheap).
  const highChurnValue = useMemo(() => ({
    tasks: taskState.tasks,
    workspaceTasks: taskState.workspaceTasks,
    projects: taskState.projects,
    allProjects: taskState.allProjects,
    workspaces: taskState.workspaces,
    activeWorkspace: taskState.activeWorkspace,
    archivedProjects: taskState.archivedProjects,
    loading: taskState.loading,
    selectedTask: taskState.selectedTask,
    activeProject: taskState.activeProject,
    setActiveProject: taskState.setActiveProject,
    filterType: taskState.filterType,
    setFilterType: taskState.setFilterType,
    filterPriority: taskState.filterPriority,
    setFilterPriority: taskState.setFilterPriority,
    filterAssignee: taskState.filterAssignee,
    setFilterAssignee: taskState.setFilterAssignee,
    filterToday: taskState.filterToday,
    setFilterToday: taskState.setFilterToday,
    filterStale: taskState.filterStale,
    setFilterStale: taskState.setFilterStale,
    filterShellActive: taskState.filterShellActive,
    setFilterShellActive: taskState.setFilterShellActive,
    searchQuery: taskState.searchQuery,
    setSearchQuery: taskState.setSearchQuery,
    filteredTasks: filteredTasksWithShell,
    uniqueAssignees: taskState.uniqueAssignees,
    activeFilterCount: taskState.activeFilterCount,
    recentlyUpdatedIds: taskState.recentlyUpdatedIds,
    githubLinks: taskState.githubLinks,
    activeAgents: agents.activeAgents,
    agentsEnabled: agents.agentsEnabled,
    aiChatEnabled: agents.aiChatEnabled,
    taskViewers: agents.taskViewers,
    shellSessions: shell.shellSessions,
    bulkSelectMode,
    selectedTaskIds,
    batchLoading,
    errorToast,
  }), [
    taskState.tasks, taskState.workspaceTasks, taskState.projects, taskState.allProjects,
    taskState.workspaces, taskState.activeWorkspace,
    taskState.archivedProjects, taskState.loading,
    taskState.selectedTask, taskState.activeProject, taskState.setActiveProject,
    taskState.filterType, taskState.setFilterType,
    taskState.filterPriority, taskState.setFilterPriority,
    taskState.filterAssignee, taskState.setFilterAssignee,
    taskState.filterToday, taskState.setFilterToday,
    taskState.filterStale, taskState.setFilterStale,
    taskState.filterShellActive, taskState.setFilterShellActive,
    taskState.searchQuery, taskState.setSearchQuery,
    filteredTasksWithShell, taskState.uniqueAssignees, taskState.activeFilterCount,
    taskState.recentlyUpdatedIds, taskState.githubLinks,
    agents.activeAgents, agents.agentsEnabled, agents.aiChatEnabled, agents.taskViewers,
    shell.shellSessions,
    bulkSelectMode, selectedTaskIds, batchLoading, errorToast,
  ])

  // --- Stable context value ---
  // Refs change rarely. Includes:
  //   - All task / project mutation handlers (useCallback'd in useTasks).
  //   - fetchData + fetchGithubLinks.
  //   - selectTask, resetAllFilters.
  //   - Agent action handlers.
  //   - undoRedo (its internal state churns per mutation, not per keystroke — acceptable).
  //   - All bulk-select handlers + setBulkSelectMode.
  //   - showError + setErrorToast.
  // Components reading only this slice (e.g. CommandPalette) are immune to
  // keystroke / filter / fetch churn.
  const stableValue = useMemo(() => ({
    fetchData: taskState.fetchData,
    fetchGithubLinks: taskState.fetchGithubLinks,
    selectTask: taskState.selectTask,
    handleUpdateTask: taskState.handleUpdateTask,
    handleDeleteTask: taskState.handleDeleteTask,
    handleCreateTask: taskState.handleCreateTask,
    handleCreateProject: taskState.handleCreateProject,
    handleDeleteProject: taskState.handleDeleteProject,
    archiveProject: taskState.archiveProject,
    unarchiveProject: taskState.unarchiveProject,
    setActiveWorkspace: taskState.setActiveWorkspace,
    createWorkspace: taskState.createWorkspace,
    renameWorkspace: taskState.renameWorkspace,
    deleteWorkspace: taskState.deleteWorkspace,
    assignProjectWorkspace: taskState.assignProjectWorkspace,
    resetAllFilters: taskState.resetAllFilters,
    handleStartAgent: agents.handleStartAgent,
    handleStopAgent: agents.handleStopAgent,
    undoRedo,
    setBulkSelectMode,
    toggleSelectTask,
    shiftSelectTask,
    toggleSelectColumn,
    selectAllVisible,
    deselectAll,
    exitBulkMode,
    handleBatchUpdate,
    handleBatchDelete,
    showError,
    setErrorToast,
  }), [
    taskState.fetchData, taskState.fetchGithubLinks, taskState.selectTask,
    taskState.handleUpdateTask, taskState.handleDeleteTask, taskState.handleCreateTask,
    taskState.handleCreateProject, taskState.handleDeleteProject,
    taskState.archiveProject, taskState.unarchiveProject,
    taskState.setActiveWorkspace, taskState.createWorkspace,
    taskState.renameWorkspace, taskState.deleteWorkspace,
    taskState.assignProjectWorkspace,
    taskState.resetAllFilters,
    agents.handleStartAgent, agents.handleStopAgent,
    undoRedo,
    toggleSelectTask, shiftSelectTask, toggleSelectColumn,
    selectAllVisible, deselectAll, exitBulkMode,
    handleBatchUpdate, handleBatchDelete,
    showError,
  ])

  return (
    <TaskHighChurnContext.Provider value={highChurnValue}>
      <TaskStableContext.Provider value={stableValue}>
        {children}
      </TaskStableContext.Provider>
    </TaskHighChurnContext.Provider>
  )
}

// Hooks live alongside the provider; the react-refresh rule prefers a
// separate file but every consumer in the repo imports useTaskContext
// from this module — splitting now would force a flag-day import update
// across ~25 files for no functional benefit.

// eslint-disable-next-line react-refresh/only-export-components
export function useTaskData() {
  const ctx = useContext(TaskHighChurnContext)
  if (!ctx) throw new Error('useTaskData must be used within TaskProvider')
  return ctx
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTaskActions() {
  const ctx = useContext(TaskStableContext)
  if (!ctx) throw new Error('useTaskActions must be used within TaskProvider')
  return ctx
}

// Compat shim — preserves the legacy TaskContext surface so every existing
// consumer keeps working without edits. New code should prefer useTaskData()
// or useTaskActions() to subscribe to the narrower slice they actually need.
// Phase 4 of the perf plan will (optionally) remove this shim once all
// hot-path consumers are migrated.
// eslint-disable-next-line react-refresh/only-export-components
export function useTaskContext() {
  const data = useTaskData()
  const actions = useTaskActions()
  return useMemo(() => ({ ...data, ...actions }), [data, actions])
}
