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
    // case where the user drags the DetailPane edge. After every
    // successful fit we re-focus the terminal so keystrokes land
    // even if the first focus() call ran before the textarea had a
    // valid layout.
    let pendingFit = null
    const resizeObserver = new ResizeObserver(() => {
      if (pendingFit) clearTimeout(pendingFit)
      pendingFit = setTimeout(() => {
        if (!safeFit()) return
        try { term.focus() } catch { /* term disposed */ }
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
    }
    // task?.id in deps so navigating to a different task restarts the
    // shell in the new task's context (server still resolves cwd from
    // settings.workingDirectory; if a future feature adds per-task
    // folder mapping, this dep guarantees it picks up the change).
  }, [task?.id, socket])

  // The parent (DetailPane's shell-tab wrapper) provides explicit
  // dimensions via `position: absolute; inset: var(--space-4)` inside
  // the tabpanel. We just fill it with a flex column so the inner
  // ref'd div has a real height before term.open() runs. The onClick
  // handler is defensive: xterm normally handles its own focus on
  // canvas clicks, but clicks on padding/border would otherwise do
  // nothing.
  return (
    <div
      ref={wrapperRef}
      onClick={() => {
        const t = containerRef.current?.querySelector('.xterm-helper-textarea')
        if (t && typeof t.focus === 'function') t.focus()
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
          padding: 4,
        }}
      />
    </div>
  )
}
