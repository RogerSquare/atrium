// Embedded shell terminal for the DetailPane Shell tab.
//
// Lifted from Documents/opencode/web-shell/src/App.jsx (the standalone)
// with three adaptations for the in-atrium use case:
//   1. Accepts `task` and `socket` props instead of opening its own
//      io('/') connection — atrium owns the socket lifecycle, this
//      component just subscribes to webshell:* events on it.
//   2. Drops the standalone's full-viewport `.terminal-host` flex
//      wrapper — DetailPane provides layout (padding + min-height: 0
//      flex container).
//   3. The mount effect keys on `task?.id` so navigating to a
//      different task tears down the current shell and starts a fresh
//      one in the new task's context. Matches DetailPane's existing
//      "reset to Description tab on task change" pattern.
//
// Wire format (matches backend/sockets/web-shell.js):
//   client → server   webshell:start  { cols?, rows?, command? }
//                     webshell:input  <bytes>
//                     webshell:resize { cols, rows }
//   server → client   webshell:output <bytes>
//                     webshell:exit   { exitCode }
//
// Default startup command is `claude` so the page boots straight into
// Claude Code on a clean canvas. The cwd is resolved server-side from
// settings.workingDirectory (no per-task folder mapping today).

import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'

const TERMINAL_THEME = {
  background: '#1e1e1e',
  foreground: '#d4d4d4',
  cursor: '#ffffff',
  selectionBackground: 'rgba(255, 255, 255, 0.3)',
}

// Per-task session id binding. Each task has a stable UUID stored in
// localStorage; the initial spawn passes it to the server as
// `sessionId` along with `tryResume: true`. The backend
// (web-shell.js) checks whether the session file is actually on disk
// at ~/.claude/projects/<cwd-slug>/<uuid>.jsonl and picks the right
// claude flag:
//   - file exists → `claude --resume <uuid>`   (revive conversation)
//   - file absent → `claude --session-id <uuid>` (create at this id)
// This avoids the "No conversation found with session ID: <uuid>"
// error loop when Resume targeted a never-saved session (e.g., user
// typed /exit before sending any messages).
//
// "Start new session" rotates to a fresh uuid AND sends
// `tryResume: false`, so the server always creates fresh.
const SESSION_ID_KEY_PREFIX = 'webshell:session:'

function readSessionId(taskId) {
  if (!taskId) return null
  try { return window.localStorage.getItem(SESSION_ID_KEY_PREFIX + taskId) } catch { return null }
}
function writeSessionId(taskId, id) {
  if (!taskId) return
  try { window.localStorage.setItem(SESSION_ID_KEY_PREFIX + taskId, id) } catch { /* storage full or disabled */ }
}
function mintUuid() {
  // crypto.randomUUID is available in all browsers atrium targets
  // (modern Chrome/Edge/Firefox). The Math.random fallback is
  // strictly defensive — it only triggers in ancient browsers that
  // would already fail elsewhere in atrium.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}
function getOrMintSessionId(taskId) {
  const existing = readSessionId(taskId)
  if (existing) return existing
  const fresh = mintUuid()
  writeSessionId(taskId, fresh)
  return fresh
}
function rotateSessionId(taskId) {
  const fresh = mintUuid()
  writeSessionId(taskId, fresh)
  return fresh
}

// Verbose tracing for the input/focus chain. Enable by running
// `localStorage.setItem('webshell:debug','1')` in devtools and
// reloading. Disable with `localStorage.removeItem('webshell:debug')`.
// Logs are tagged so they're greppable.
const DEBUG = (() => {
  if (typeof window === 'undefined') return false
  try { return window.localStorage.getItem('webshell:debug') === '1' } catch { return false }
})()
const dlog = DEBUG ? (...args) => console.log('[webshell]', ...args) : () => {}
const dwarn = DEBUG ? (...args) => console.warn('[webshell]', ...args) : () => {}

export default function ShellTerminal({ task, socket }) {
  const wrapperRef = useRef(null)
  const containerRef = useRef(null)
  // xtermRef is read by the wrapper's onMouseDown handler so clicks
  // anywhere in the visible area (including padding / dead-zones in
  // xterm's own canvas) reliably focus the terminal via the public
  // term.focus() API. Querying for `.xterm-helper-textarea` from the
  // DOM was unreliable — depending on which xterm internal layout was
  // active (DOM vs WebGL renderer), the textarea could be reachable,
  // hidden, or moved.
  const xtermRef = useRef(null)

  // exitInfo flips non-null when the server reports webshell:exit and
  // drives the recovery overlay below. Cleared by Resume / New /
  // Dismiss and by Esc while the overlay is showing. Stale overlays
  // from a previous task can't leak in: the parent (DetailPane) keys
  // ShellTerminal on task.id, so navigating remounts the component
  // and this state resets to null.
  const [exitInfo, setExitInfo] = useState(null)

  useEffect(() => {
    if (!containerRef.current || !socket) return

    dlog('mount effect start', {
      taskId: task?.id,
      socketConnected: socket.connected,
      socketId: socket.id,
      containerSize: {
        w: containerRef.current.clientWidth,
        h: containerRef.current.clientHeight,
      },
    })

    const term = new Terminal({
      theme: TERMINAL_THEME,
      // Cascadia Mono is Windows Terminal's default — full block +
      // box-drawing coverage at exact monospace widths, which matters
      // for ASCII art (claude's startup logo, dialog borders).
      fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, "Courier New", monospace',
      fontSize: 13,
      letterSpacing: 0,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
    })

    xtermRef.current = term
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(containerRef.current)
    dlog('term opened', { cols: term.cols, rows: term.rows })

    if (DEBUG) {
      // After term.open(), inspect the helper textarea xterm uses to
      // capture input. If this is missing, hidden, or sized 0×0, that's
      // the smoking gun for "I see the terminal but typing does
      // nothing."
      const ta = containerRef.current.querySelector('.xterm-helper-textarea')
      if (ta) {
        const rect = ta.getBoundingClientRect()
        const cs = window.getComputedStyle(ta)
        dlog('helper textarea found', {
          rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
          display: cs.display,
          visibility: cs.visibility,
          opacity: cs.opacity,
          pointerEvents: cs.pointerEvents,
          tabIndex: ta.tabIndex,
        })
        ta.addEventListener('focus', () => dlog('textarea focus'))
        ta.addEventListener('blur', () => dlog('textarea blur'))
        ta.addEventListener('keydown', (e) =>
          dlog('textarea keydown', { key: e.key, code: e.code, keyCode: e.keyCode })
        )
        ta.addEventListener('input', (e) =>
          dlog('textarea input', { data: e.data, inputType: e.inputType, value: ta.value })
        )
      } else {
        dwarn('helper textarea NOT found after term.open() — input cannot reach xterm')
      }
    }

    // Defensive fit + focus: the parent (motion.div inside tabpanel)
    // can have no explicit height on first mount, which would leave
    // term at 0 cols/0 rows — visible but completely uninteractive.
    // safeFit only runs when the container has real dimensions; we
    // call it here, again on rAF, and again whenever ResizeObserver
    // sees the wrapper change size. Then term.focus() so keystrokes
    // start landing without requiring a click.
    const safeFit = () => {
      const el = containerRef.current
      if (!el) return false
      const { clientWidth, clientHeight } = el
      if (clientWidth < 4 || clientHeight < 4) return false
      try { fitAddon.fit() } catch { /* xterm internals not ready */ }
      return true
    }
    safeFit()
    term.focus()
    dlog('initial focus called', {
      cols: term.cols,
      rows: term.rows,
      activeElement: document.activeElement?.tagName,
      activeElementClass: document.activeElement?.className,
    })

    // WebGL renderer matches Windows Terminal's rendering path —
    // glyph atlas at exact pixel positions, no hairline gaps in
    // block characters. Falls back to DOM if WebGL is unavailable.
    let webglAddon = null
    try {
      webglAddon = new WebglAddon()
      webglAddon.onContextLoss(() => webglAddon?.dispose())
      term.loadAddon(webglAddon)
    } catch {
      /* WebGL unavailable — DOM renderer still works. */
    }

    // Watch the wrapper for size changes — covers the "tabpanel had
    // 0 height on mount, then got real size" race AND the regular
    // case where the user drags the DetailPane edge. We deliberately
    // do NOT call term.focus() here: if a parent re-render or DOM
    // mutation causes ResizeObserver to fire while the user is mid-
    // keystroke, asserting focus tears the textarea away and the
    // partial keystroke gets lost. Initial focus is set once below
    // after term.open(); from then on, xterm's own click handlers
    // and our mousedown handler keep focus where it should be.
    let pendingFit = null
    const resizeObserver = new ResizeObserver(() => {
      if (pendingFit) clearTimeout(pendingFit)
      pendingFit = setTimeout(() => {
        if (!safeFit()) return
        if (socket.connected) {
          socket.emit('webshell:resize', { cols: term.cols, rows: term.rows })
        }
      }, 50)
    })
    if (wrapperRef.current) resizeObserver.observe(wrapperRef.current)

    const handleOutput = (data) => {
      if (DEBUG && data.length > 0) {
        const preview = data.length > 80 ? data.slice(0, 80) + '…' : data
        dlog('webshell:output recv', { bytes: data.length, preview: JSON.stringify(preview) })
      }
      term.write(data)
    }
    const handleExit = ({ exitCode }) => {
      dlog('webshell:exit recv', { exitCode })
      term.write(`\r\n\x1b[33m[shell exited (${exitCode})]\x1b[0m\r\n`)
      // Surface the recovery overlay. We don't auto-restart on any
      // exit code: silent restart on Ctrl+C / crash would mask real
      // failures, and on a clean /exit the user might genuinely want
      // to read the scrollback before deciding.
      setExitInfo({ exitCode })
    }
    const handleDisconnect = (reason) => {
      dlog('socket disconnect', { reason })
      term.write('\r\n\x1b[31m[disconnected]\x1b[0m\r\n')
    }

    socket.on('webshell:output', handleOutput)
    socket.on('webshell:exit', handleExit)
    socket.on('disconnect', handleDisconnect)
    if (DEBUG) {
      socket.on('connect', () => dlog('socket connect'))
      socket.on('reconnect', () => dlog('socket reconnect'))
    }

    const inputDisposable = term.onData((data) => {
      dlog('term.onData fired', { bytes: data.length, data: JSON.stringify(data), socketConnected: socket.connected })
      if (socket.connected) {
        socket.emit('webshell:input', data)
        dlog('webshell:input emitted', { data: JSON.stringify(data) })
      } else {
        dwarn('webshell:input DROPPED — socket not connected', { data: JSON.stringify(data) })
      }
    })

    // Resize: refit the canvas, then notify the server so the PTY's
    // cols/rows match. Debounced so dragging the DetailPane edge
    // doesn't spam the wire.
    let resizeTimer = null
    const handleResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        try { fitAddon.fit() } catch { /* xterm not ready yet */ }
        if (socket.connected) {
          socket.emit('webshell:resize', { cols: term.cols, rows: term.rows })
        }
      }, 100)
    }
    window.addEventListener('resize', handleResize)

    // Defer the actual server-side spawn until after this microtask
    // turn settles. React 18+ StrictMode runs effects twice in dev
    // (setup → cleanup → setup), and a synchronous emit here would
    // cause the server to kill the first PTY when the second mount
    // re-emits webshell:start. Claude's process gets wedged when
    // that happens — the second PTY's claude.exe renders its banner
    // but never reads stdin, so the terminal looks alive but every
    // keystroke is silently dropped.
    //
    // setTimeout(0) defers past StrictMode's intermediate cleanup,
    // which runs synchronously. The first mount's cleanup clears
    // its pending start, so only the second (real) mount's start
    // actually fires.
    let startTimer = setTimeout(() => {
      startTimer = null
      // Bind / read the task-specific session id, then ask the
      // server to either resume the bound session (if its file
      // exists on disk) or create one at that id (if not). The
      // backend handles the decision so a missing session file
      // never produces "No conversation found" — it just creates.
      const sessionId = getOrMintSessionId(task?.id)
      dlog('emitting webshell:start (deferred past StrictMode double-mount)', {
        cols: term.cols,
        rows: term.rows,
        sessionId,
        tryResume: true,
      })
      socket.emit('webshell:start', {
        cols: term.cols,
        rows: term.rows,
        sessionId,
        tryResume: true,
      })
    }, 0)

    return () => {
      dlog('cleanup running', { startTimerActive: startTimer !== null })
      // Cancel pending start emit if cleanup runs before the
      // setTimeout fires — this is the StrictMode dev path. If the
      // start already fired, the server has a live PTY associated
      // with this socket; the next mount's start will replace it,
      // which is the legitimate restart-on-task-change flow.
      if (startTimer !== null) {
        clearTimeout(startTimer)
        startTimer = null
      }
      window.removeEventListener('resize', handleResize)
      if (resizeTimer) clearTimeout(resizeTimer)
      if (pendingFit) clearTimeout(pendingFit)
      resizeObserver.disconnect()
      inputDisposable.dispose()
      socket.off('webshell:output', handleOutput)
      socket.off('webshell:exit', handleExit)
      socket.off('disconnect', handleDisconnect)
      // Do NOT socket.disconnect() — atrium owns the socket lifecycle.
      try { webglAddon?.dispose() } catch { /* already disposed */ }
      try { term.dispose() } catch { /* already disposed */ }
      xtermRef.current = null
    }
    // task?.id in deps so navigating to a different task restarts the
    // shell in the new task's context (server still resolves cwd from
    // settings.workingDirectory; if a future feature adds per-task
    // folder mapping, this dep guarantees it picks up the change).
  }, [task?.id, socket])

  // Re-launch a shell on top of the existing socket. The server-side
  // handler kills any live PTY before spawning, so this also covers
  // the corner case where the user clicks Resume while the previous
  // session is somehow still alive.
  //
  // Two render-correctness measures here that fix bug-shell-resume-render-001
  // (intermittent garbled rendering on Resume — characters smearing,
  // duplicate banners stacking on top of each other):
  //
  //   1. `term.reset()` instead of `term.clear()`. clear() only wipes
  //      the visible region; reset() also drops scrollback, restores
  //      cursor position, scroll region, charset, mouse modes, and
  //      bracketed-paste state. The replay torrent from
  //      `claude --resume` assumes a clean default terminal — any
  //      mode the prior session left set (e.g. mouse tracking) makes
  //      the replay's escape sequences write to the wrong cells.
  //   2. Defer the `webshell:start` emit by one requestAnimationFrame
  //      after the reset. xterm commits the cleared frame to the
  //      renderer on the next paint; sending the spawn synchronously
  //      means the byte burst can hit cells that haven't finished
  //      committing the reset yet, producing the doubled-banner
  //      smear seen in the screenshot. One rAF (~16ms) is below the
  //      perceptual threshold but above xterm's commit latency.
  const respawn = useCallback((payload) => {
    const term = xtermRef.current
    if (!term || !socket?.connected) return
    try { term.reset() } catch { /* term disposed */ }
    setExitInfo(null)
    requestAnimationFrame(() => {
      const liveTerm = xtermRef.current
      if (!liveTerm || !socket?.connected) return
      socket.emit('webshell:start', {
        cols: liveTerm.cols,
        rows: liveTerm.rows,
        ...payload,
      })
      try { liveTerm.focus() } catch { /* term disposed */ }
    })
  }, [socket])

  // Resume: ask the server to revive THIS task's bound session if
  // its file exists on disk, or create one at that id if not. The
  // server-side decision (web-shell.js → buildClaudeCommand) is
  // logged at info level — check the backend log if Resume isn't
  // doing what's expected.
  const handleResume = useCallback(() => {
    const sessionId = getOrMintSessionId(task?.id)
    respawn({ sessionId, tryResume: true })
  }, [respawn, task?.id])
  // New session: rotate to a fresh id BEFORE spawning, and force the
  // server to skip the resume check (the new id won't have a session
  // file yet anyway, but tryResume=false makes the intent explicit
  // in the backend logs). Old session file stays on disk; the user
  // can still recover it manually via `claude --resume <old-id>`.
  const handleNewSession = useCallback(() => {
    const sessionId = rotateSessionId(task?.id)
    respawn({ sessionId, tryResume: false })
  }, [respawn, task?.id])
  const handleDismiss = useCallback(() => setExitInfo(null), [])

  // Esc on the recovery overlay = Dismiss. We do not auto-resume on
  // Esc — silent restart hides real failures (Q5 default in the task
  // spec). Listener is only attached while exitInfo is non-null so
  // Esc keeps its existing meaning (close DetailPane) when the
  // overlay is not visible.
  useEffect(() => {
    if (!exitInfo) return undefined
    const handler = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setExitInfo(null)
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [exitInfo])

  // The parent (DetailPane's shell-tab branch) provides dimensions
  // via `position: absolute; inset: var(--space-4)` inside the
  // tabpanel. We fill 100%/100% with a flex column.
  //
  // onMouseDown handles clicks on padding / non-xterm areas of the
  // wrapper — clicks directly on xterm's DOM/canvas focus the term
  // via xterm's own internal handlers, so we don't double-fire. We
  // deliberately do NOT have an onFocus handler or tabIndex on the
  // wrapper — those create a focus war with xterm's helper textarea:
  // the wrapper repeatedly grabs focus back, eating keystrokes
  // before term.onData can fire.
  //
  // Inner ref'd div is `position: relative` so xterm's own absolute
  // children dock to it cleanly.
  return (
    <div
      ref={wrapperRef}
      onMouseDown={(e) => {
        const onWrapper = e.target === wrapperRef.current
        const onContainer = e.target === containerRef.current
        dlog('wrapper mousedown', {
          targetTag: e.target?.tagName,
          targetClass: e.target?.className,
          onWrapper,
          onContainer,
        })
        // Only steal focus when the click landed on the wrapper or
        // the padding ring — clicks inside xterm's own DOM/canvas
        // are already handled by xterm.
        if (onWrapper || onContainer) {
          try {
            xtermRef.current?.focus()
            dlog('forced term.focus() from wrapper mousedown')
          } catch { /* term disposed */ }
        }
      }}
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: TERMINAL_THEME.background,
        // position: relative so the recovery overlay below docks to
        // this wrapper rather than escaping up to the tabpanel.
        position: 'relative',
      }}
    >
      <div
        ref={containerRef}
        style={{
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          position: 'relative',
        }}
      />
      {exitInfo && (
        <ExitRecoveryOverlay
          taskId={task?.id}
          sessionId={readSessionId(task?.id)}
          exitCode={exitInfo.exitCode}
          onResume={handleResume}
          onNewSession={handleNewSession}
          onDismiss={handleDismiss}
        />
      )}
    </div>
  )
}

// Renders centered over the terminal canvas when the spawned shell
// has exited. Three actions: Resume previous session, Start new
// session, Dismiss. Layered at z-index 7 so the CommandCard's
// floating pill / popover (z-index 10 in CommandCard.jsx) still
// sits on top — the user can pop the command list while the overlay
// is up without dismissing it.
function ExitRecoveryOverlay({ taskId, sessionId, exitCode, onResume, onNewSession, onDismiss }) {
  // Last 8 chars of the session uuid is enough to disambiguate
  // visually without filling the whole popover with a 36-char id.
  const sessionSuffix = sessionId ? sessionId.slice(-8) : null
  return (
    <div
      // Backdrop swallows clicks on the dead canvas so a stray click
      // doesn't try to focus a disposed PTY. Clicking the backdrop
      // itself dismisses (treats the empty space as "View output").
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onDismiss()
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Shell exited"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 7,
        background: 'rgba(0, 0, 0, 0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-4)',
      }}
    >
      <div
        style={{
          width: 'min(360px, 100%)',
          background: 'var(--bg-card)',
          border: 'var(--border-hairline)',
          borderRadius: 'var(--radius-md)',
          boxShadow: 'var(--shadow-popover)',
          padding: 'var(--space-4)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-3)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span
            style={{
              fontSize: 'var(--text-callout)',
              fontWeight: 'var(--font-semibold)',
              color: 'var(--text-app)',
            }}
          >
            Shell exited
          </span>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-caption2)',
              color: 'var(--text-tertiary)',
              padding: '2px 6px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--fill-secondary)',
            }}
          >
            exit {exitCode}
          </span>
          {sessionSuffix ? (
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-caption2)',
                color: 'var(--text-tertiary)',
                padding: '2px 6px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--fill-secondary)',
              }}
              title={`Bound session: ${sessionId}`}
            >
              …{sessionSuffix}
            </span>
          ) : null}
        </div>
        <p
          style={{
            margin: 0,
            fontSize: 'var(--text-footnote)',
            color: 'var(--text-muted)',
            lineHeight: 1.4,
          }}
        >
          The shell session ended. Resume keeps THIS task&apos;s claude context; New starts a fresh conversation bound to this task.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <button
            type="button"
            onClick={onResume}
            className="apple-press"
            style={{
              padding: 'var(--space-2) var(--space-3)',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--accent-app)',
              color: 'var(--accent-on-app)',
              fontSize: 'var(--text-caption1)',
              fontWeight: 'var(--font-semibold)',
              cursor: 'pointer',
              textAlign: 'center',
            }}
          >
            Resume previous session
          </button>
          <button
            type="button"
            onClick={onNewSession}
            className="apple-press"
            style={{
              padding: 'var(--space-2) var(--space-3)',
              border: 'var(--border-hairline)',
              borderRadius: 'var(--radius-sm)',
              background: 'transparent',
              color: 'var(--text-app)',
              fontSize: 'var(--text-caption1)',
              fontWeight: 'var(--font-medium)',
              cursor: 'pointer',
              textAlign: 'center',
            }}
          >
            Start new session
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
          <button
            type="button"
            onClick={onDismiss}
            className="apple-press"
            title="Close (Esc)"
            style={{
              padding: '2px 6px',
              margin: '-2px -6px',
              border: 'none',
              background: 'transparent',
              color: 'var(--text-tertiary)',
              fontSize: 'var(--text-caption2)',
              cursor: 'pointer',
            }}
          >
            Dismiss · view output
          </button>
          {taskId ? (
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-caption2)',
                color: 'var(--text-tertiary)',
              }}
              title="Task this shell belongs to"
            >
              {taskId}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  )
}
