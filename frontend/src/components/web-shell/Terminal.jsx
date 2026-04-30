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

import { useEffect, useRef } from 'react'
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

// Default startup command. Like the standalone web-shell, opens
// straight into Claude Code — but with --dangerously-skip-permissions
// so the user doesn't have to manually click through trust-folder /
// tool-approval dialogs every time the Shell tab opens. Matches the
// flag atrium's existing Run Agent flow uses (routes/agents.js).
const STARTUP_COMMAND = 'claude --dangerously-skip-permissions'

// Build the message that gets auto-typed into claude after it boots,
// providing the open task's id (and title when available) plus a
// nudge to use the atrium skill. Returns null when there's no task,
// in which case the shell just opens claude with no pre-filled
// message.
function buildInitialPrompt(task) {
  if (!task || !task.id) return null
  const parts = [`I'm working on task ${task.id} in atrium.`]
  if (task.title) parts.push(`Title: ${task.title}.`)
  parts.push(
    'Use the atrium skill for task management — atrium MCP tools, ' +
    'or the HTTP API at http://localhost:3001 if MCP is unavailable. ' +
    'Read the task first, then proceed per the skill rules ' +
    '(phased work, structured comments, no draft → in_progress, ' +
    'agents stop at review).'
  )
  return parts.join(' ')
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
      const initialInput = buildInitialPrompt(task)
      dlog('emitting webshell:start (deferred past StrictMode double-mount)', {
        cols: term.cols,
        rows: term.rows,
        command: STARTUP_COMMAND,
        initialInput,
      })
      socket.emit('webshell:start', {
        cols: term.cols,
        rows: term.rows,
        command: STARTUP_COMMAND,
        initialInput,
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
    // task?.id (not full task) is the dep so navigating to a
    // different task restarts the shell, but a parent re-render that
    // replaces task with a new object of the same id does NOT
    // (otherwise every poll-driven task list refresh would kill and
    // respawn claude). The full `task` object is read inside the
    // deferred start to pull task.title for the initial prompt; this
    // is intentional and the eslint warning below is the right call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id, socket])

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
    </div>
  )
}
