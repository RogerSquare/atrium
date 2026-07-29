// GlobalShellPanel — the global claude shell, docked into the right-hand
// side region alongside the task DetailPane instead of floating as a modal.
//
// WHY A DOCK RATHER THAN A THIRD COLUMN: DetailPane's minimum width is 720px
// and the board reserves MIN_FOCAL (400px), so board + task + terminal
// side-by-side needs 1840px before the terminal gets a single usable column.
// Sharing one side region splits it vertically instead — task on top,
// terminal below — which keeps the terminal at the dock's full width
// (720px is roughly 100 columns) on any screen that could show the task
// pane at all.
//
// Reuses the same ShellTerminal + CommandCard as the DetailPane Shell tab.
// The synthetic task `{ id: '__global__' }` flows through both: ShellTerminal
// reads `__global__` as a signal to skip the task-YAML write path (see
// Terminal.jsx → GLOBAL_TASK_ID) and CommandCard gets the creation-oriented
// GLOBAL_COMMANDS plus a headerLabel override.
//
// SOCKET LIFECYCLE (unchanged from the modal, and load-bearing): this panel
// opens its OWN socket.io connection. backend/sockets/web-shell.js caps to
// ONE PTY per socket, so sharing AuthContext's socket with the DetailPane
// Shell tab makes the second `webshell:start` kill the first PTY — both
// xterms then hear the same byte stream (visible as claude's banner from one
// shell smearing into the other). The dedicated socket disconnects on
// unmount, releasing the global PTY and leaving the task shell untouched.
//
// NO ESC-TO-CLOSE, deliberately — and this differs from the modal it
// replaces. Esc is a key the terminal needs: it leaves insert mode in vim and
// interrupts prompts in claude. A floating modal could justify swallowing it;
// a docked panel you type into all session cannot. Close via the X button.

import { useEffect, useState, useCallback, useRef } from 'react'
import { X, GripHorizontal } from 'lucide-react'
import { io } from 'socket.io-client'
import ShellTerminal from '../web-shell/Terminal'
import CommandCard from '../web-shell/CommandCard'
import { GLOBAL_COMMANDS } from '../web-shell/globalCommands'
import { API_BASE } from '../../config'

const GLOBAL_TASK = { id: '__global__', title: 'Global Shell' }

export default function GlobalShellPanel({
  onClose,
  narrow = false,
  // Present only when a task is open too — then this panel takes a fixed
  // height at the bottom of the dock and the divider becomes draggable.
  height = null,
  onHeightChange = null,
}) {
  const [, setPopoverOpen] = useState(false)
  const [socket, setSocket] = useState(null)
  const [dragging, setDragging] = useState(false)
  const panelRef = useRef(null)

  useEffect(() => {
    const s = io(API_BASE || window.location.origin)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSocket(s)
    return () => {
      try { s.disconnect() } catch { /* already disconnected */ }
    }
  }, [])

  // Vertical resize. Listeners live for the duration of a drag only, so no
  // global mousemove handler is running while the user is just typing.
  const startDrag = useCallback((e) => {
    if (!onHeightChange) return
    e.preventDefault()
    setDragging(true)
    const startY = e.clientY
    const startHeight = panelRef.current?.getBoundingClientRect().height ?? height ?? 320

    const onMove = (ev) => {
      // Dragging up grows the terminal, which is the direction that matches
      // the handle sitting on its top edge.
      onHeightChange(startHeight + (startY - ev.clientY))
    }
    const onUp = () => {
      setDragging(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [onHeightChange, height])

  const splitMode = !narrow && height != null

  const style = narrow
    ? {
        position: 'fixed',
        inset: 0,
        zIndex: 45,
        background: 'var(--bg-card)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }
    : {
        // In split mode the height is driven by the parent; alone in the dock
        // it simply fills the column.
        ...(splitMode ? { height, flexShrink: 0 } : { flex: 1, minHeight: 0 }),
        borderLeft: 'var(--border-hairline)',
        borderTop: splitMode ? 'var(--border-hairline)' : 'none',
        background: 'var(--bg-card)',
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        overflow: 'hidden',
        position: 'relative',
      }

  return (
    <section ref={panelRef} data-testid="global-shell-panel" aria-label="Global shell" style={style}>
      {/* Divider — only when sharing the dock with a task. Doubles as the
          drag handle so there is no separate hit target to find. */}
      {splitMode && (
        <div
          data-testid="global-shell-resize-handle"
          onMouseDown={startDrag}
          onDoubleClick={() => onHeightChange?.(320)}
          title="Drag to resize · double-click to reset"
          style={{
            height: 8,
            marginTop: -4,
            marginBottom: -4,
            cursor: 'row-resize',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            zIndex: 1,
            color: dragging ? 'var(--accent-app)' : 'var(--text-quaternary)',
          }}
        >
          <GripHorizontal className="w-3 h-3" />
        </div>
      )}

      <header
        style={{
          height: 40,
          padding: '0 var(--space-3)',
          borderBottom: 'var(--border-hairline)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
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
          Global Shell
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close global shell"
          title="Close"
          className="apple-press"
          style={{
            width: 28,
            height: 28,
            padding: 0,
            border: 'none',
            background: 'transparent',
            color: 'var(--text-tertiary)',
            cursor: 'pointer',
            borderRadius: 'var(--radius-sm)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <X className="w-4 h-4" />
        </button>
      </header>

      {/* Body — mirrors the DetailPane Shell tab exactly: an absolutely
          positioned container providing the positioning context for the
          floating CommandCard, with the terminal layer reserving the bottom
          56px so claude's status row never sits under the pill. */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <div style={{ position: 'absolute', inset: 'var(--space-3)' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 56 }}>
            <ShellTerminal task={GLOBAL_TASK} socket={socket} />
          </div>
          <CommandCard
            task={GLOBAL_TASK}
            commands={GLOBAL_COMMANDS}
            headerLabel="Global Shell"
            onOpenChange={setPopoverOpen}
          />
        </div>
      </div>
    </section>
  )
}
