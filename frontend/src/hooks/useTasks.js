import { useState, useEffect, useCallback, useMemo, useRef, startTransition } from 'react'
import { API_URL, apiFetch } from '../config'

export default function useTasks(user, socketRef) {
  const [tasks, setTasks] = useState([])
  const [projects, setProjects] = useState([{ id: 'root', name: 'Root', folder: 'Root' }])
  const [archivedProjects, setArchivedProjects] = useState([])
  const [githubLinks, setGithubLinks] = useState({})  // by_task_id map from /api/github/links
  const [recentlyUpdatedIds, setRecentlyUpdatedIds] = useState([])
  const flashTimersRef = useRef({})
  const [activeProject, setActiveProject] = useState(localStorage.getItem('opusBoardActiveProject') || 'All')
  // Workspaces isolate (feat-workspaces-impl-001): the active workspace is a
  // filter ONE LEVEL ABOVE activeProject — only its projects (and their
  // tasks) exist anywhere in the UI. 'personal' is the backend-guaranteed
  // default that holds Root and every pre-workspaces project.
  const [workspaces, setWorkspaces] = useState([{ id: 'personal', name: 'Personal', order: 0 }])
  const [activeWorkspace, setActiveWorkspace] = useState(localStorage.getItem('atriumActiveWorkspace') || 'personal')
  // Mirror for fetchData's load-time validation — fetchData deliberately does
  // NOT depend on activeWorkspace (a switch should not trigger a refetch).
  const activeWorkspaceRef = useRef(activeWorkspace)
  useEffect(() => { activeWorkspaceRef.current = activeWorkspace }, [activeWorkspace])
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

  useEffect(() => {
    localStorage.setItem('atriumActiveWorkspace', activeWorkspace)
  }, [activeWorkspace])

  const fetchData = useCallback(async () => {
    if (!user) return
    try {
      // Deliberately UNPAGINATED (opt-tasks-pagination-001): omitting `limit`
      // is the explicit opt-in for the full plain-array response. The board
      // needs every task at once (column counts, client-side filters, drag
      // targets) and rendering is already virtualized; pagination exists for
      // agents/MCP, where tool-result budgets are the constraint.
      const [tasksRes, projectsRes, archivedRes, workspacesRes] = await Promise.all([
        apiFetch(`${API_URL}/tasks`),
        apiFetch(`${API_URL}/projects?include=active`),
        apiFetch(`${API_URL}/projects?include=archived`),
        apiFetch(`${API_URL}/workspaces`)
      ])

      if (tasksRes.ok && projectsRes.ok) {
        const tasksData = await tasksRes.json()
        const projectsData = await projectsRes.json()
        const archivedData = archivedRes.ok ? await archivedRes.json() : []
        const workspacesData = workspacesRes.ok ? await workspacesRes.json() : null
        setTasks(tasksData)
        setProjects(projectsData)
        setArchivedProjects(archivedData)
        if (Array.isArray(workspacesData) && workspacesData.length > 0) {
          setWorkspaces(workspacesData)
          // A persisted workspace that was deleted mid-session falls back to
          // the default rather than stranding the UI on an empty world.
          setActiveWorkspace(prev => workspacesData.some(w => w.id === prev) ? prev : 'personal')
        }

        // Validate active project — only override if the saved project has
        // been archived mid-session, or if it demonstrably belongs to a
        // different workspace than the active one (a persisted cross-
        // workspace pairing would render an empty board with a misleading
        // anchor label). Don't silently switch to 'folders[0]' on a
        // transient-looking mismatch, that was stomping persisted
        // selections when the API shape drifted or the project loaded late.
        setActiveProject(prev => {
          if (prev === 'All') return prev
          const archivedFolders = archivedData.map(p => p.folder || p)
          if (archivedFolders.includes(prev)) return 'All'
          const proj = projectsData.find(p => (p.folder || p) === prev)
          if (proj && (proj.workspace || 'personal') !== activeWorkspaceRef.current) return 'All'
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

    // Full refetch, not just /api/projects: workspace mutations emit this
    // event too, and the old narrow refetch also left archivedProjects stale.
    const onProjectChanged = () => {
      fetchData()
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
        // New projects land in the workspace you're standing in.
        body: JSON.stringify({ name, workspace: activeWorkspace })
      })
      if (res.ok) {
        const data = await res.json()
        // activeProject stores the FOLDER; data.project is the short id and
        // matched no picker row (pre-workspaces bug, fixed with the backend's
        // new `folder` response field).
        setActiveProject(data.folder || data.project)
        fetchData()
      } else {
        const errorData = await res.json()
        alert(`Error: ${errorData.error}`)
      }
    } catch (error) {
      console.error('Failed to create project', error)
      alert('Failed to create project')
    }
  }, [fetchData, activeWorkspace])

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

  // The isolation lens: every consumer below gets ONLY the active workspace's
  // projects. Root carries workspace 'personal' from the backend, so outside
  // the default workspace the "No project" row (and its tasks) simply do not
  // exist — the requestor pinned Root tasks to the default workspace.
  const workspaceProjects = useMemo(
    () => projects.filter(p => (p.workspace || 'personal') === activeWorkspace),
    [projects, activeWorkspace]
  )
  // Folder → workspace lookup for task filtering. A task whose folder is not
  // in the registry at all resolves to 'personal' — a task must NEVER vanish
  // from every workspace because the registry hasn't caught up with disk.
  const workspaceByFolder = useMemo(() => {
    const m = new Map()
    for (const p of projects) m.set(p.folder || p, p.workspace || 'personal')
    return m
  }, [projects])
  // The active workspace's tasks, before any board filters — feeds both
  // filteredTasks and count surfaces (ProjectAnchor's "All projects" total).
  const workspaceTasks = useMemo(
    () => tasks.filter(t => (workspaceByFolder.get(t.project || 'Root') ?? 'personal') === activeWorkspace),
    [tasks, workspaceByFolder, activeWorkspace]
  )
  const workspaceArchivedProjects = useMemo(
    () => archivedProjects.filter(p => (p.workspace || 'personal') === activeWorkspace),
    [archivedProjects, activeWorkspace]
  )

  // Switching workspaces switches the whole visible world; a project selection
  // from the old workspace would strand the board on an empty filter, so it
  // resets to 'All' (= all projects of the NEW workspace) unless it carries over.
  const switchWorkspace = useCallback((wsId) => {
    setActiveWorkspace(wsId)
    setActiveProject(prev => {
      if (prev === 'All') return prev
      const proj = projects.find(p => (p.folder || p) === prev)
      return proj && (proj.workspace || 'personal') === wsId ? prev : 'All'
    })
  }, [projects])

  const createWorkspace = useCallback(async (name) => {
    try {
      const res = await apiFetch(`${API_URL}/workspaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        return { ok: false, error: err.error || 'Create failed' }
      }
      const data = await res.json()
      await fetchData()
      return { ok: true, workspace: data.workspace }
    } catch (error) {
      return { ok: false, error: error.message }
    }
  }, [fetchData])

  const renameWorkspace = useCallback(async (id, name) => {
    try {
      const res = await apiFetch(`${API_URL}/workspaces/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        return { ok: false, error: err.error || 'Rename failed' }
      }
      await fetchData()
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error.message }
    }
  }, [fetchData])

  const deleteWorkspace = useCallback(async (id) => {
    try {
      const res = await apiFetch(`${API_URL}/workspaces/${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        return { ok: false, error: err.error || 'Delete failed' }
      }
      setActiveWorkspace(prev => prev === id ? 'personal' : prev)
      await fetchData()
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error.message }
    }
  }, [fetchData])

  const assignProjectWorkspace = useCallback(async (idOrFolder, wsId) => {
    try {
      const res = await apiFetch(`${API_URL}/projects/${encodeURIComponent(idOrFolder)}/workspace`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace: wsId })
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        return { ok: false, error: err.error || 'Move failed' }
      }
      // Moving the ACTIVE project out from under the current workspace would
      // leave the board filtered on something invisible — same stale rule as
      // a workspace switch.
      if (wsId !== activeWorkspace) {
        const moved = projects.find(p => (p.folder || p) === idOrFolder || p.id === idOrFolder)
        const movedFolder = moved ? (moved.folder || moved) : idOrFolder
        setActiveProject(prev => prev === movedFolder ? 'All' : prev)
      }
      await fetchData()
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error.message }
    }
  }, [fetchData, activeWorkspace, projects])

  const STALE_THRESHOLDS = { in_progress: 3, review: 7 }

  const filteredTasks = useMemo(() => {
    const todayStart = filterToday ? new Date().setHours(0, 0, 0, 0) : 0

    // workspaceTasks is already isolation-filtered — the workspace lens
    // trumps everything below, including the uncategorized-status passthrough.
    return workspaceTasks.filter(t => {
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
  }, [workspaceTasks, activeProject, filterType, filterPriority, filterAssignee, filterToday, filterStale, searchQuery, user?.username])

  // Cleanup flash timers on unmount
  useEffect(() => {
    return () => {
      Object.values(flashTimersRef.current).forEach(clearTimeout)
    }
  }, [])

  return {
    tasks,
    workspaceTasks,
    // The workspace-scoped list ships under the historical name so every
    // consumer (pickers, board, anchor, graph, loops) isolates for free;
    // allProjects is the unscoped registry for management surfaces only.
    projects: workspaceProjects,
    allProjects: projects,
    workspaces,
    activeWorkspace,
    setActiveWorkspace: switchWorkspace,
    createWorkspace,
    renameWorkspace,
    deleteWorkspace,
    assignProjectWorkspace,
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
    archivedProjects: workspaceArchivedProjects,
    archiveProject,
    unarchiveProject,
    githubLinks,
    fetchGithubLinks,
    fetchData,
    recentlyUpdatedIds,
  }
}
