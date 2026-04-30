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

// Default startup command. Same as the standalone web-shell — opens
// straight into Claude Code rather than a bare prompt. Override with
// the empty string to opt into a bare interactive shell.
const STARTUP_COMMAND = 'claude'

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

    const handleOutput = (data) => term.write(data)
    const handleExit = ({ exitCode }) =>
      term.write(`\r\n\x1b[33m[shell exited (${exitCode})]\x1b[0m\r\n`)
    const handleDisconnect = () =>
      term.write('\r\n\x1b[31m[disconnected]\x1b[0m\r\n')

    socket.on('webshell:output', handleOutput)
    socket.on('webshell:exit', handleExit)
    socket.on('disconnect', handleDisconnect)

    const inputDisposable = term.onData((data) => {
      if (socket.connected) socket.emit('webshell:input', data)
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

    // Kick off the shell once the canvas has its initial size.
    socket.emit('webshell:start', {
      cols: term.cols,
      rows: term.rows,
      command: STARTUP_COMMAND,
    })

    return () => {
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
        // Only steal focus when the click landed on the wrapper or
        // the padding ring — clicks inside xterm's own DOM/canvas
        // are already handled by xterm. Filtering by target avoids
        // the focus race that swallows keystrokes during the
        // browser's own focus transition.
        if (e.target === wrapperRef.current || e.target === containerRef.current) {
          try { xtermRef.current?.focus() } catch { /* term disposed */ }
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
