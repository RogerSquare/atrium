// AutoEnterToggle — floating pill button anchored to the bottom-right of the
// Shell-tab content area. Mirrors CommandCard's positioning so the two pills
// flank the bottom edge of the terminal panel without overlapping.
//
// Behavior:
//   - Subscribes to webshell:output for THIS task's wireTaskId, maintains a
//     rolling tail buffer (~512 bytes) of recent stdout, and scans the last
//     200 chars (post ANSI-strip) against PROMPT_PATTERNS.
//   - When armed and a pattern matches, emits webshell:input with `\r` so the
//     shell sees an Enter keystroke. Buffer is cleared after firing and a
//     short cooldown blocks re-fire on the same prompt's lingering bytes —
//     once new (non-prompt) output rebuilds the buffer, the toggle is ready
//     to fire on the NEXT prompt.
//   - Armed state persists per-task in localStorage (`autoenter:armed:<id>`),
//     matching the same per-task storage convention used by ShellTerminal's
//     `webshell:session:<id>` and Atrium's other task-scoped flags.
//
// v1 scope (chosen as the "standard" path when the task's approval question
// went unanswered): hard-coded pattern list, per-task persisted toggle, no
// settings-UI customization, no destructive-prompt safety carve-out. Add
// follow-up tasks if any of those become necessary.

import { useCallback, useEffect, useRef, useState } from 'react'
import { CornerDownLeft } from 'lucide-react'
import { tailMatchesPrompt } from './autoEnterPatterns'

const STORAGE_PREFIX = 'autoenter:armed:'
const BUFFER_LIMIT = 512
const COOLDOWN_MS = 600
// Same sentinel ShellTerminal uses for the global shell modal — passes
// taskId:null on the wire so we don't mis-target task-scoped events.
const GLOBAL_TASK_ID = '__global__'

function computeWireTaskId(task) {
  if (!task) return null
  if (task.id === GLOBAL_TASK_ID) return null
  return task.id || null
}

function readArmed(taskId) {
  if (!taskId) return false
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + taskId) === '1'
  } catch {
    return false
  }
}
function writeArmed(taskId, value) {
  if (!taskId) return
  try {
    window.localStorage.setItem(STORAGE_PREFIX + taskId, value ? '1' : '0')
  } catch {
    /* storage full or disabled */
  }
}

export default function AutoEnterToggle({ task, socket }) {
  const wireTaskId = computeWireTaskId(task)
  const [armed, setArmed] = useState(() => readArmed(task?.id))
  const armedRef = useRef(armed)
  useEffect(() => {
    armedRef.current = armed
  }, [armed])

  const bufferRef = useRef('')
  const cooldownUntilRef = useRef(0)

  useEffect(() => {
    writeArmed(task?.id, armed)
  }, [task?.id, armed])

  useEffect(() => {
    if (!socket) return undefined

    const handleOutput = (payload) => {
      if (!payload || payload.taskId !== wireTaskId) return
      if (typeof payload.data !== 'string') return

      bufferRef.current = (bufferRef.current + payload.data).slice(-BUFFER_LIMIT)

      if (!armedRef.current) return
      const now = Date.now()
      if (now < cooldownUntilRef.current) return

      if (tailMatchesPrompt(bufferRef.current)) {
        if (socket.connected) {
          socket.emit('webshell:input', { taskId: wireTaskId, data: '\r' })
        }
        cooldownUntilRef.current = now + COOLDOWN_MS
        bufferRef.current = ''
      }
    }

    socket.on('webshell:output', handleOutput)
    return () => {
      socket.off('webshell:output', handleOutput)
    }
  }, [socket, wireTaskId])

  const handleToggle = useCallback(() => {
    setArmed((prev) => {
      const next = !prev
      if (next) {
        bufferRef.current = ''
        cooldownUntilRef.current = 0
      }
      return next
    })
  }, [])

  if (!task) return null

  return (
    <button
      type="button"
      onClick={handleToggle}
      aria-pressed={armed}
      aria-label="Auto-press Enter on permission prompts"
      title={
        armed
          ? 'Auto-Enter armed — Enter will fire on permission prompts. Click to disarm.'
          : 'Auto-press Enter on permission prompts (disarmed)'
      }
      className="apple-press"
      style={{
        position: 'absolute',
        bottom: 'var(--space-3)',
        right: 'var(--space-3)',
        zIndex: 10,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 12px',
        borderRadius: 'var(--radius-full)',
        border: armed ? '1px solid transparent' : 'var(--border-hairline)',
        background: armed ? 'var(--accent-app)' : 'var(--bg-card)',
        color: armed ? 'var(--accent-on-app)' : 'var(--text-tertiary)',
        fontSize: 'var(--text-caption2)',
        fontFamily: 'var(--font-mono)',
        cursor: 'pointer',
        boxShadow: 'var(--shadow-popover)',
      }}
    >
      <CornerDownLeft
        className="w-3.5 h-3.5"
        style={{ flexShrink: 0 }}
      />
      <span style={{ whiteSpace: 'nowrap' }}>auto-enter</span>
    </button>
  )
}
