import { useState, useCallback, useEffect, useRef } from 'react'

const MAX_STACK = 20
const TOAST_DURATION = 5000

export default function useUndoRedo(tasks, handleUpdateTask) {
  const [undoStack, setUndoStack] = useState([])
  const [redoStack, setRedoStack] = useState([])
  const [undoToast, setUndoToast] = useState(null)
  const toastTimerRef = useRef(null)

  const clearToast = useCallback(() => {
    setUndoToast(null)
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current)
      toastTimerRef.current = null
    }
  }, [])

  const showToast = useCallback((message) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setUndoToast(message)
    toastTimerRef.current = setTimeout(() => {
      setUndoToast(null)
      toastTimerRef.current = null
    }, TOAST_DURATION)
  }, [])

  // Wrapped update that captures previous state for undo
  const updateTaskWithUndo = useCallback((id, updates) => {
    const prevTask = tasks.find(t => t.id === id)
    if (!prevTask) {
      handleUpdateTask(id, updates)
      return
    }

    // Capture only the fields being changed
    const snapshot = {}
    for (const key of Object.keys(updates)) {
      snapshot[key] = prevTask[key]
    }

    setUndoStack(prev => {
      const next = [...prev, { id, prev: snapshot, next: updates }]
      return next.length > MAX_STACK ? next.slice(-MAX_STACK) : next
    })
    setRedoStack([])

    handleUpdateTask(id, updates)

    // Build a human-readable summary
    const changedFields = Object.keys(updates)
    let msg = `Task ${id} updated`
    if (changedFields.length === 1) {
      const field = changedFields[0]
      if (field === 'status') msg = `Moved "${prevTask.title}" to ${updates.status.replace('_', ' ')}`
      else if (field === 'priority') msg = `Changed "${prevTask.title}" priority to ${updates.priority}`
      else if (field === 'assignee') msg = `Assigned "${prevTask.title}" to ${updates.assignee || 'nobody'}`
      else msg = `Updated "${prevTask.title}" ${field}`
    } else {
      msg = `Updated "${prevTask.title}"`
    }
    showToast(msg)
  }, [tasks, handleUpdateTask, showToast])

  const undo = useCallback(() => {
    setUndoStack(prev => {
      if (prev.length === 0) return prev
      const entry = prev[prev.length - 1]
      const rest = prev.slice(0, -1)

      setRedoStack(rPrev => {
        const next = [...rPrev, entry]
        return next.length > MAX_STACK ? next.slice(-MAX_STACK) : next
      })

      if (entry.batch) {
        entry.batch.forEach(e => handleUpdateTask(e.id, e.prev))
        showToast(`Undone ${entry.batch.length} tasks`)
      } else {
        handleUpdateTask(entry.id, entry.prev)
        showToast('Undone')
      }
      return rest
    })
  }, [handleUpdateTask, showToast])

  const redo = useCallback(() => {
    setRedoStack(prev => {
      if (prev.length === 0) return prev
      const entry = prev[prev.length - 1]
      const rest = prev.slice(0, -1)

      setUndoStack(uPrev => {
        const next = [...uPrev, entry]
        return next.length > MAX_STACK ? next.slice(-MAX_STACK) : next
      })

      if (entry.batch) {
        entry.batch.forEach(e => handleUpdateTask(e.id, e.next))
        showToast(`Redone ${entry.batch.length} tasks`)
      } else {
        handleUpdateTask(entry.id, entry.next)
        showToast('Redone')
      }
      return rest
    })
  }, [handleUpdateTask, showToast])

  // Push a batch undo entry: array of { id, prev, next } changes
  const pushBatchUndo = useCallback((entries, message) => {
    if (!entries || entries.length === 0) return
    setUndoStack(prev => {
      const next = [...prev, { batch: entries }]
      return next.length > MAX_STACK ? next.slice(-MAX_STACK) : next
    })
    setRedoStack([])
    if (message) showToast(message)
  }, [showToast])

  // Keyboard shortcuts: Ctrl+Z for undo, Ctrl+Shift+Z / Ctrl+Y for redo
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't intercept when typing in inputs/textareas
      const tag = e.target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return

      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'Z' || e.key === 'y') && (e.shiftKey || e.key === 'y')) {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [undo, redo])

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    }
  }, [])

  return {
    updateTaskWithUndo,
    pushBatchUndo,
    undo,
    redo,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    undoToast,
    clearToast,
  }
}
