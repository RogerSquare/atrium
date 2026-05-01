import { useState, useEffect, useCallback, useMemo, useRef, startTransition } from 'react'
import { API_URL, API_BASE, apiFetch } from '../config'

export default function useTasks(user, socketRef) {
  const [tasks, setTasks] = useState([])
  const [projects, setProjects] = useState([{ id: 'root', name: 'Root', folder: 'Root' }])
  const [archivedProjects, setArchivedProjects] = useState([])
  const [githubLinks, setGithubLinks] = useState({})  // by_task_id map from /api/github/links
  const [recentlyUpdatedIds, setRecentlyUpdatedIds] = useState([])
  const flashTimersRef = useRef({})
  const [activeProject, setActiveProject] = useState(localStorage.getItem('opusBoardActiveProject') || 'All')
  const [filterType, setFilterType] = useState('all')
  const [filterPriority, setFilterPriority] = useState('all')
  const [filterAssignee, setFilterAssignee] = useState('all')
  const [filterToday, setFilterToday] = useState(false)
  const [filterStale, setFilterStale] = useState(false)
  // Slice 5: opt-in filter to narrow the board to tasks with an alive
  // web-shell PTY (per useShellSessions). State lives here for parity
  // with the other filters; the actual list intersection happens in
  // TaskContext where shellSessions is also in scope.
  const [filterShellActive, setFilterShellActive] = useState(false)
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
      const [tasksRes, projectsRes, archivedRes] = await Promise.all([
        apiFetch(`${API_URL}/tasks`),
        apiFetch(`${API_URL}/projects?include=active`),
        apiFetch(`${API_URL}/projects?include=archived`)
      ])

      if (tasksRes.ok && projectsRes.ok) {
        const tasksData = await tasksRes.json()
        const projectsData = await projectsRes.json()
        const archivedData = archivedRes.ok ? await archivedRes.json() : []
        setTasks(tasksData)
        setProjects(projectsData)
        setArchivedProjects(archivedData)

        // Validate active project — only override if the saved project has
        // been archived mid-session. Don't silently switch to 'folders[0]'
        // on a transient-looking mismatch, that was stomping persisted
        // selections when the API shape drifted or the project loaded late.
        setActiveProject(prev => {
          const archivedFolders = archivedData.map(p => p.folder || p)
          if (prev !== 'All' && archivedFolders.includes(prev)) return 'All'
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

  // Polling cadence: 5 minutes. Acts as a backstop for missed socket events
  // (the realtime path drives most updates). Was 60s; the shorter interval
  // produced ~30-80ms re-render cascades at N=500 every minute even when no
  // data had actually changed, with no observable benefit because the socket
  // already covers the normal-operation case. Trade-off: recovery from a
  // silent socket disconnect slows from ~1min to ~5min.
  // See opt-tasks-polling-001 / opt-perf-audit-001 finding F4.
  useEffect(() => {
    if (user) {
      fetchData()
      const interval = setInterval(fetchData, 300000)
      return () => clearInterval(interval)
    }
  }, [user, fetchData])

  // Fetch GitHub links for the active project — shared across all views (Board, List, TaskModal, Changes).
  // Runs on project change + after data refresh. 5-min backend cache; manual refresh via refreshGithubLinks(true).
  const fetchGithubLinks = useCallback(async (refresh = false) => {
    if (!user) return
    // Find the project id for the active project
    const proj = activeProject !== 'All'
      ? projects.find(p => (p.folder || p) === activeProject)
      : null
    if (!proj || !proj.id || proj.id === 'root') {
      setGithubLinks({})
      return
    }
    try {
      const url = `${API_URL}/github/links?project=${encodeURIComponent(proj.id)}${refresh ? '&refresh=1' : ''}`
      const res = await apiFetch(url)
      if (res.ok) {
        const data = await res.json()
        setGithubLinks(data.by_task_id || {})
      }
    } catch { /* non-critical */ }
  }, [user, activeProject, projects])

  useEffect(() => {
    fetchGithubLinks(false)
  }, [fetchGithubLinks])

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
    // setSelectedTask wrapped in startTransition so click feedback (apple-press
    // animation, etc.) paints immediately while the lazy TaskModal mounts in the
    // background. Side effects below (socket emits, URL pushState) stay outside
    // the transition so they fire promptly — they don't block paint and tying
    // them to the click semantics keeps rapid-click ordering tight.
    // See opt-select-task-latency-001 / opt-interaction-latency-001 finding I-4.
    startTransition(() => {
      setSelectedTask(prev => {
        if (prev && socketRef.current) {
          socketRef.current.emit('task_view_end', { taskId: prev.id })
        }
        return task
      })
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
        const remaining = projects.filter(p => (p.folder || p) !== activeProject)
        setActiveProject(remaining.length > 0 ? (remaining[0].folder || remaining[0]) : 'Root')
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

  const archiveProject = useCallback(async (idOrName) => {
    if (!idOrName || idOrName === 'Root' || idOrName === 'root') return { ok: false, error: 'Cannot archive Root' }
    try {
      const res = await apiFetch(`${API_URL}/projects/${encodeURIComponent(idOrName)}/archive`, { method: 'POST' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        return { ok: false, error: err.error || 'Archive failed' }
      }
      // If the archived project was active, fall back to 'All' so we don't land on nothing
      setActiveProject(prev => prev === idOrName ? 'All' : prev)
      await fetchData()
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error.message }
    }
  }, [fetchData])

  const unarchiveProject = useCallback(async (idOrName) => {
    if (!idOrName || idOrName === 'Root' || idOrName === 'root') return { ok: false, error: 'Root is never archived' }
    try {
      const res = await apiFetch(`${API_URL}/projects/${encodeURIComponent(idOrName)}/unarchive`, { method: 'POST' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        return { ok: false, error: err.error || 'Restore failed' }
      }
      await fetchData()
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error.message }
    }
  }, [fetchData])

  const activeFilterCount = [
    filterType !== 'all',
    filterPriority !== 'all',
    filterAssignee !== 'all',
    filterToday,
    filterStale,
    filterShellActive,
    searchQuery !== ''
  ].filter(Boolean).length

  const resetAllFilters = useCallback(() => {
    setFilterType('all')
    setFilterPriority('all')
    setFilterAssignee('all')
    setFilterToday(false)
    setFilterStale(false)
    setFilterShellActive(false)
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
      const standardStatusIds = ['draft', 'todo', 'in_progress', 'waiting_input', 'review', 'done']
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
    filterShellActive,
    setFilterShellActive,
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
    archivedProjects,
    archiveProject,
    unarchiveProject,
    githubLinks,
    fetchGithubLinks,
    fetchData,
    recentlyUpdatedIds,
  }
}
