// Facelift AppShell — Phase 2.
//
// The new top-level layout wrapper. Renders only when FACELIFT_SHELL_ENABLED
// is on; otherwise App.jsx falls back to the legacy sidebar+board layout.
//
// Grid:
//   [topbar 48][...] rows
//   [focal flex][detail 520 or 0] columns
//
// Phase 2 scope: skeleton wiring only. The TaskModal is still the opt-in
// focus-mode for tasks — Phase 3 replaces it with the detail pane as default.
// Phases 4 / 6 / 7 / 8 extend the shell with nav rewrite, command palette,
// motion layer, and ChangesView cleanup respectively.

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useTaskContext } from '../../contexts/TaskContext'
import TopBar from './TopBar'
import FocalZone from './FocalZone'
import DetailPane from './DetailPane'
import TaskModal from '../TaskModal'
import ErrorToast from '../ErrorToast'
import UndoToast from '../UndoToast'

export default function AppShell() {
  const { user } = useAuth()
  const ctx = useTaskContext()
  const {
    filteredTasks, projects, activeProject, loading, selectedTask,
    selectTask, handleUpdateTask, handleDeleteTask,
    activeAgents, taskViewers, handleStartAgent, handleStopAgent,
    undoRedo, bulkSelectMode, setBulkSelectMode, selectedTaskIds,
    toggleSelectTask, shiftSelectTask, toggleSelectColumn,
    recentlyUpdatedIds, githubLinks, errorToast, setErrorToast,
    agentsEnabled, aiChatEnabled,
  } = ctx

  const [activeView, setActiveView] = useState(() => localStorage.getItem('taskBoardView') || 'board')
  const [focusModal, setFocusModal] = useState(false)

  const handleChangeView = useCallback((view) => {
    setActiveView(view)
    localStorage.setItem('taskBoardView', view)
  }, [])

  // Cmd+Shift+Enter expands detail pane into focus modal (opt-in per plan decision #4)
  useEffect(() => {
    const handler = (e) => {
      if (selectedTask && (e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Enter') {
        e.preventDefault()
        setFocusModal((v) => !v)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectedTask])

  // Close focus modal when the selection clears
  useEffect(() => {
    if (!selectedTask) setFocusModal(false)
  }, [selectedTask])

  const detailOpen = Boolean(selectedTask) && !focusModal
  const detailWidth = detailOpen ? 'minmax(0, 520px)' : '0'

  return (
    <div
      className="h-screen overflow-hidden bg-app-bg text-app-text app-shell facelift-shell"
      style={{
        display: 'grid',
        gridTemplateRows: '[topbar] 48px [content] 1fr',
        gridTemplateColumns: `[focal] 1fr [detail] ${detailWidth}`,
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
        <DetailPane task={selectedTask} onClose={() => selectTask(null)} />
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
          socket={undefined}
          taskViewers={taskViewers[selectedTask?.id] || []}
          agentsEnabled={agentsEnabled}
          canRunAgents={user?.can_run_agents !== false}
          aiChatEnabled={aiChatEnabled}
          githubLinks={githubLinks}
        />
      )}

      {/* Toasts survive — they're orthogonal to shell */}
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
