import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { API_URL, API_BASE, apiFetch } from '../config'

export default function useTasks(user, socketRef) {
  const [tasks, setTasks] = useState([])
  const [projects, setProjects] = useState(['Root'])
  const [recentlyUpdatedIds, setRecentlyUpdatedIds] = useState([])
  const flashTimersRef = useRef({})
  const [activeProject, setActiveProject] = useState(localStorage.getItem('opusBoardActiveProject') || 'All')
  const [filterType, setFilterType] = useState('all')
  const [filterPriority, setFilterPriority] = useState('all')
  const [filterAssignee, setFilterAssignee] = useState('all')
  const [filterToday, setFilterToday] = useState(false)
  const [filterStale, setFilterStale] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [selectedTask, setSelectedTask] = useState(null)
  const [pendingTaskId] = useState(() => new URLSearchParams(window.location.search).get('task'))

  useEffect(() => {
    localStorage.setItem('opusBoardActiveProject', activeProject)
  }, [activeProject])

  const fetchData = useCallback(async () => {
    if (!user) return
    try {
      const [tasksRes, projectsRes] = await Promise.all([
        apiFetch(`${API_URL}/tasks`),
        apiFetch(`${API_URL}/projects`)
      ])

      if (tasksRes.ok && projectsRes.ok) {
        const tasksData = await tasksRes.json()
        const projectsData = await projectsRes.json()
        setTasks(tasksData)
        setProjects(projectsData)

        // Validate active project — if saved project no longer exists, pick first available
        setActiveProject(prev => {
          if (prev === 'All' || !projectsData.includes(prev)) {
            return projectsData.length > 0 ? projectsData[0] : 'Root'
          }
          return prev
        })

        // Deep-link: open task from URL query param on first load
        setSelectedTask(prev => {
          const urlTaskId = new URLSearchParams(window.location.search).get('task')
          if (urlTaskId && !prev) {
            const linked = tasksData.find(t => t.id === urlTaskId)
            if (linked) return linked
          }
          // Sync selected task if it's open
          if (prev) {
            const updated = tasksData.find(t => t.id === prev.id)
            if (updated) return updated
          }
          return prev
        })
      }
    } catch (error) {
      console.error('Failed to fetch data', error)
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    if (user) {
      fetchData()
      const interval = setInterval(fetchData, 60000)
      return () => clearInterval(interval)
    }
  }, [user, fetchData])

  // Handle browser back/forward for task deep-links
  useEffect(() => {
    const handlePopState = () => {
      const taskId = new URLSearchParams(window.location.search).get('task')
      if (taskId) {
        setTasks(prev => {
          const found = prev.find(t => t.id === taskId)
          if (found) setSelectedTask(found)
          return prev
        })
      } else {
        setSelectedTask(null)
      }
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  // Socket events for task/project changes
  useEffect(() => {
    const socket = socketRef.current
    if (!socket) return

    const onTaskCreated = (task) => {
      setTasks(prev => [...prev, task])
      // Flash new task
      setRecentlyUpdatedIds(ids => [...ids, task.id])
      flashTimersRef.current[task.id] = setTimeout(() => {
        setRecentlyUpdatedIds(ids => ids.filter(id => id !== task.id))
        delete flashTimersRef.current[task.id]
      }, 1500)
    }

    const onTaskUpdated = (task) => {
      setTasks(prev => {
        const existing = prev.find(t => t.id === task.id)
        const statusChanged = existing && existing.status !== task.status
        const updated = prev.map(t => t.id === task.id ? { ...t, ...task } : t)

        // Flash the card briefly
        setRecentlyUpdatedIds(ids => ids.includes(task.id) ? ids : [...ids, task.id])
        if (flashTimersRef.current[task.id]) clearTimeout(flashTimersRef.current[task.id])
        flashTimersRef.current[task.id] = setTimeout(() => {
          setRecentlyUpdatedIds(ids => ids.filter(id => id !== task.id))
          delete flashTimersRef.current[task.id]
        }, 1500)

        // Force full refetch on status change for consistency
        if (statusChanged) {
          fetchData()
        }

        return updated
      })
      setSelectedTask(prev => prev && prev.id === task.id ? { ...prev, ...task } : prev)
    }

    const onTaskDeleted = (data) => {
      setTasks(prev => prev.filter(t => t.id !== data.id))
      setSelectedTask(prev => prev && prev.id === data.id ? null : prev)
    }

    const onProjectChanged = () => {
      apiFetch(`${API_BASE}/api/projects`)
        .then(res => res.json())
        .then(data => setProjects(data))
        .catch(console.error)
    }

    socket.on('task_created', onTaskCreated)
    socket.on('task_updated', onTaskUpdated)
    socket.on('task_deleted', onTaskDeleted)
    socket.on('project_changed', onProjectChanged)

    return () => {
      socket.off('task_created', onTaskCreated)
      socket.off('task_updated', onTaskUpdated)
      socket.off('task_deleted', onTaskDeleted)
      socket.off('project_changed', onProjectChanged)
    }
  }, [socketRef.current])

  const selectTask = useCallback((task) => {
    // End viewing on previous task
    setSelectedTask(prev => {
      if (prev && socketRef.current) {
        socketRef.current.emit('task_view_end', { taskId: prev.id })
      }
      return task
    })
    // Start viewing new task
    if (task && socketRef.current && user) {
      socketRef.current.emit('task_view_start', { taskId: task.id, username: user.username })
    }
    if (task) {
      const url = new URL(window.location)
      url.searchParams.set('task', task.id)
      window.history.pushState({}, '', url)
    } else {
      const url = new URL(window.location)
      url.searchParams.delete('task')
      window.history.pushState({}, '', url)
    }
  }, [user])

  const handleUpdateTask = useCallback(async (id, updates) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t))

    try {
      const payload = { ...updates, updated_by: user?.username }
      const res = await apiFetch(`${API_URL}/tasks/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      if (!res.ok) {
        fetchData()
      } else {
        const data = await res.json()
        setSelectedTask(prev => prev?.id === id ? data.task : prev)
        if (updates.project) {
          fetchData()
        }
      }
    } catch (error) {
      console.error('Failed to update task', error)
      fetchData()
    }
  }, [user?.username, fetchData])

  const handleDeleteTask = useCallback(async (id) => {
    if (!window.confirm('Are you sure you want to delete this task?')) return

    try {
      const res = await apiFetch(`${API_URL}/tasks/${id}`, { method: 'DELETE' })
      if (res.ok) {
        setTasks(prev => prev.filter(t => t.id !== id))
        selectTask(null)
      } else {
        const errorData = await res.json()
        alert(`Error: ${errorData.error}`)
      }
    } catch (error) {
      console.error('Failed to delete task', error)
    }
  }, [selectTask])

  const handleCreateTask = useCallback(async (taskData) => {
    try {
      const payload = { ...taskData, created_by: user?.username }
      const res = await apiFetch(`${API_URL}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      if (res.ok) {
        fetchData()
      }
    } catch (error) {
      console.error('Failed to create task', error)
    }
  }, [user?.username, fetchData])

  const handleCreateProject = useCallback(async (name) => {
    try {
      const res = await apiFetch(`${API_URL}/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      })
      if (res.ok) {
        const data = await res.json()
        setActiveProject(data.project)
        fetchData()
      } else {
        const errorData = await res.json()
        alert(`Error: ${errorData.error}`)
      }
    } catch (error) {
      console.error('Failed to create project', error)
      alert('Failed to create project')
    }
  }, [fetchData])

  const handleDeleteProject = useCallback(async () => {
    if (activeProject === 'Root') return

    if (!window.confirm(`Are you sure you want to delete the project '${activeProject}' and ALL its tasks? This action cannot be undone.`)) {
      return
    }

    try {
      const res = await apiFetch(`${API_URL}/projects/${activeProject}`, { method: 'DELETE' })
      if (res.ok) {
        // Go to first remaining project after delete
        const remaining = projects.filter(p => p !== activeProject)
        setActiveProject(remaining.length > 0 ? remaining[0] : 'Root')
        fetchData()
      } else {
        const errorData = await res.json()
        alert(`Error: ${errorData.error}`)
      }
    } catch (error) {
      console.error('Failed to delete project', error)
      alert('Failed to delete project')
    }
  }, [activeProject, projects, fetchData])

  const activeFilterCount = [
    filterType !== 'all',
    filterPriority !== 'all',
    filterAssignee !== 'all',
    filterToday,
    filterStale,
    searchQuery !== ''
  ].filter(Boolean).length

  const resetAllFilters = useCallback(() => {
    setFilterType('all')
    setFilterPriority('all')
    setFilterAssignee('all')
    setFilterToday(false)
    setFilterStale(false)
    setSearchQuery('')
  }, [])

  const uniqueAssignees = useMemo(
    () => [...new Set(tasks.map(t => t.assignee).filter(Boolean))].sort(),
    [tasks]
  )

  const STALE_THRESHOLDS = { in_progress: 3, review: 7 }

  const filteredTasks = useMemo(() => {
    const todayStart = filterToday ? new Date().setHours(0, 0, 0, 0) : 0

    return tasks.filter(t => {
      const standardStatusIds = ['todo', 'in_progress', 'review', 'done']
      const isUncategorized = !standardStatusIds.includes(t.status)

      const projectMatch = activeProject === 'All' || t.project === activeProject || isUncategorized
      const typeMatch = filterType === 'all' || t.type === filterType
      const priorityMatch = filterPriority === 'all' || t.priority === filterPriority
      const assigneeMatch = filterAssignee === 'all' ||
        (filterAssignee === 'mine' && t.assignee === user?.username) ||
        (filterAssignee === 'unassigned' && !t.assignee) ||
        t.assignee === filterAssignee
      const searchMatch = searchQuery === '' ||
        t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (t.id && t.id.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (t.component && t.component.toLowerCase().includes(searchQuery.toLowerCase()))
      const todayMatch = !filterToday || (
        t.activity_log && t.activity_log.length > 0 &&
        new Date(t.activity_log[t.activity_log.length - 1].timestamp).getTime() >= todayStart
      )
      const staleMatch = !filterStale || (() => {
        const threshold = STALE_THRESHOLDS[t.status]
        if (!threshold) return false
        const log = t.activity_log || []
        const lastActivity = log.length > 0 ? log[log.length - 1].timestamp : t.created_at
        if (!lastActivity) return false
        const daysSince = (Date.now() - new Date(lastActivity).getTime()) / (1000 * 60 * 60 * 24)
        return daysSince >= threshold
      })()

      return projectMatch && typeMatch && priorityMatch && assigneeMatch && searchMatch && todayMatch && staleMatch
    })
  }, [tasks, activeProject, filterType, filterPriority, filterAssignee, filterToday, filterStale, searchQuery, user?.username])

  // Cleanup flash timers on unmount
  useEffect(() => {
    return () => {
      Object.values(flashTimersRef.current).forEach(clearTimeout)
    }
  }, [])

  return {
    tasks,
    projects,
    loading,
    selectedTask,
    activeProject,
    setActiveProject,
    filterType,
    setFilterType,
    filterPriority,
    setFilterPriority,
    filterAssignee,
    setFilterAssignee,
    searchQuery,
    setSearchQuery,
    filterToday,
    setFilterToday,
    filterStale,
    setFilterStale,
    filteredTasks,
    uniqueAssignees,
    activeFilterCount,
    resetAllFilters,
    selectTask,
    handleUpdateTask,
    handleDeleteTask,
    handleCreateTask,
    handleCreateProject,
    handleDeleteProject,
    fetchData,
    recentlyUpdatedIds,
  }
}
