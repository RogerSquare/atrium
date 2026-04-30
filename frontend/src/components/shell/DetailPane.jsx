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

import { useRef, useState } from 'react'
import { X, FileText, MessageSquare, Activity, Terminal, GitCommit } from 'lucide-react'
import { IconButton } from '../ui'
import DetailDescription from '../detail/DetailDescription'
import DetailComments from '../detail/DetailComments'
import DetailActivity from '../detail/DetailActivity'
import DetailChanges from '../detail/DetailChanges'
import ShellTerminal from '../web-shell/Terminal'
import CommandCard from '../web-shell/CommandCard'
import StatusSegmentedControl from '../StatusSegmentedControl'
import { motion, AnimatePresence, useMotionTransition, MOTION_DURATIONS } from '../../lib/motion'

const TABS = [
  { id: 'description', label: 'Description', icon: FileText },
  { id: 'comments', label: 'Comments', icon: MessageSquare },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'changes', label: 'Changes', icon: GitCommit },
  { id: 'shell', label: 'Shell', icon: Terminal },
]

const WIDTH_STORAGE_KEY = 'taskBoardDetailWidth'
const ACTIVE_TAB_STORAGE_KEY = 'taskBoardDetailActiveTab'
const MIN_WIDTH = 380
const MAX_WIDTH = 720

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
  const dragStartX = useRef(null)
  const dragStartWidth = useRef(null)

  const handleDragStart = (e) => {
    dragStartX.current = e.clientX
    dragStartWidth.current = width
    window.addEventListener('mousemove', handleDragMove)
    window.addEventListener('mouseup', handleDragEnd)
  }
  const handleDragMove = (e) => {
    if (dragStartX.current == null) return
    const delta = dragStartX.current - e.clientX
    const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, dragStartWidth.current + delta))
    onWidthChange?.(next)
  }
  const handleDragEnd = () => {
    dragStartX.current = null
    dragStartWidth.current = null
    window.removeEventListener('mousemove', handleDragMove)
    window.removeEventListener('mouseup', handleDragEnd)
    // Persist current width
    try { localStorage.setItem(WIDTH_STORAGE_KEY, String(width)) } catch {}
  }

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
        gridArea: 'detail',
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
      initial={{ opacity: 0, x: narrow ? '100%' : 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: narrow ? '100%' : 24 }}
      transition={morphTransition}
      style={asideStyle}
    >
      {/* Drag handle — hidden on narrow viewports (no side-by-side layout to resize). */}
      {!narrow && (
        <div
          onMouseDown={handleDragStart}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: '4px',
            cursor: 'col-resize',
            zIndex: 1,
          }}
          aria-label="Resize detail pane"
          role="separator"
        />
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

      {/* Status row — segmented-pill control for changing task.status.
          Always visible (regardless of active tab). Centered horizontally
          so the pill sits balanced under the header. For tasks in
          waiting_input, render a non-clickable badge instead — that
          status is set by atrium_create_approval and shouldn't be a
          target of manual transitions. */}
      <div
        className="shrink-0 flex items-center justify-center"
        style={{
          padding: 'var(--space-2) var(--space-3)',
          borderBottom: 'var(--border-hairline)',
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
              // onUpdateTask signature is (taskId, fieldsDiff) —
              // matches DetailDescription / DetailComments. Passing
              // the full task object as the first arg silently fails.
              onUpdateTask?.(task.id, { status: nextStatus })
            }}
          />
        )}
      </div>

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
        {activeTab === 'shell' ? (
          // Shell tab bypasses AnimatePresence: xterm needs an explicit
          // height ancestor before .open() runs, and the framer-motion
          // wrapper used by other tabs has no defined height.
          //
          // Layout: single positioned container. ShellTerminal fills
          // the upper area; the bottom 56px is reserved exclusively
          // for the floating CommandCard pill so claude code's
          // bottom-of-screen status text (the `❯` prompt) doesn't
          // visually overlap with the button. The pill itself
          // anchors to the OUTER wrapper (still 100% size), so the
          // expanded popover can grow up + right over the terminal
          // when opened — only the *button row* gets reserved.
          <div style={{ position: 'absolute', inset: 'var(--space-4)' }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 56 }}>
              {/* key on task.id remounts the terminal when the user
                  navigates to a different task — resets the recovery
                  overlay's exitInfo state alongside the live PTY. */}
              <ShellTerminal key={task.id} task={task} socket={socket} />
            </div>
            {/* key on task.id remounts the card when the user
                navigates to a different task — resets isOpen +
                copiedId without a setState-in-effect. */}
            <CommandCard key={task.id} task={task} />
          </div>
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={activeTab}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={tabTransition}
            >
              {activeTab === 'description' && (
                <DetailDescription task={task} onUpdateTask={onUpdateTask} />
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
            </motion.div>
          </AnimatePresence>
        )}
      </div>
    </motion.aside>
  )
}
