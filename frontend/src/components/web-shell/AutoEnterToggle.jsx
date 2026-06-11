// AutoEnterToggle — floating pill anchored to the bottom-right of the
// Shell-tab content area. Mirrors CommandCard's positioning so the two
// pills flank the bottom edge of the terminal panel without overlapping.
//
// Behavior:
//   - Subscribes to webshell:output for THIS task's wireTaskId, maintains a
//     rolling tail buffer (~512 bytes) of recent stdout, and scans the last
//     200 chars (post ANSI-strip) against PROMPT_PATTERNS.
//   - When armed and a pattern matches, emits webshell:input with `\r` so
//     the shell sees an Enter keystroke. Buffer is cleared after firing
//     and a 600ms cooldown blocks re-fire on the same prompt's lingering
//     bytes — once new output rebuilds the buffer, the toggle is ready
//     to fire on the NEXT prompt.
//   - Armed state persists per-task in localStorage (`autoenter:armed:<id>`).
//
// Capture loop (feat-autoenter-unknown-capture-001): when armed AND
// output has been quiet for 1000ms AND the buffer doesn't match any
// known class (allowlist / denylist / input-field), record a snapshot
// to localStorage so the user can review undocumented prompts and
// extend the pattern set. Surfaces unread captures via a `?` badge
// next to the pill; click opens a small review panel.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CornerDownLeft, Copy, HelpCircle, X } from 'lucide-react'
import { classifyTail, tailMatchesPrompt, DENY_PATTERNS } from './autoEnterPatterns'
import { API_URL, apiFetch } from '../../config'

const STORAGE_PREFIX = 'autoenter:armed:'
const STORAGE_PREFIX_CAPTURES = 'autoenter:captures:'
const BUFFER_LIMIT = 512
const COOLDOWN_MS = 600
const STALL_MS = 1000
const CAPTURE_LIMIT = 20
const CAPTURE_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
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

function readCaptures(taskId) {
  if (!taskId) return []
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX_CAPTURES + taskId)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
  } catch {
    return []
  }
}
function writeCaptures(taskId, captures) {
  if (!taskId) return
  try {
    window.localStorage.setItem(
      STORAGE_PREFIX_CAPTURES + taskId,
      JSON.stringify(captures),
    )
  } catch {
    /* storage full or disabled */
  }
}
function pruneCaptures(captures) {
  const now = Date.now()
  return captures
    .filter((c) => c && typeof c.capturedAt === 'number' && now - c.capturedAt < CAPTURE_TTL_MS)
    .slice(-CAPTURE_LIMIT)
}

async function copyToClipboard(text) {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

function formatTimestamp(ms) {
  try {
    const d = new Date(ms)
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return ''
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
  const stallTimerRef = useRef(null)

  // Captures live in two layers: a ref so the inactivity classifier
  // doesn't have to read localStorage on every fire (cheap path) and
  // React state so the badge re-renders when the unread count changes.
  const initialCaptures = useMemo(() => pruneCaptures(readCaptures(task?.id)), [task?.id])
  const [captures, setCaptures] = useState(initialCaptures)
  const capturesRef = useRef(initialCaptures)
  useEffect(() => {
    capturesRef.current = captures
  }, [captures])

  const [panelOpen, setPanelOpen] = useState(false)

  useEffect(() => {
    writeArmed(task?.id, armed)
  }, [task?.id, armed])

  const recordCapture = useCallback((bufferTail) => {
    if (!task?.id) return
    const capturedAt = Date.now()
    const next = pruneCaptures([
      ...capturesRef.current,
      {
        capturedAt,
        bufferTail,
        classification: 'unknown',
        read: false,
      },
    ])
    capturesRef.current = next
    writeCaptures(task.id, next)
    setCaptures(next)
    // Fire-and-forget: persist the miss to the backend so the prompts the
    // detector fails to recognize become analyzable across sessions
    // (bug-autoenter-ansi-cursor-strip-001). localStorage above stays the
    // source of truth for the in-UI review panel; this POST is best-effort
    // and must never break the capture loop if the network/auth is down.
    try {
      apiFetch(`${API_URL}/autoenter/captures`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bufferTail,
          taskId: task.id,
          classification: 'unknown',
          capturedAt,
        }),
      }).catch(() => {})
    } catch {
      /* never let logging break capture */
    }
  }, [task?.id])

  useEffect(() => {
    if (!socket) return undefined

    const clearStallTimer = () => {
      if (stallTimerRef.current) {
        clearTimeout(stallTimerRef.current)
        stallTimerRef.current = null
      }
    }

    const armStallTimer = () => {
      clearStallTimer()
      // Only run the classifier when the toggle is armed — disarmed
      // means the user opted out of any auto behavior, including
      // capturing.
      if (!armedRef.current) return
      stallTimerRef.current = setTimeout(() => {
        stallTimerRef.current = null
        const klass = classifyTail(bufferRef.current)
        // Only 'unknown' is interesting. 'fire' is handled by the main
        // listener below, 'denied' is the deliberate skip path, and
        // 'input-field' means the shell is just idle.
        if (klass === 'unknown' && bufferRef.current.length > 0) {
          recordCapture(bufferRef.current.slice(-200))
        }
      }, STALL_MS)
    }

    const handleOutput = (payload) => {
      if (!payload || payload.taskId !== wireTaskId) return
      if (typeof payload.data !== 'string') return

      bufferRef.current = (bufferRef.current + payload.data).slice(-BUFFER_LIMIT)

      // Reset stall timer on every chunk — we're only interested in
      // post-quiet-period classification, not chunk-by-chunk noise.
      armStallTimer()

      if (!armedRef.current) return
      const now = Date.now()
      if (now < cooldownUntilRef.current) return

      if (tailMatchesPrompt(bufferRef.current)) {
        if (socket.connected) {
          socket.emit('webshell:input', { taskId: wireTaskId, data: '\r' })
        }
        cooldownUntilRef.current = now + COOLDOWN_MS
        bufferRef.current = ''
        clearStallTimer()
      }
    }

    // Hook-driven path (feat-autoenter-hook-signal-001): the backend emits
    // `webshell:prompt` when a Claude Code Notification(permission_prompt)
    // hook fires — an authoritative "a permission prompt is on screen now"
    // signal that doesn't depend on scraping/ANSI-stripping PTY output. This
    // is the primary trigger; the regex path above stays as a fallback. Both
    // share `cooldownUntilRef`, so whichever fires first wins and the other
    // is suppressed for COOLDOWN_MS — no double-Enter on the same prompt.
    const handlePrompt = (payload) => {
      if (!payload || payload.taskId !== wireTaskId) return
      if (!armedRef.current) return
      const now = Date.now()
      if (now < cooldownUntilRef.current) return
      // Deny intents (destructive ops, plan-mode gates, "are you sure")
      // must never auto-fire — surface them for a human glance. The hook
      // hands us a clean message string, so reuse the same denylist the
      // regex classifier uses instead of re-deriving it.
      const message = typeof payload.message === 'string' ? payload.message : ''
      if (DENY_PATTERNS.some((re) => re.test(message))) return
      if (socket.connected) {
        socket.emit('webshell:input', { taskId: wireTaskId, data: '\r' })
      }
      cooldownUntilRef.current = now + COOLDOWN_MS
      bufferRef.current = ''
      clearStallTimer()
    }

    socket.on('webshell:output', handleOutput)
    socket.on('webshell:prompt', handlePrompt)
    return () => {
      socket.off('webshell:output', handleOutput)
      socket.off('webshell:prompt', handlePrompt)
      clearStallTimer()
    }
  }, [socket, wireTaskId, recordCapture])

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

  const handleDismissAll = useCallback(() => {
    if (!task?.id) return
    const marked = capturesRef.current.map((c) => ({ ...c, read: true }))
    capturesRef.current = marked
    writeCaptures(task.id, marked)
    setCaptures(marked)
  }, [task?.id])

  const handleClearAll = useCallback(() => {
    if (!task?.id) return
    capturesRef.current = []
    writeCaptures(task.id, [])
    setCaptures([])
    setPanelOpen(false)
  }, [task?.id])

  const unreadCount = useMemo(
    () => captures.filter((c) => !c.read).length,
    [captures],
  )

  if (!task) return null

  return (
    <>
      <div
        style={{
          position: 'absolute',
          bottom: 'var(--space-3)',
          right: 'var(--space-3)',
          zIndex: 10,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        {captures.length > 0 ? (
          <button
            type="button"
            onClick={() => setPanelOpen(true)}
            aria-label={`${unreadCount} unrecognized prompt capture${unreadCount === 1 ? '' : 's'}`}
            title={
              unreadCount > 0
                ? `${unreadCount} unread capture${unreadCount === 1 ? '' : 's'} — click to review`
                : `${captures.length} capture${captures.length === 1 ? '' : 's'} — click to review`
            }
            className="apple-press"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '6px 10px',
              borderRadius: 'var(--radius-full)',
              border: 'var(--border-hairline)',
              background: unreadCount > 0 ? 'var(--accent-warning, #d97706)' : 'var(--bg-card)',
              color: unreadCount > 0 ? '#fff' : 'var(--text-tertiary)',
              fontSize: 'var(--text-caption2)',
              fontFamily: 'var(--font-mono)',
              cursor: 'pointer',
              boxShadow: 'var(--shadow-popover)',
            }}
          >
            <HelpCircle className="w-3.5 h-3.5" style={{ flexShrink: 0 }} />
            <span style={{ whiteSpace: 'nowrap' }}>
              {unreadCount > 0 ? unreadCount : captures.length}
            </span>
          </button>
        ) : null}
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
          <CornerDownLeft className="w-3.5 h-3.5" style={{ flexShrink: 0 }} />
          <span style={{ whiteSpace: 'nowrap' }}>auto-enter</span>
        </button>
      </div>

      {panelOpen ? (
        <CapturePanel
          captures={captures}
          onClose={() => {
            setPanelOpen(false)
            handleDismissAll()
          }}
          onClearAll={handleClearAll}
        />
      ) : null}
    </>
  )
}

function CapturePanel({ captures, onClose, onClearAll }) {
  const [copiedIdx, setCopiedIdx] = useState(null)
  // Newest captures first — the user is most likely to want to act on
  // the most recent unrecognized prompt.
  const sorted = useMemo(
    () => [...captures].sort((a, b) => b.capturedAt - a.capturedAt),
    [captures],
  )
  const handleCopy = useCallback(async (idx, text) => {
    const ok = await copyToClipboard(text)
    if (ok) {
      setCopiedIdx(idx)
      setTimeout(() => setCopiedIdx(null), 800)
    }
  }, [])

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Unrecognized prompt captures"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 11,
        background: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'flex-end',
        padding: 'var(--space-4)',
      }}
    >
      <div
        style={{
          width: 'min(420px, 100%)',
          maxHeight: 'calc(100% - var(--space-4))',
          background: 'var(--bg-card)',
          border: 'var(--border-hairline)',
          borderRadius: 'var(--radius-md)',
          boxShadow: 'var(--shadow-popover)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <header
          style={{
            padding: 'var(--space-2) var(--space-3)',
            borderBottom: 'var(--border-hairline)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--space-2)',
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: 'var(--text-callout)',
              fontWeight: 'var(--font-semibold)',
              color: 'var(--text-app)',
            }}
          >
            Unrecognized prompts ({captures.length})
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close (Esc)"
            className="apple-press"
            style={{
              width: 24,
              height: 24,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: 'none',
              background: 'transparent',
              color: 'var(--text-tertiary)',
              cursor: 'pointer',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </header>

        <ul
          className="custom-scrollbar"
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            margin: 0,
            padding: 'var(--space-2)',
            listStyle: 'none',
          }}
        >
          {sorted.length === 0 ? (
            <li
              style={{
                padding: 'var(--space-3)',
                color: 'var(--text-tertiary)',
                fontSize: 'var(--text-caption2)',
                textAlign: 'center',
              }}
            >
              No captures yet.
            </li>
          ) : null}
          {sorted.map((c, idx) => (
            <li
              key={c.capturedAt + ':' + idx}
              style={{
                padding: 'var(--space-2)',
                borderBottom: idx < sorted.length - 1 ? 'var(--border-hairline)' : 'none',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 'var(--space-2)',
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-caption2)',
                    color: c.read ? 'var(--text-tertiary)' : 'var(--text-app)',
                    fontWeight: c.read ? 'var(--font-regular)' : 'var(--font-semibold)',
                  }}
                >
                  {formatTimestamp(c.capturedAt)}
                  {c.read ? '' : ' • new'}
                </span>
                <button
                  type="button"
                  onClick={() => handleCopy(idx, c.bufferTail)}
                  aria-label="Copy capture text"
                  title="Copy"
                  className="apple-press"
                  style={{
                    padding: '2px 6px',
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--text-tertiary)',
                    cursor: 'pointer',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: 'var(--text-caption2)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <Copy className="w-3 h-3" />
                  {copiedIdx === idx ? 'copied' : 'copy'}
                </button>
              </div>
              <pre
                style={{
                  margin: 0,
                  padding: 'var(--space-2)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--text-caption2)',
                  color: 'var(--text-app)',
                  background: 'var(--fill-secondary)',
                  borderRadius: 'var(--radius-sm)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  maxHeight: 120,
                  overflow: 'auto',
                }}
              >
                {c.bufferTail}
              </pre>
            </li>
          ))}
        </ul>

        {captures.length > 0 ? (
          <footer
            style={{
              padding: 'var(--space-2) var(--space-3)',
              borderTop: 'var(--border-hairline)',
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 'var(--space-2)',
              flexShrink: 0,
            }}
          >
            <button
              type="button"
              onClick={onClearAll}
              className="apple-press"
              style={{
                padding: '4px 10px',
                border: 'var(--border-hairline)',
                borderRadius: 'var(--radius-sm)',
                background: 'transparent',
                color: 'var(--text-tertiary)',
                fontSize: 'var(--text-caption2)',
                cursor: 'pointer',
              }}
            >
              Clear all
            </button>
          </footer>
        ) : null}
      </div>
    </div>
  )
}
