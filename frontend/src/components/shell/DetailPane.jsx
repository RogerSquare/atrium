// Facelift DetailPane — Phase 3.
//
// Right-side master-detail pane. Replaces TaskModal as the default
// presentation for a selected task (TaskModal stays as Cmd+Shift+Enter
// focus mode — see AppShell).
//
// 5 tabs: Description / Comments / Activity / AI / Agent Log.
// Close: X button or Escape key (escape handled in AppShell for global reach).
// Resize: drag handle on the left edge persists to localStorage.

import { useEffect, useRef, useState } from 'react'
import { X, FileText, MessageSquare, Activity, Sparkles, Terminal } from 'lucide-react'
import { IconButton } from '../ui'
import DetailDescription from '../detail/DetailDescription'
import DetailComments from '../detail/DetailComments'
import DetailActivity from '../detail/DetailActivity'
import DetailAI from '../detail/DetailAI'
import DetailAgentLog from '../detail/DetailAgentLog'
import { motion, AnimatePresence, useMotionTransition, MOTION_DURATIONS } from '../../lib/motion'

const TABS = [
  { id: 'description', label: 'Description', icon: FileText },
  { id: 'comments', label: 'Comments', icon: MessageSquare },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'ai', label: 'AI', icon: Sparkles },
  { id: 'agent', label: 'Agent Log', icon: Terminal },
]

const WIDTH_STORAGE_KEY = 'taskBoardDetailWidth'
const MIN_WIDTH = 380
const MAX_WIDTH = 720

export default function DetailPane({
  task,
  currentUser,
  onClose,
  onUpdateTask,
  activeAgents,
  onStartAgent,
  onStopAgent,
  socket,
  agentsEnabled,
  canRunAgents,
  aiChatEnabled,
  width,
  onWidthChange,
}) {
  const [activeTab, setActiveTab] = useState('description')
  const dragStartX = useRef(null)
  const dragStartWidth = useRef(null)

  // Reset to Description tab whenever task changes
  useEffect(() => { setActiveTab('description') }, [task?.id])

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

  const agentRunning = activeAgents?.some((a) => a.taskId === task.id)

  return (
    <motion.aside
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 24 }}
      transition={morphTransition}
      style={{
        gridArea: 'detail',
        borderLeft: 'var(--border-hairline)',
        background: 'var(--bg-card)',
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* Drag handle — left edge, 4px wide */}
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
          const showAgentDot = id === 'ai' && agentRunning
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
              {showAgentDot && (
                <span
                  style={{
                    position: 'absolute',
                    top: '4px',
                    right: '0',
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    background: 'var(--apple-green)',
                    boxShadow: '0 0 6px var(--apple-green)',
                  }}
                  className="animate-gentle-pulse"
                />
              )}
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
            {activeTab === 'ai' && (
              <DetailAI task={task} currentUser={currentUser} aiChatEnabled={aiChatEnabled} />
            )}
            {activeTab === 'agent' && (
              <DetailAgentLog
                task={task}
                socket={socket}
                agentRunning={agentRunning}
                onStartAgent={onStartAgent}
                onStopAgent={onStopAgent}
                currentUser={currentUser}
                agentsEnabled={agentsEnabled}
                canRunAgents={canRunAgents}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.aside>
  )
}
