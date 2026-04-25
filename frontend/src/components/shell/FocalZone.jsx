// Facelift FocalZone — Phase 2 + Phase 7.
//
// The product's focal surface: Board / List / Changes switch here.
// Receives filtered tasks + task-action props; forwards to the active view.
// Phase 7 wraps the active view in AnimatePresence for a cross-fade between
// views. The crossfade is keyed on activeView so a new keyed motion.div
// mounts each switch; AnimatePresence mode="wait" ensures the previous one
// finishes exiting before the new one enters.

import Board from '../Board'
import ListView from '../ListView'
import ChangesView from '../ChangesView'
import GraphView from '../GraphView'
import { motion, AnimatePresence, useMotionTransition, MOTION_DURATIONS } from '../../lib/motion'

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
  topSlot,
}) {
  const transition = useMotionTransition({ duration: MOTION_DURATIONS.viewFade, ease: 'easeOut' })

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
      {topSlot}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={activeView}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={transition}
          style={{ height: '100%', minHeight: 0 }}
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
          ) : activeView === 'graph' ? (
            <GraphView tasks={tasks} onSelectTask={onSelectTask} githubLinks={githubLinks} />
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
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
