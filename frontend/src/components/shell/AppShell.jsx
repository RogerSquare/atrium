// Facelift AppShell — Phase 4.
//
// Top-level layout for the new shell. Renders only when FACELIFT_SHELL_ENABLED
// is on; App.jsx falls back to the legacy sidebar+board when off.
//
// Grid:
//   [topbar]     48px      brand + ProjectAnchor | ViewSwitcher | AvatarPopover
//   [filterbar]  40px      search + type/priority/mine/today/stale + reset
//   [content]    1fr       [focal flex] [detail {width} or 0]
//
// Settings + Help modals mount here so the avatar popover can open them.
// TaskModal stays as opt-in focus mode via Cmd+Shift+Enter.

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useTaskContext } from '../../contexts/TaskContext'
import TopBar from './TopBar'
import FilterBar from './FilterBar'
import FocalZone from './FocalZone'
import DetailPane from './DetailPane'
import CommandPalette from './CommandPalette'
import TaskModal from '../TaskModal'
import Settings from '../Settings'
import HelpModal from '../HelpModal'
import CreateProjectModal from '../CreateProjectModal'
import CreateTaskModal from '../CreateTaskModal'
import ArchivedProjectsModal from '../ArchivedProjectsModal'
import ErrorToast from '../ErrorToast'
import UndoToast from '../UndoToast'

const WIDTH_STORAGE_KEY = 'taskBoardDetailWidth'
const DEFAULT_WIDTH = 520
const MIN_WIDTH = 380
const MAX_WIDTH = 720

function readStoredWidth() {
  try {
    const raw = localStorage.getItem(WIDTH_STORAGE_KEY)
    const n = Number(raw)
    if (Number.isFinite(n) && n >= MIN_WIDTH && n <= MAX_WIDTH) return n
  } catch {}
  return DEFAULT_WIDTH
}

export default function AppShell() {
  const { user, theme, setTheme, socketRef, handleLogout, updateUser } = useAuth()
  const ctx = useTaskContext()
  const {
    filteredTasks, tasks, projects, activeProject, setActiveProject,
    loading, selectedTask, selectTask, handleDeleteTask, handleCreateProject,
    handleCreateTask,
    archivedProjects, archiveProject, unarchiveProject,
    searchQuery, setSearchQuery,
    filterType, setFilterType, filterPriority, setFilterPriority,
    filterAssignee, setFilterAssignee, filterToday, setFilterToday,
    filterStale, setFilterStale,
    uniqueAssignees, activeFilterCount, resetAllFilters,
    activeAgents, taskViewers, handleStartAgent, handleStopAgent,
    undoRedo, bulkSelectMode, setBulkSelectMode, selectedTaskIds,
    toggleSelectTask, shiftSelectTask, toggleSelectColumn,
    recentlyUpdatedIds, githubLinks, errorToast, setErrorToast,
    agentsEnabled, aiChatEnabled,
  } = ctx

  const [activeView, setActiveView] = useState(() => localStorage.getItem('taskBoardView') || 'board')
  const [focusModal, setFocusModal] = useState(false)
  const [detailWidth, setDetailWidth] = useState(readStoredWidth)
  const [showSettings, setShowSettings] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [showCreateProject, setShowCreateProject] = useState(false)
  const [showCreateTask, setShowCreateTask] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const syncingUrl = useRef(false)

  const handleChangeView = useCallback((view) => {
    setActiveView(view)
    localStorage.setItem('taskBoardView', view)
  }, [])

  // --- URL <-> selection round-trip -------------------------------------
  useEffect(() => {
    const applyUrl = () => {
      syncingUrl.current = true
      try {
        const taskId = new URLSearchParams(window.location.search).get('task')
        if (taskId) {
          const t = tasks.find((x) => x.id === taskId)
          if (t) selectTask(t)
          else if (selectedTask) selectTask(null)
        } else if (selectedTask) {
          selectTask(null)
        }
      } finally {
        queueMicrotask(() => { syncingUrl.current = false })
      }
    }
    applyUrl()
    window.addEventListener('popstate', applyUrl)
    return () => window.removeEventListener('popstate', applyUrl)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks])

  useEffect(() => {
    if (syncingUrl.current) return
    const url = new URL(window.location.href)
    if (selectedTask) {
      if (url.searchParams.get('task') !== selectedTask.id) {
        url.searchParams.set('task', selectedTask.id)
        window.history.pushState({}, '', url)
      }
    } else if (url.searchParams.has('task')) {
      url.searchParams.delete('task')
      window.history.pushState({}, '', url)
    }
  }, [selectedTask])

  // --- Keyboard -----------------------------------------------------------
  useEffect(() => {
    const handler = (e) => {
      if (!selectedTask) return
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Enter') {
        e.preventDefault()
        setFocusModal((v) => !v)
        return
      }
      if (e.key === 'Escape' && !focusModal) selectTask(null)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectedTask, focusModal, selectTask])

  useEffect(() => { if (!selectedTask) setFocusModal(false) }, [selectedTask])

  const detailOpen = Boolean(selectedTask) && !focusModal
  const detailGridCol = detailOpen ? `minmax(0, ${detailWidth}px)` : '0'

  const handleArchiveProject = useCallback(async (idOrName, displayName) => {
    const result = await archiveProject(idOrName)
    if (result.ok) {
      undoRedo.pushCustomUndo(`Archived "${displayName || idOrName}"`, {
        undoFn: () => { unarchiveProject(idOrName) },
        undoneMessage: `Restored "${displayName || idOrName}"`,
        redoFn: () => { archiveProject(idOrName) },
        redoneMessage: `Archived "${displayName || idOrName}"`,
      })
    } else {
      setErrorToast(result.error || 'Archive failed')
    }
  }, [archiveProject, unarchiveProject, undoRedo, setErrorToast])

  return (
    <div
      className="h-screen overflow-hidden bg-app-bg text-app-text app-shell facelift-shell"
      style={{
        display: 'grid',
        gridTemplateRows: '[topbar] 48px [filterbar] 40px [content] 1fr',
        gridTemplateColumns: `[focal] 1fr [detail] ${detailGridCol}`,
        gridTemplateAreas: `
          'topbar topbar'
          'filterbar filterbar'
          'focal detail'
        `,
        fontFamily: 'var(--font-sans)',
      }}
    >
      <TopBar
        user={user}
        theme={theme}
        onSetTheme={setTheme}
        onLogout={handleLogout}
        activeView={activeView}
        onChangeView={handleChangeView}
        projects={projects}
        tasks={tasks}
        activeProject={activeProject}
        onSetActiveProject={setActiveProject}
        onCreateProject={() => setShowCreateProject(true)}
        onOpenArchived={() => setShowArchived(true)}
        archivedCount={archivedProjects?.length || 0}
        onOpenSettings={() => setShowSettings(true)}
        onOpenHelp={() => setShowHelp(true)}
      />

      <FilterBar
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        filterType={filterType}
        setFilterType={setFilterType}
        filterPriority={filterPriority}
        setFilterPriority={setFilterPriority}
        filterAssignee={filterAssignee}
        setFilterAssignee={setFilterAssignee}
        filterToday={filterToday}
        setFilterToday={setFilterToday}
        filterStale={filterStale}
        setFilterStale={setFilterStale}
        uniqueAssignees={uniqueAssignees}
        activeFilterCount={activeFilterCount}
        resetAllFilters={resetAllFilters}
        filteredCount={filteredTasks.length}
        totalCount={tasks.length}
      />

      <FocalZone
        activeView={activeView}
        tasks={filteredTasks}
        projects={projects}
        activeProject={activeProject}
        loading={loading}
        onSelectTask={selectTask}
        onUpdateTask={undoRedo.updateTaskWithUndo}
        onStartAgent={handleStartAgent}
        onStopAgent={handleStopAgent}
        activeAgents={activeAgents}
        taskViewers={taskViewers}
        currentUser={user?.username}
        selectable={bulkSelectMode}
        selectedIds={selectedTaskIds}
        onToggleSelect={toggleSelectTask}
        onShiftSelect={shiftSelectTask}
        onToggleSelectColumn={toggleSelectColumn}
        onToggleBulkSelect={() =>
          setBulkSelectMode((prev) => {
            if (prev) { ctx.deselectAll(); return false }
            return true
          })
        }
        recentlyUpdatedIds={recentlyUpdatedIds}
        githubLinks={githubLinks}
      />

      {detailOpen && (
        <DetailPane
          task={selectedTask}
          currentUser={user}
          onClose={() => selectTask(null)}
          onUpdateTask={undoRedo.updateTaskWithUndo}
          activeAgents={activeAgents}
          onStartAgent={handleStartAgent}
          onStopAgent={handleStopAgent}
          socket={socketRef?.current}
          agentsEnabled={agentsEnabled}
          canRunAgents={user?.can_run_agents !== false}
          aiChatEnabled={aiChatEnabled}
          width={detailWidth}
          onWidthChange={setDetailWidth}
        />
      )}

      {/* Focus modal — opt-in via Cmd+Shift+Enter */}
      {focusModal && selectedTask && (
        <TaskModal
          task={selectedTask}
          projects={projects}
          currentUser={user}
          onClose={() => { setFocusModal(false); selectTask(null) }}
          onUpdateTask={undoRedo.updateTaskWithUndo}
          onDeleteTask={handleDeleteTask}
          activeAgents={activeAgents}
          onStartAgent={handleStartAgent}
          onStopAgent={handleStopAgent}
          socket={socketRef?.current}
          taskViewers={taskViewers[selectedTask?.id] || []}
          agentsEnabled={agentsEnabled}
          canRunAgents={user?.can_run_agents !== false}
          aiChatEnabled={aiChatEnabled}
          githubLinks={githubLinks}
        />
      )}

      {/* Settings / Help / Create Project / Archived — mounted at shell level */}
      {showSettings && (
        <Settings
          theme={theme}
          onSetTheme={setTheme}
          onClose={() => setShowSettings(false)}
          currentUser={user}
          onUserUpdate={updateUser}
        />
      )}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      {showCreateProject && (
        <CreateProjectModal
          onClose={() => setShowCreateProject(false)}
          onCreateProject={handleCreateProject}
        />
      )}
      {showCreateTask && (
        <CreateTaskModal
          projects={projects}
          activeProject={activeProject}
          onClose={() => setShowCreateTask(false)}
          onCreateTask={handleCreateTask}
        />
      )}

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        projects={projects}
        onSetActiveProject={setActiveProject}
        onChangeView={handleChangeView}
        onSetFilterType={setFilterType}
        onSetFilterPriority={setFilterPriority}
        onSetFilterAssignee={setFilterAssignee}
        onSetFilterToday={setFilterToday}
        onSetFilterStale={setFilterStale}
        onResetFilters={resetAllFilters}
        onSetTheme={setTheme}
        onCreateProject={() => setShowCreateProject(true)}
        onCreateTask={() => setShowCreateTask(true)}
        onOpenSettings={() => setShowSettings(true)}
        onOpenHelp={() => setShowHelp(true)}
        onLogout={handleLogout}
      />
      {showArchived && (
        <ArchivedProjectsModal
          archivedProjects={archivedProjects}
          onClose={() => setShowArchived(false)}
          onUnarchiveProject={(idOrName, displayName) => unarchiveProject(idOrName, displayName)}
        />
      )}

      <UndoToast
        message={undoRedo.undoToast}
        canUndo={undoRedo.canUndo}
        canRedo={undoRedo.canRedo}
        onUndo={undoRedo.undo}
        onRedo={undoRedo.redo}
        onDismiss={undoRedo.clearToast}
      />
      <ErrorToast message={errorToast} onDismiss={() => setErrorToast(null)} />
    </div>
  )
}
