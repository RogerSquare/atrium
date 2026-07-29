// Facelift DetailPane — Phase 3.
//
// Right-side master-detail pane. Replaces TaskModal as the default
// presentation for a selected task (TaskModal stays as Cmd+Shift+Enter
// focus mode — see AppShell).
//
// 5 tabs: Description / Comments / Activity / Changes / Shell.
// (The previous AI + Agent Log tabs were replaced by the Shell tab —
// see feat-atrium-shell-tab-001. AIChatPanel + AgentLogPanel still live
// in TaskModal's focus-mode 'ai' tab, opened via Cmd+Shift+Enter.)
// Close: X button or Escape key (escape handled in AppShell for global reach).
// Resize: drag handle on the left edge persists to localStorage.

import { useState } from 'react'
import { X, FileText, MessageSquare, Activity, Terminal, GitCommit, FlaskConical } from 'lucide-react'
import { IconButton } from '../ui'
import DetailDescription from '../detail/DetailDescription'
import DetailComments from '../detail/DetailComments'
import DetailActivity from '../detail/DetailActivity'
import DetailChanges from '../detail/DetailChanges'
import TestsTab from '../TestsTab'
import ShellManager from '../web-shell/ShellManager'
import CommandCard from '../web-shell/CommandCard'
import AutoEnterToggle from '../web-shell/AutoEnterToggle'
import StatusSegmentedControl from '../StatusSegmentedControl'
import { motion, AnimatePresence, useMotionTransition, MOTION_DURATIONS } from '../../lib/motion'

const TABS = [
  { id: 'description', label: 'Description', icon: FileText },
  { id: 'comments', label: 'Comments', icon: MessageSquare },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'changes', label: 'Changes', icon: GitCommit },
  { id: 'tests', label: 'Tests', icon: FlaskConical },
  { id: 'shell', label: 'Shell', icon: Terminal },
]

const ACTIVE_TAB_STORAGE_KEY = 'taskBoardDetailActiveTab'

// Lazy-load the persisted tab id. Validates against the TABS list
// so a renamed tab or hand-edited localStorage value doesn't strand
// the user on a non-existent tab; invalid → 'description'.
function loadInitialActiveTab() {
  try {
    const stored = window.localStorage.getItem(ACTIVE_TAB_STORAGE_KEY)
    if (stored && TABS.some(t => t.id === stored)) return stored
  } catch { /* localStorage disabled / unavailable */ }
  return 'description'
}

// `activeAgents`, `onStartAgent`, `onStopAgent`, `agentsEnabled`,
// `canRunAgents`, and `aiChatEnabled` are still threaded in from the
// parent (AppShell) for the DetailAgentLog + DetailAI tabs that used
// to live here. Those are gone now (replaced by the Shell tab); the
// parent's prop list is left untouched on purpose so this diff stays
// small. Future cleanup can prune the parent's threading too.
export default function DetailPane({
  task,
  currentUser,
  onClose,
  onUpdateTask,
  socket,
  width,
  onWidthChange,
  narrow = false,
  // True when a flex wrapper owns the side region's grid cell (AppShell's
  // side dock) rather than this pane claiming it directly.
  docked = false,
  // eslint-disable-next-line no-unused-vars
  activeAgents,
  // eslint-disable-next-line no-unused-vars
  onStartAgent,
  // eslint-disable-next-line no-unused-vars
  onStopAgent,
  // eslint-disable-next-line no-unused-vars
  agentsEnabled,
  // eslint-disable-next-line no-unused-vars
  canRunAgents,
  // eslint-disable-next-line no-unused-vars
  aiChatEnabled,
}) {
  // Lazy initial state from localStorage so navigating between tasks
  // preserves the user's tab choice. The previous reset-on-task-id
  // effect was annoying for cross-task workflows (Shell-mode review,
  // Comments audit, etc.). Persistence is global, not per-task —
  // matches the "I'm in Shell-mode right now" mental model and avoids
  // cluttering localStorage with one entry per task ever viewed.
  const [activeTab, setActiveTabState] = useState(loadInitialActiveTab)
  const setActiveTab = (next) => {
    setActiveTabState(next)
    try { window.localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, next) } catch { /* storage disabled */ }
  }
  const [handleHover, setHandleHover] = useState(false)

  // Drag the left edge to resize. Listeners are created per-drag as closures over
  // the start point/width and removed by their own identity on mouseup — this
  // avoids the stale-closure + listener-leak bug of recreated handlers. The pane
  // grows when dragged left (toward the focal zone). Clamping + persistence are
  // owned by the parent (AppShell.setDetailWidthClamped) so the bounds and the
  // saved value can never drift apart.
  const handleDragStart = (e) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = width
    const onMove = (ev) => onWidthChange?.(startWidth + (startX - ev.clientX))
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }
  // Double-click resets to the default width. Reporting 0 lets the parent clamp
  // up to MIN_WIDTH (= the default), so DetailPane needn't know the constant.
  const handleResetWidth = () => onWidthChange?.(0)

  const morphTransition = useMotionTransition({ duration: MOTION_DURATIONS.morph, ease: [0.2, 0.8, 0.2, 1] })
  const tabTransition = useMotionTransition({ duration: MOTION_DURATIONS.tabFade, ease: 'easeOut' })

  if (!task) return null

  const asideStyle = narrow
    ? {
        // Narrow-viewport mode: full-screen overlay.
        position: 'fixed',
        inset: 0,
        zIndex: 40,
        background: 'var(--bg-card)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }
    : {
        // Inside the side dock a flex wrapper owns the grid cell, so fill it
        // as a flex child. Standalone, claim the grid area directly.
        ...(docked
          ? { flex: 1, minHeight: 0 }
          : { gridArea: 'detail' }),
        borderLeft: 'var(--border-hairline)',
        background: 'var(--bg-card)',
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        overflow: 'hidden',
        position: 'relative',
      }

  // Slide direction matches presentation: overlay slides from the right on mobile too.
  return (
    <motion.aside
      data-testid="detail-pane"
      initial={{ opacity: 0, x: narrow ? '100%' : 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: narrow ? '100%' : 24 }}
      transition={morphTransition}
      style={asideStyle}
    >
      {/* Drag handle — hidden on narrow viewports (no side-by-side layout to
          resize). 8px grab area with a hairline that brightens on hover/drag so
          the affordance is discoverable; double-click resets to default width. */}
      {!narrow && (
        <div
          data-testid="detail-resize-handle"
          onMouseDown={handleDragStart}
          onDoubleClick={handleResetWidth}
          onMouseEnter={() => setHandleHover(true)}
          onMouseLeave={() => setHandleHover(false)}
          title="Drag to resize · double-click to reset"
          aria-label="Resize detail pane"
          role="separator"
          aria-orientation="vertical"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: '8px',
            cursor: 'col-resize',
            zIndex: 2,
            touchAction: 'none',
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: '2px',
              background: handleHover ? 'var(--accent-app)' : 'transparent',
              transition: 'background var(--duration-fast) var(--ease-default)',
            }}
          />
        </div>
      )}

      {/* Header: id + title + close */}
      <header
        className="flex items-center justify-between shrink-0"
        style={{
          height: '48px',
          padding: '0 var(--space-3)',
          borderBottom: 'var(--border-hairline)',
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="truncate"
            style={{ fontSize: 'var(--text-caption2)', fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)' }}
          >
            {task.id}
          </span>
          <span
            className="truncate"
            style={{ fontSize: 'var(--text-footnote)', fontWeight: 'var(--font-semibold)', color: 'var(--text-app)' }}
          >
            {task.title}
          </span>
        </div>
        <IconButton size="sm" onClick={onClose} aria-label="Close detail" title="Close (Esc)">
          <X className="w-4 h-4" />
        </IconButton>
      </header>

      {/* Tab bar */}
      <nav
        className="shrink-0 flex items-center"
        style={{
          gap: 'var(--space-1)',
          padding: '0 var(--space-2)',
          borderBottom: 'var(--border-hairline)',
        }}
        role="tablist"
      >
        {TABS.map(({ id, label, icon: Icon }) => {
          const isActive = activeTab === id
          return (
            <button
              key={id}
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(id)}
              className="apple-press relative flex items-center"
              style={{
                gap: 'var(--space-1)',
                padding: 'var(--space-2) var(--space-2)',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                borderBottom: `2px solid ${isActive ? 'var(--accent-app)' : 'transparent'}`,
                color: isActive ? 'var(--text-app)' : 'var(--text-muted)',
                fontSize: 'var(--text-caption1)',
                fontWeight: isActive ? 'var(--font-semibold)' : 'var(--font-medium)',
                marginBottom: '-1px', // overlap the border-bottom below
              }}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          )
        })}
      </nav>

      {/* Tab content — AnimatePresence crossfades between panels */}
      <div
        className="flex-1 overflow-y-auto custom-scrollbar min-h-0 relative"
        style={{ padding: 'var(--space-4)' }}
        role="tabpanel"
      >
        {/* Always-mounted shell pane (`feat-shell-background-sessions-001`
            Phase 3). ShellManager keeps every opened task's xterm alive,
            even when the user switches between tasks OR between the Shell
            tab and other tabs. Visibility is toggled by activeTab; the
            children stay mounted across both axes so the underlying PTYs
            and their claude conversations survive navigation. xterm needs
            an explicit height ancestor before .open() runs, which the
            inset:var(--space-4) wrapper provides; the bottom 56px is
            reserved for the floating CommandCard pill so claude's status
            row doesn't visually overlap. */}
        <div
          style={{
            position: 'absolute',
            inset: 'var(--space-4)',
            display: activeTab === 'shell' ? 'block' : 'none',
          }}
          aria-hidden={activeTab !== 'shell'}
        >
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 56 }}>
            <ShellManager activeTask={task} socket={socket} />
          </div>
          {/* CommandCard still keys on task.id — its state (popover open,
              copy flash) is per-task and resetting on task switch is the
              right behavior. */}
          <CommandCard key={task.id} task={task} />
          {/* AutoEnterToggle: floating pill at bottom-right that watches
              webshell:output for permission prompts and auto-fires Enter
              on the active shell. Per-task armed state lives in
              localStorage. */}
          <AutoEnterToggle key={`autoenter-${task.id}`} task={task} socket={socket} />
        </div>

        {activeTab !== 'shell' && (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={activeTab}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={tabTransition}
            >
              {activeTab === 'description' && (
                <>
                  {/* Status row — segmented-pill control for changing
                      task.status. Lives at the top of the Description
                      tab. For tasks in waiting_input, render a non-
                      clickable badge instead — that status is set by
                      atrium_create_approval and shouldn't be a target
                      of manual transitions. */}
                  <div
                    className="flex items-center justify-center"
                    style={{
                      marginBottom: 'var(--space-3)',
                      minWidth: 0,
                    }}
                  >
                    {task.status === 'waiting_input' ? (
                      <span
                        style={{
                          padding: '4px 10px',
                          borderRadius: 'var(--radius-sm)',
                          background: 'var(--bg-secondary)',
                          color: 'var(--apple-yellow)',
                          fontSize: 'var(--text-caption2)',
                          fontWeight: 'var(--font-semibold)',
                          fontFamily: 'var(--font-mono)',
                        }}
                        title="Waiting for an approval response — see /api/approvals"
                      >
                        WAITING_INPUT
                      </span>
                    ) : (
                      <StatusSegmentedControl
                        activeStatus={task.status}
                        onChange={(nextStatus) => {
                          // onUpdateTask signature is (taskId, fieldsDiff)
                          // — matches DetailDescription / DetailComments.
                          onUpdateTask?.(task.id, { status: nextStatus })
                        }}
                      />
                    )}
                  </div>
                  <DetailDescription task={task} onUpdateTask={onUpdateTask} />
                </>
              )}
              {activeTab === 'comments' && (
                <DetailComments task={task} currentUser={currentUser} onUpdateTask={onUpdateTask} />
              )}
              {activeTab === 'activity' && (
                <DetailActivity task={task} />
              )}
              {activeTab === 'changes' && (
                <DetailChanges task={task} />
              )}
              {activeTab === 'tests' && (
                <TestsTab task={task} />
              )}
            </motion.div>
          </AnimatePresence>
        )}
      </div>
    </motion.aside>
  )
}
