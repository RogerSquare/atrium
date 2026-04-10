import { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { API_URL, apiFetch } from '../config'
import useTasks from '../hooks/useTasks'
import useAgents from '../hooks/useAgents'
import useUndoRedo from '../hooks/useUndoRedo'

const TaskContext = createContext(null)

export function TaskProvider({ user, socketRef, children }) {
  const taskState = useTasks(user, socketRef)
  const agents = useAgents(user, socketRef, taskState.fetchData)
  const undoRedo = useUndoRedo(taskState.tasks, taskState.handleUpdateTask)

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

  const value = useMemo(() => ({
    // Task state (from useTasks hook)
    ...taskState,
    // Agents
    ...agents,
    // Undo/redo
    undoRedo,
    // Bulk selection
    bulkSelectMode, setBulkSelectMode, selectedTaskIds, batchLoading,
    toggleSelectTask, shiftSelectTask, toggleSelectColumn,
    selectAllVisible, deselectAll, exitBulkMode,
    handleBatchUpdate, handleBatchDelete,
    // Error toast
    errorToast, showError, setErrorToast,
  }), [
    taskState, agents, undoRedo,
    bulkSelectMode, selectedTaskIds, batchLoading,
    toggleSelectTask, shiftSelectTask, toggleSelectColumn,
    selectAllVisible, deselectAll, exitBulkMode,
    handleBatchUpdate, handleBatchDelete,
    errorToast, showError,
  ])

  return (
    <TaskContext.Provider value={value}>
      {children}
    </TaskContext.Provider>
  )
}

export function useTaskContext() {
  const ctx = useContext(TaskContext)
  if (!ctx) throw new Error('useTaskContext must be used within TaskProvider')
  return ctx
}
