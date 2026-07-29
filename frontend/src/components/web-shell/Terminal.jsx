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
// Wire format (matches backend/sockets/web-shell.js) — Phase 1 of
// `feat-shell-background-sessions-001` migrated every event payload to
// `{ taskId, ... }` so later phases can route N PTYs per socket. Phase 4
// added webshell:close + webshell:evicted. taskId is null for the global-
// shell modal (Phase 5 collapses that workaround):
//   client → server   webshell:start   { taskId, cols?, rows?, command?, sessionId?, tryResume?, rotate? }
//                     webshell:input   { taskId, data }
//                     webshell:resize  { taskId, cols, rows }
//                     webshell:close   { taskId }
//   server → client   webshell:output  { taskId, data }
//                     webshell:exit    { taskId, exitCode, spawnId }
//                     webshell:spawn   { taskId, spawnId, pid, spawnAt, sessionId, sessionSource }
//                     webshell:evicted { taskId }
//
// Default startup command is `claude` so the page boots straight into
// Claude Code on a clean canvas. The cwd is resolved server-side from
// settings.workingDirectory (no per-task folder mapping today).

import { useCallback, useEffect, useRef, useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { useAuth } from '../../contexts/AuthContext'
import { getXtermTheme } from './terminalThemes'
import { ACTION, decideKeyAction, writeClipboard, readClipboard, clipboardAvailable, getTerminalText, mouseTrackingActive, clipboardReadPermission, clipboardEnvironment } from './clipboard'
import { API_URL, apiFetch } from '../../config'

// Per-task session id binding. The source of truth is the task YAML's
// `claude_session_id` field — the backend mints/promotes/rotates it on
// `webshell:start` and reports the resolved value back via the
// `webshell:spawn` sentinel. localStorage is now a cache: it lets the
// frontend ship a hint to the server (one-time migration of legacy
// per-machine UUIDs from feat-shell-task-resume-001) and lets the
// exit-recovery overlay show the bound id without a round-trip.
//
// Spawn-time decision lives in the backend (web-shell.js → `buildClaudeCommand`):
//   - file exists → `claude --resume <uuid>`   (revive conversation)
//   - file absent → `claude --session-id <uuid>` (create at this id)
// This avoids the "No conversation found with session ID: <uuid>"
// error loop when Resume targeted a never-saved session (e.g., user
// typed /exit before sending any messages).
//
// "Start new session" sends `rotate: true` and lets the backend mint
// the new UUID server-side (single source of truth, easier to test).
// Client-side mintUuid stays as a fallback for graceful degradation
// against a backend that hasn't picked up this feature yet.
const SESSION_ID_KEY_PREFIX = 'webshell:session:'

// Sentinel id for the non-task "global" shell modal (feat-global-shell-modal-001).
// When the wrapper receives this id, the task YAML lookup is skipped (we don't
// have a task to write to) and session id is managed entirely client-side
// against localStorage. The wire payload sends `taskId: null` so the backend
// stays on its legacy "no taskId, just use the supplied sessionId" path.
const GLOBAL_TASK_ID = '__global__'

function readSessionId(taskId) {
  if (!taskId) return null
  try { return window.localStorage.getItem(SESSION_ID_KEY_PREFIX + taskId) } catch { return null }
}
function writeSessionId(taskId, id) {
  if (!taskId) return
  try { window.localStorage.setItem(SESSION_ID_KEY_PREFIX + taskId, id) } catch { /* storage full or disabled */ }
}
function mintUuid() {
  try {
    if (typeof window !== 'undefined' && window.crypto?.randomUUID) return window.crypto.randomUUID()
  } catch { /* crypto unavailable */ }
  // Fallback for ancient browsers — RFC4122 v4 shape via Math.random.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}
function ensureGlobalSessionId() {
  const existing = readSessionId(GLOBAL_TASK_ID)
  if (existing) return existing
  const fresh = mintUuid()
  writeSessionId(GLOBAL_TASK_ID, fresh)
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
// Diagnostic logging for bug-shell-resume-render-001. ALWAYS ON
// regardless of the DEBUG flag — these are the events we need to
// see in the user's console to diagnose the garbled-render bug.
// Tagged with [webshell-diag] so they're greppable. Output is
// short enough to leave on permanently while we hunt the bug.
const xlog = (...args) => console.log('[webshell-diag]', ...args)

// Wire taskId computation lifted out of the mount effect so multiple
// effects (the original setup + Phase 3's re-fit-on-activate) share a
// single source of truth without recomputing in each. For the global
// shell modal this stays null — Phase 5 collapses that workaround.
function computeWireTaskId(task) {
  if (!task) return null
  if (task.id === GLOBAL_TASK_ID) return null
  return task.id || null
}

export default function ShellTerminal({ task, socket, isActive = true }) {
  const { theme } = useAuth()
  const wireTaskId = computeWireTaskId(task)
  const wrapperRef = useRef(null)
  const containerRef = useRef(null)
  // Theme is read inside the long mount effect (for the xterm
  // constructor) and updated live by a separate effect below. We
  // capture it in a ref so the mount effect doesn't have to list
  // `theme` in its deps — adding it there would tear down and rebuild
  // the entire xterm on every theme change, killing scrollback. The
  // live-update effect (`term.options.theme = ...`) handles change
  // propagation without remounting.
  const themeRef = useRef(theme)
  useEffect(() => { themeRef.current = theme }, [theme])
  // xtermRef is read by the wrapper's onMouseDown handler so clicks
  // anywhere in the visible area (including padding / dead-zones in
  // xterm's own canvas) reliably focus the terminal via the public
  // term.focus() API. Querying for `.xterm-helper-textarea` from the
  // DOM was unreliable — depending on which xterm internal layout was
  // active (DOM vs WebGL renderer), the textarea could be reachable,
  // hidden, or moved.
  const xtermRef = useRef(null)
  // Holds the contextmenu listener's teardown so the mount effect's
  // cleanup can remove it along with everything else it owns.
  const contextMenuCleanupRef = useRef(null)
  const copyHandlerRef = useRef(null)
  // Transient 'Copied' confirmation on the copy button.
  const [copyState, setCopyState] = useState(null)
  // fitAddonRef exposes the fit addon so the Phase 3 re-fit-on-activate
  // effect (below the main mount effect) can call fit() without owning
  // the addon's lifecycle. ResizeObserver doesn't fire on
  // `display: none` elements, so a tab that just became visible needs
  // an explicit re-fit to match its container's current size.
  const fitAddonRef = useRef(null)

  // exitInfo flips non-null when the server reports webshell:exit and
  // drives the recovery overlay below. Cleared by Resume / New /
  // Dismiss and by Esc while the overlay is showing. Phase 3 keeps
  // each ShellTerminal instance alive across task switches (no remount
  // by parent), so this state survives navigation — but the per-instance
  // taskId filter on inbound `webshell:exit` ensures only THIS task's
  // exit re-arms the overlay.
  const [exitInfo, setExitInfo] = useState(null)

  // Spawn-correlation state shared between the mount effect (server
  // events arrive there) and the respawn callback (button click
  // emits webshell:start). Refs so both paths see the same values
  // without depending on closures or component re-renders.
  //   activeSpawnIdRef   — latest server-side spawnId we've heard
  //                        from via the webshell:spawn sentinel.
  //   lastStartEmittedAtRef — Date.now() of the last webshell:start
  //                        we sent. Used to drop stale exit events
  //                        whose underlying PTY was the prior one
  //                        (server kills the prior PTY before
  //                        spawning the new one — the kill emits a
  //                        webshell:exit that, naively handled,
  //                        re-arms the overlay seconds after the
  //                        user clicked Resume).
  const activeSpawnIdRef = useRef(null)
  const lastStartEmittedAtRef = useRef(0)

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
      theme: getXtermTheme(themeRef.current),
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
    fitAddonRef.current = fitAddon
    term.loadAddon(fitAddon)
    term.open(containerRef.current)
    dlog('term opened', { cols: term.cols, rows: term.rows })

    // --- Clipboard (bug-shell-clipboard-001) -----------------------------
    // There was previously NO clipboard handling here at all, so Ctrl+V did
    // nothing and no key ever copied. Decision logic lives in ./clipboard.js
    // so it can be tested without a DOM; this is just the wiring.
    //
    // Returning false tells xterm not to process the event, which is what
    // keeps a copy/paste chord from also reaching the PTY as a control code.
    const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '')

    const notify = (msg) => {
      // Written into the terminal itself rather than a toast: the user is
      // looking here, and a paste that silently does nothing is the exact
      // failure this fix exists to remove.
      try { term.writeln('\r\n\x1b[33m[atrium] ' + msg + '\x1b[0m') } catch { /* term disposed */ }
    }

    // Fire-and-forget diagnostic report. Records OUTCOMES and LENGTHS only —
    // never clipboard content; the backend drops anything not on its
    // allow-list. Failures here are swallowed: a diagnostic that breaks the
    // thing it is diagnosing is worse than no diagnostic.
    const report = async (fields) => {
      try {
        const env = clipboardEnvironment()
        const permissionState = await clipboardReadPermission()

        // Console FIRST, and unconditionally. Two rounds of this investigation
        // produced an empty server log, which proved nothing — a report that
        // depends on a network call cannot tell you the handler never ran.
        // This line lands in devtools whatever happens to the POST below.
        console.log('[atrium-clipboard]', {
          ...fields, permissionState, ...env,
          hasSelection: term.hasSelection(),
          mouseTracking: mouseTrackingActive(term),
        })

        await apiFetch(`${API_URL}/diagnostics/client`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            category: 'clipboard',
            taskId: task?.id || null,
            origin: window.location.origin,
            mouseTracking: mouseTrackingActive(term),
            hasSelection: term.hasSelection(),
            permissionState,
            ...env,
            ...fields,
          }),
        })
      } catch { /* diagnostics are never allowed to surface */ }
    }

    // Copies the selection, or the scrollback when there is none. The
    // fallback is the whole point: a TUI like Claude Code turns ON mouse
    // tracking, so drags go to the APPLICATION and no selection is ever
    // made — which is why every copy binding appeared dead.
    const doCopy = (trigger = 'key') => {
      const text = getTerminalText(term)
      if (!text) {
        report({ action: 'copy', trigger, result: 'empty' })
        return
      }
      writeClipboard(text).then((ok) => {
        report({
          action: 'copy', trigger,
          result: ok ? 'ok' : 'error',
          textLength: text.length,
          selectionLength: (term.getSelection() || '').length,
        })
        if (!ok) notify('Copy failed — the browser blocked clipboard access.')
      })
    }

    const doPaste = () => {
      readClipboard().then((text) => {
        if (text) {
          // term.paste() routes through onData, so bracketed-paste mode is
          // preserved and the PTY sees this exactly like a real paste.
          term.paste(text)
        } else if (!clipboardAvailable()) {
          // The LAN case: navigator.clipboard needs a secure context.
          // localhost qualifies, a bare IP does not.
          notify('Paste needs a secure context. Use localhost or HTTPS, or paste with your terminal\u2019s middle-click.')
        }
      })
    }

    // Handed to the toolbar button below, so the button and the key
    // bindings can never diverge in what they copy.
    copyHandlerRef.current = doCopy

    // Report the environment once per terminal mount, without waiting for the
    // user to do anything. The first pass at these diagnostics only recorded
    // ATTEMPTS, so when the log came back empty it proved nothing: it could
    // not distinguish "the instrumented code isn't running" from "the handler
    // never fired". This makes the browser's actual capabilities — which
    // clipboard APIs exist, whether the context is secure, what the
    // clipboard-read permission says — visible with zero user action.
    report({ action: 'init', trigger: 'mount', result: 'ok' })

    term.attachCustomKeyEventHandler((e) => {
      const action = decideKeyAction(e, term.hasSelection(), isMac)
      if (action === ACTION.COPY) { doCopy('key'); return false }
      if (action === ACTION.PASTE) { doPaste('key'); return false }
      return true
    })

    // Right-click COPIES when there is a selection and pastes otherwise —
    // the PuTTY / Windows Terminal convention. It was paste-only in the first
    // cut of this fix, which is why right-clicking a selection appeared to do
    // nothing useful: it silently replaced the copy you wanted with a paste.
    // Shift is the escape hatch back to the browser's own context menu.
    const onContextMenu = (e) => {
      if (e.shiftKey) return
      e.preventDefault()
      if (term.hasSelection()) {
        doCopy('contextmenu')
        // Clear afterwards so the next right-click pastes, matching how the
        // same gesture behaves in a real terminal.
        term.clearSelection()
      } else {
        doPaste('contextmenu')
      }
    }
    // NATIVE PASTE — the route that actually works everywhere.
    //
    // navigator.clipboard.readText() needs the `clipboard-read` permission:
    // Chrome prompts and remembers a refusal forever, Firefox does not expose
    // it to web content at all. The browser's OWN paste (Ctrl+V / Cmd+V /
    // middle-click / Edit>Paste) fires this event with the data already
    // attached and requires NO permission — which is why it is wired
    // explicitly rather than left to chance.
    const onNativePaste = (e) => {
      const text = e.clipboardData?.getData('text') || ''
      if (!text) return
      e.preventDefault()
      e.stopPropagation()
      term.paste(text)
      report({ action: 'paste', trigger: 'native-paste', result: 'ok', textLength: text.length })
    }
    // Capture phase and on the wrapper: xterm's helper textarea is a child, and
    // catching it here works whether or not focus is exactly where we expect.
    wrapperRef.current?.addEventListener('paste', onNativePaste, true)

    containerRef.current.addEventListener('contextmenu', onContextMenu)
    contextMenuCleanupRef.current = () => {
      containerRef.current?.removeEventListener('contextmenu', onContextMenu)
      wrapperRef.current?.removeEventListener('paste', onNativePaste, true)
    }

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
          socket.emit('webshell:resize', { taskId: wireTaskId, cols: term.cols, rows: term.rows })
        }
      }, 50)
    })
    if (wrapperRef.current) resizeObserver.observe(wrapperRef.current)

    // Spawn correlation state. activeSpawnIdRef + lastStartEmittedAtRef
    // are component-level so the respawn() callback (defined outside
    // this effect) can stamp lastStartEmittedAtRef when a Resume /
    // New click emits webshell:start. bytesSinceSpawn is local —
    // only handleSpawnSentinel + handleOutputDiag read/write it.
    let bytesSinceSpawn = 0

    // handleOutput stays string-in (the unwrap happens in handleOutputDiag,
    // which is the actual socket listener). Keeping the inner helper as a
    // pure data-writer makes the diagnostic-vs-debug split easier to follow.
    const handleOutput = (data) => {
      if (DEBUG && data.length > 0) {
        const preview = data.length > 80 ? data.slice(0, 80) + '…' : data
        dlog('webshell:output recv', { bytes: data.length, preview: JSON.stringify(preview) })
      }
      term.write(data)
    }
    const handleExit = ({ exitCode, spawnId, taskId: exitTaskId }) => {
      // Phase 3 multi-instance filter: drop exit events for other tasks.
      // Without this, every ShellTerminal instance on the same socket
      // would re-arm its recovery overlay when ANY task's PTY exits.
      if (exitTaskId !== wireTaskId) return
      // Filter stale exit events. When the user clicks Resume the
      // server kills the prior PTY (if it was somehow still alive)
      // and spawns a new one. The kill triggers a webshell:exit
      // tagged with the DYING PTY's spawnId — if we naively re-arm
      // the overlay on that, the popup pops back up instantly and
      // looks like the click was ignored.
      //
      // Two-part filter:
      //   1. If we have a known activeSpawnId (sentinel arrived for
      //      a newer spawn), and this exit is for an OLDER spawn,
      //      it's stale — log + drop.
      //   2. If we just emitted a webshell:start in the last ~250ms,
      //      any exit arriving without its own spawnId is most likely
      //      the dying-prior-PTY exit. Drop and warn.
      const now = Date.now()
      const isOlder = typeof spawnId === 'number' && activeSpawnIdRef.current != null && spawnId < activeSpawnIdRef.current
      const recentStart = now - lastStartEmittedAtRef.current < 250
      if (isOlder || (spawnId == null && recentStart)) {
        xlog('webshell:exit DROPPED (stale, prior PTY death)', {
          exitSpawnId: spawnId,
          activeSpawnId: activeSpawnIdRef.current,
          isOlder,
          recentStart,
          msSinceLastStart: now - lastStartEmittedAtRef.current,
          exitCode,
        })
        // Don't write anything to the canvas. Painting an "ignored"
        // marker after term.reset() pollutes the new spawn's
        // banner — the diag log is the only audit trail needed.
        return
      }
      xlog('webshell:exit recv (re-arming overlay)', {
        exitSpawnId: spawnId,
        activeSpawnId: activeSpawnIdRef.current,
        msSinceLastStart: now - lastStartEmittedAtRef.current,
        exitCode,
      })
      term.write(`\r\n\x1b[33m[shell exited (${exitCode})]\x1b[0m\r\n`)
      setExitInfo({ exitCode })
    }
    const handleDisconnect = (reason) => {
      dlog('socket disconnect', { reason })
      term.write('\r\n\x1b[31m[disconnected]\x1b[0m\r\n')
    }
    // Phase 4 — server tells us our PTY was evicted to make room (cap
    // pressure). Filter by taskId so each instance only acts on its own
    // eviction; clear the active spawn ref so the next Resume click
    // triggers a fresh spawn instead of reattaching to nothing.
    const handleEvicted = (payload) => {
      if (!payload || payload.taskId !== wireTaskId) return
      term.write('\r\n\x1b[33m[session evicted — start a new one to reconnect]\x1b[0m\r\n')
      activeSpawnIdRef.current = null
      xlog('webshell:evicted recv', { taskId: payload.taskId, at: Date.now() })
    }

    // (activeSpawnId / bytesSinceSpawn / lastStartEmittedAt are
    // declared above so handleExit can read them for stale-exit
    // filtering. Don't redeclare — these are the same variables.)
    const handleSpawnSentinel = ({ spawnId, pid, spawnAt, sessionId, sessionSource, taskId: spawnTaskId }) => {
      // Phase 3 multi-instance filter: drop spawn sentinels for other
      // tasks so each ShellTerminal instance only updates its own
      // activeSpawnIdRef from sentinels matching its bound taskId.
      if (spawnTaskId !== wireTaskId) return
      // Cross-tab reattach (`feat-shell-lifecycle-001`): the backend kept
      // the PTY alive across the tab close, so this xterm is brand new
      // but the running TUI (claude) is still in its original alt-buffer
      // mindset. The backend's reattach branch resizes the PTY to the new
      // dims, which fires SIGWINCH and triggers a redraw — but claude's
      // redraw escapes use absolute cursor positioning that assumes its
      // existing screen state. Without resetting the xterm first, those
      // escapes land in our blank regular-buffer canvas at coordinates
      // that don't match anything visible → cursor jumps and parks at
      // the wrong corner. term.reset() returns the xterm to a known
      // clean state (cursor home, regular buffer, default attributes)
      // so claude's redraw renders cleanly. Within-socket reattaches
      // (Phase 2 background sessions) keep the same xterm via
      // ShellManager and never need this — the xterm state is already
      // consistent with what claude expects.
      if (sessionSource === 'reattach') {
        try { term.reset() } catch { /* xterm disposed */ }
      }
      const prev = activeSpawnIdRef.current
      const prevBytes = bytesSinceSpawn
      activeSpawnIdRef.current = spawnId
      bytesSinceSpawn = 0
      // Mirror the server-resolved session id into localStorage so the
      // exit-recovery overlay's chip and the next spawn's hint stay in
      // sync with the task YAML — this is the cache-update half of the
      // promotion-from-localStorage story.
      if (sessionId && spawnTaskId) {
        writeSessionId(spawnTaskId, sessionId)
      }
      xlog('webshell:spawn sentinel', {
        newSpawnId: spawnId,
        previousSpawnId: prev,
        previousBytesEmitted: prevBytes,
        pid,
        spawnAt,
        sessionId,
        sessionSource,
        taskId: spawnTaskId,
        clientReceivedAt: Date.now(),
      })
    }
    // Wire format Phase 1: payload is `{ taskId, data }`. Drop silently if
    // the shape is wrong (defensive against any in-flight legacy emits while
    // both sides roll out together).
    // Phase 3 multi-instance filter: drop output for other tasks so this
    // xterm only writes bytes addressed to its bound taskId.
    const handleOutputDiag = (payload) => {
      if (!payload || payload.taskId !== wireTaskId) return
      if (typeof payload.data !== 'string') return
      const data = payload.data
      bytesSinceSpawn += data.length
      // Log each chunk's first 40 bytes so we can correlate visible
      // glitches with the byte stream that produced them. Only
      // chunks where activeSpawnIdRef is null (bytes arrived before
      // the sentinel) are logged as orphans — those are the ones
      // we suspect of causing the doubled-banner overlap.
      if (activeSpawnIdRef.current === null) {
        xlog('ORPHAN webshell:output (no active spawn)', {
          bytes: data.length,
          preview: data.length > 40 ? data.slice(0, 40) + '…' : data,
          clientReceivedAt: Date.now(),
        })
      } else if (DEBUG) {
        dlog('webshell:output', {
          spawnId: activeSpawnIdRef.current,
          bytes: data.length,
          totalSinceSpawn: bytesSinceSpawn,
          preview: data.length > 40 ? data.slice(0, 40) + '…' : data,
        })
      }
      handleOutput(data)
    }

    socket.on('webshell:spawn', handleSpawnSentinel)
    socket.on('webshell:output', handleOutputDiag)
    socket.on('webshell:exit', handleExit)
    socket.on('webshell:evicted', handleEvicted)
    socket.on('disconnect', handleDisconnect)
    if (DEBUG) {
      socket.on('connect', () => dlog('socket connect'))
      socket.on('reconnect', () => dlog('socket reconnect'))
    }

    const inputDisposable = term.onData((data) => {
      dlog('term.onData fired', { bytes: data.length, data: JSON.stringify(data), socketConnected: socket.connected })
      if (socket.connected) {
        // Wire format Phase 1: emit as `{ taskId, data }`.
        socket.emit('webshell:input', { taskId: wireTaskId, data })
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
          socket.emit('webshell:resize', { taskId: wireTaskId, cols: term.cols, rows: term.rows })
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
      // Read (don't mint) localStorage as a hint — first-ever opens on a
      // fresh machine send no sessionId so the backend mints server-side
      // and writes to the task YAML. Existing localStorage values are
      // promoted by the backend on first spawn after this feature ships.
      //
      // Global shell modal (task.id === GLOBAL_TASK_ID): there is no task
      // YAML to write to, so we mint client-side here and pass taskId:null
      // on the wire. Backend then uses the supplied sessionId verbatim
      // (sessionSource: 'client') without looking up or persisting any
      // task field.
      const isGlobal = task?.id === GLOBAL_TASK_ID
      const sessionHint = isGlobal ? ensureGlobalSessionId() : readSessionId(task?.id)
      const payload = {
        cols: term.cols,
        rows: term.rows,
        taskId: isGlobal ? null : (task?.id || null),
        ...(sessionHint ? { sessionId: sessionHint } : {}),
        tryResume: true,
      }
      lastStartEmittedAtRef.current = Date.now()
      xlog('emitting webshell:start (initial mount)', {
        ...payload,
        emittedAt: lastStartEmittedAtRef.current,
      })
      socket.emit('webshell:start', payload)
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
      // Right-click paste listener — attached to the container element, so it
      // outlives the xterm dispose below unless removed explicitly.
      contextMenuCleanupRef.current?.()
      contextMenuCleanupRef.current = null
      socket.off('webshell:spawn', handleSpawnSentinel)
      socket.off('webshell:output', handleOutputDiag)
      socket.off('webshell:exit', handleExit)
      socket.off('webshell:evicted', handleEvicted)
      socket.off('disconnect', handleDisconnect)
      // Do NOT socket.disconnect() — atrium owns the socket lifecycle.
      try { webglAddon?.dispose() } catch { /* already disposed */ }
      try { term.dispose() } catch { /* already disposed */ }
      xtermRef.current = null
      fitAddonRef.current = null
    }
    // task?.id in deps so a (rare) parent passing a different task object
    // would still set up the right context. wireTaskId is derived from
    // task.id but listed explicitly to satisfy exhaustive-deps. Phase 3
    // changed the lifecycle: ShellManager keeps each ShellTerminal alive
    // across activeTask changes by passing it the SAME task across renders,
    // so this effect typically runs once per instance lifetime.
  }, [task?.id, socket, wireTaskId])

  // Phase 3 re-fit-on-activate: ResizeObserver doesn't fire on `display:
  // none` elements, so when this terminal just became visible we need to
  // explicitly refit the canvas to the container's current size and tell
  // the backend the new dims via webshell:resize. Also re-acquire focus
  // so keystrokes land without an extra click.
  useEffect(() => {
    if (!isActive) return
    const id = requestAnimationFrame(() => {
      const term = xtermRef.current
      const el = containerRef.current
      const fit = fitAddonRef.current
      if (!term || !el || !fit) return
      if (el.clientWidth < 4 || el.clientHeight < 4) return
      try { fit.fit() } catch { /* xterm internals not ready */ }
      try { term.focus() } catch { /* term disposed */ }
      if (socket?.connected) {
        socket.emit('webshell:resize', { taskId: wireTaskId, cols: term.cols, rows: term.rows })
      }
      dlog('refit-on-activate', { cols: term.cols, rows: term.rows, wireTaskId })
    })
    return () => cancelAnimationFrame(id)
  }, [isActive, socket, wireTaskId])

  // Live theme update (bug-shell-theme-colors-001). xterm v6 lets us
  // mutate `term.options.theme` after construction; the renderer
  // (WebGL or DOM) repaints the canvas with the new palette on the
  // next frame without re-mounting, so scrollback, cursor position,
  // focus, and the active PTY all survive a theme switch. We don't
  // touch the wrapper div's background here — that's driven by the
  // CSS variable `--bg-app` (see the inline style below) so it
  // follows the theme automatically with the same transition timing
  // as the rest of the app.
  useEffect(() => {
    const term = xtermRef.current
    if (!term) return
    try {
      term.options.theme = getXtermTheme(theme)
    } catch { /* term disposed mid-frame */ }
  }, [theme])

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
    // Always close the overlay first, regardless of whether the
    // spawn actually fires. The user clicked a button — they expect
    // visible feedback. Any guard that prevents the spawn must NOT
    // prevent the overlay close, otherwise the popup looks frozen.
    setExitInfo(null)
    xlog('respawn() called', { payload, calledAt: Date.now() })
    const term = xtermRef.current
    if (!term || !socket?.connected) {
      xlog('respawn() bailed (no term or disconnected)', {
        hasTerm: !!term,
        socketConnected: socket?.connected,
      })
      return
    }
    try { term.reset() } catch { /* term disposed */ }
    requestAnimationFrame(() => {
      const liveTerm = xtermRef.current
      if (!liveTerm || !socket?.connected) {
        xlog('respawn() rAF bailed', {
          hasTerm: !!liveTerm,
          socketConnected: socket?.connected,
        })
        return
      }
      const fullPayload = {
        cols: liveTerm.cols,
        rows: liveTerm.rows,
        ...payload,
      }
      lastStartEmittedAtRef.current = Date.now()
      xlog('emitting webshell:start (respawn)', { ...fullPayload, emittedAt: lastStartEmittedAtRef.current })
      socket.emit('webshell:start', fullPayload)
      try { liveTerm.focus() } catch { /* term disposed */ }
    })
  }, [socket])

  // Resume: ask the server to revive THIS task's bound session. The
  // server resolves the bound UUID from task YAML (or promotes the
  // localStorage hint on first contact) and decides between
  // `claude --resume <uuid>` vs `claude --session-id <uuid>` based on
  // whether the on-disk session file exists for THIS machine
  // (web-shell.js → buildClaudeCommand). Decision logged at info level.
  // Global modal (taskId === GLOBAL_TASK_ID): no task YAML, so we send
  // taskId:null and let the backend use the localStorage-cached UUID.
  const handleResume = useCallback(() => {
    xlog('handleResume() invoked', { taskId: task?.id, at: Date.now() })
    const isGlobal = task?.id === GLOBAL_TASK_ID
    const sessionHint = isGlobal ? ensureGlobalSessionId() : readSessionId(task?.id)
    respawn({
      taskId: isGlobal ? null : (task?.id || null),
      ...(sessionHint ? { sessionId: sessionHint } : {}),
      tryResume: true,
    })
  }, [respawn, task?.id])
  // New session: tell the server to rotate the bound UUID. Server mints
  // a fresh value and writes it to the task YAML through the standard
  // update helpers (so activity_log records the rotation). The new
  // UUID arrives back via the spawn sentinel, which updates localStorage.
  // Global modal: no task YAML to rotate against, so we mint client-side
  // and respawn with the new sessionId hint + tryResume:false (we want a
  // fresh conversation, not a resume of the rotated-away session).
  const handleNewSession = useCallback(() => {
    xlog('handleNewSession() invoked', { taskId: task?.id, at: Date.now() })
    const isGlobal = task?.id === GLOBAL_TASK_ID
    if (isGlobal) {
      const fresh = mintUuid()
      writeSessionId(GLOBAL_TASK_ID, fresh)
      respawn({ taskId: null, sessionId: fresh, tryResume: false })
      return
    }
    respawn({ taskId: task?.id || null, rotate: true, tryResume: false })
  }, [respawn, task?.id])
  const handleDismiss = useCallback(() => {
    xlog('handleDismiss() invoked', { at: Date.now() })
    setExitInfo(null)
  }, [])

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
        // CSS-var-driven so the brief pre-paint flash before xterm
        // commits its first frame matches the active theme — and so
        // theme switches transition the wrapper alongside the rest of
        // the app. xterm's own canvas background is updated through
        // the `term.options.theme = ...` effect above.
        background: 'var(--bg-app)',
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

      {/* Copy affordance (bug-shell-clipboard-001). Lives in Terminal.jsx
          itself rather than in either shell's chrome, so the task Shell tab
          and the global shell dock get it from the same place and cannot
          drift apart.

          A button is necessary, not just nice: a full-screen TUI turns on
          mouse tracking, and while that is active xterm hands drags to the
          APPLICATION — there is no selection, so the key bindings have
          nothing to copy. Holding Shift bypasses it, but nothing in the UI
          ever said so. */}
      <button
        type="button"
        data-testid="terminal-copy-button"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          copyHandlerRef.current?.('button')
          setCopyState('copied')
          setTimeout(() => setCopyState(null), 1400)
        }}
        title={[
          'Copy selection, or the visible output',
          'Ctrl+Insert or right-click a selection',
          // Ctrl+Shift+C is deliberately not advertised: Chrome and Edge bind
          // it to the DevTools picker and never deliver it to the page.
          mouseTrackingActive(xtermRef.current)
            ? 'This program is using the mouse — hold Shift while dragging to select'
            : null,
        ].filter(Boolean).join('\n')}
        aria-label="Copy terminal output"
        style={{
          position: 'absolute',
          top: '6px',
          right: '6px',
          zIndex: 5,
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          padding: '3px 8px',
          borderRadius: 'var(--radius-sm)',
          fontSize: 'var(--text-caption2)',
          fontWeight: 'var(--font-medium)',
          color: copyState ? 'var(--apple-green)' : 'var(--text-tertiary)',
          background: 'color-mix(in srgb, var(--bg-card) 82%, transparent)',
          border: 'var(--border-hairline)',
          cursor: 'pointer',
          // Fades back once the pointer leaves, so it never competes with the
          // terminal content it sits on top of.
          opacity: copyState ? 1 : 0.8,
          transition: 'opacity var(--duration-fast), color var(--duration-fast)',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.opacity = '1' }}
        onMouseLeave={(e) => { if (!copyState) e.currentTarget.style.opacity = '0.8' }}
      >
        {copyState ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
        {copyState ? 'Copied' : 'Copy'}
      </button>

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
  // Breadcrumb on overlay mount + every prop change. Confirms the
  // overlay is visible and shows when it (re)appears in response to
  // an exit event — so we can correlate a click that "didn't take"
  // with subsequent re-arms.
  useEffect(() => {
    console.log('[webshell-diag] ExitRecoveryOverlay rendered', {
      taskId,
      exitCode,
      sessionSuffix,
      at: Date.now(),
    })
  }, [taskId, exitCode, sessionSuffix])
  // Wrap each action handler with a click breadcrumb at the DOM
  // level — confirms the button onClick fired with the right handler
  // even before React re-renders.
  const wrap = (label, fn) => () => {
    console.log('[webshell-diag] overlay button click', { label, at: Date.now() })
    fn()
  }
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
            onClick={wrap('Resume', onResume)}
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
            onClick={wrap('NewSession', onNewSession)}
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
            onClick={wrap('Dismiss', onDismiss)}
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
