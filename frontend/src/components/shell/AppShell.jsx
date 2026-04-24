// Facelift AppShell — Phase 3.
//
// The new top-level layout wrapper. Renders only when FACELIFT_SHELL_ENABLED
// is on; otherwise App.jsx falls back to the legacy sidebar+board layout.
//
// Grid:
//   [topbar 48][...] rows
//   [focal flex][detail {width} or 0] columns
//
// Phase 3 upgrades:
//   - Detail pane has real 5-tab content (Description / Comments / Activity / AI / Agent Log)
//   - Resize handle persisted to localStorage (taskBoardDetailWidth)
//   - Escape key closes detail pane
//   - URL binding via ?task=<id> — round-trips selection + deep-linking
//   - Cmd+Shift+Enter still opens opt-in focus modal (TaskModal)

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useTaskContext } from '../../contexts/TaskContext'
import TopBar from './TopBar'
import FocalZone from './FocalZone'
import DetailPane from './DetailPane'
import TaskModal from '../TaskModal'
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
  const { user, socketRef } = useAuth()
  const ctx = useTaskContext()
  const {
    filteredTasks, tasks, projects, activeProject, loading, selectedTask,
    selectTask, handleDeleteTask,
    activeAgents, taskViewers, handleStartAgent, handleStopAgent,
    undoRedo, bulkSelectMode, setBulkSelectMode, selectedTaskIds,
    toggleSelectTask, shiftSelectTask, toggleSelectColumn,
    recentlyUpdatedIds, githubLinks, errorToast, setErrorToast,
    agentsEnabled, aiChatEnabled,
  } = ctx

  const [activeView, setActiveView] = useState(() => localStorage.getItem('taskBoardView') || 'board')
  const [focusModal, setFocusModal] = useState(false)
  const [detailWidth, setDetailWidth] = useState(readStoredWidth)
  const syncingUrl = useRef(false)

  const handleChangeView = useCallback((view) => {
    setActiveView(view)
    localStorage.setItem('taskBoardView', view)
  }, [])

  // --- URL <-> selection round-trip ---------------------------------------
  // Read ?task= on mount + on popstate; find the task by id; select it.
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

  // Write ?task= when selection changes (skip if we're the ones applying the URL)
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

  // --- Keyboard: Escape closes detail, Cmd+Shift+Enter toggles focus modal --
  useEffect(() => {
    const handler = (e) => {
      if (!selectedTask) return
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Enter') {
        e.preventDefault()
        setFocusModal((v) => !v)
        return
      }
      if (e.key === 'Escape' && !focusModal) {
        // Don't steal Escape from modals/overlays in the legacy path — they handle it first via ModalOverlay
        selectTask(null)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectedTask, focusModal, selectTask])

  useEffect(() => {
    if (!selectedTask) setFocusModal(false)
  }, [selectedTask])

  const detailOpen = Boolean(selectedTask) && !focusModal
  const detailGridCol = detailOpen ? `minmax(0, ${detailWidth}px)` : '0'

  return (
    <div
      className="h-screen overflow-hidden bg-app-bg text-app-text app-shell facelift-shell"
      style={{
        display: 'grid',
        gridTemplateRows: '[topbar] 48px [content] 1fr',
        gridTemplateColumns: `[focal] 1fr [detail] ${detailGridCol}`,
        gridTemplateAreas: `
          'topbar topbar'
          'focal detail'
        `,
        fontFamily: 'var(--font-sans)',
      }}
    >
      <TopBar activeView={activeView} onChangeView={handleChangeView} user={user} />

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

      {/* Focus-mode modal — opt-in via Cmd+Shift+Enter */}
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
