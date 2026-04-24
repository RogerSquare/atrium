// Facelift FocalZone — Phase 2.
//
// The product's focal surface: Board / List / Changes switch here.
// Receives filtered tasks + task-action props; forwards to the active view.
// Phase 7 wraps this in AnimatePresence for a cross-fade between views.

import Board from '../Board'
import ListView from '../ListView'
import ChangesView from '../ChangesView'

export default function FocalZone({
  activeView,
  tasks,
  projects,
  activeProject,
  loading,
  onSelectTask,
  onUpdateTask,
  onStartAgent,
  onStopAgent,
  activeAgents,
  taskViewers,
  currentUser,
  selectable,
  selectedIds,
  onToggleSelect,
  onShiftSelect,
  onToggleSelectColumn,
  onToggleBulkSelect,
  recentlyUpdatedIds,
  githubLinks,
}) {
  if (loading) {
    return (
      <div
        style={{ gridArea: 'focal', padding: 'var(--space-4)' }}
        className="overflow-y-auto custom-scrollbar"
      >
        <div className="text-center py-12 italic animate-pulse" style={{ color: 'var(--text-muted)' }}>
          Loading workspace…
        </div>
      </div>
    )
  }

  return (
    <div
      className="overflow-y-auto custom-scrollbar"
      style={{ gridArea: 'focal', padding: 'var(--space-4)', minWidth: 0 }}
    >
      {activeView === 'list' ? (
        <ListView
          tasks={tasks}
          onSelectTask={onSelectTask}
          onUpdateTask={onUpdateTask}
          activeAgents={activeAgents}
          taskViewers={taskViewers}
          currentUser={currentUser}
          selectable={selectable}
          selectedIds={selectedIds}
          onToggleSelect={onToggleSelect}
          recentlyUpdatedIds={recentlyUpdatedIds}
          githubLinks={githubLinks}
        />
      ) : activeView === 'changes' ? (
        <ChangesView
          tasks={tasks}
          projects={projects}
          activeProject={activeProject}
          onSelectTask={onSelectTask}
          recentlyUpdatedIds={recentlyUpdatedIds}
        />
      ) : (
        <Board
          tasks={tasks}
          onUpdateTask={onUpdateTask}
          onSelectTask={onSelectTask}
          activeAgents={activeAgents}
          onStartAgent={onStartAgent}
          onStopAgent={onStopAgent}
          taskViewers={taskViewers}
          currentUser={currentUser}
          selectable={selectable}
          selectedIds={selectedIds}
          onToggleSelect={onToggleSelect}
          onShiftSelect={onShiftSelect}
          onToggleSelectColumn={onToggleSelectColumn}
          recentlyUpdatedIds={recentlyUpdatedIds}
          onToggleBulkSelect={onToggleBulkSelect}
          githubLinks={githubLinks}
        />
      )}
    </div>
  )
}
