// GlobalShellPanel — the global claude shell, docked into the right-hand side
// region rather than floating over the board as a modal.
//
// ONE OCCUPANT AT A TIME. The dock shows the task pane or this, never both.
// A third column was ruled out by arithmetic (DetailPane's minimum is 720px
// and the board reserves 400px, so three columns need 1840px before the
// terminal gets any usable width), and a vertical split was tried and
// rejected: it left the terminal in a short strip and made the region feel
// crowded rather than like a place you work.
//
// The covered task is NOT closed, only hidden, and `backgroundTask` surfaces
// it as a chip above the header. That is the whole difference between "the
// terminal closed my task" and "the terminal is in front of my task" — you
// keep your place, and one click hands the dock back.
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

import { useEffect, useState } from 'react'
import { X, ChevronLeft } from 'lucide-react'
import { io } from 'socket.io-client'
import ShellTerminal from '../web-shell/Terminal'
import CommandCard from '../web-shell/CommandCard'
import { GLOBAL_COMMANDS } from '../web-shell/globalCommands'
import { API_BASE, getStoredToken } from '../../config'

const GLOBAL_TASK = { id: '__global__', title: 'Global Shell' }

export default function GlobalShellPanel({
  onClose,
  narrow = false,
  // The task that was open when the shell took the dock. It is not closed,
  // only covered — this surfaces it so the thing you were working on stays
  // visible, and clicking it hands the dock straight back.
  backgroundTask = null,
  onReturnToTask = null,
  // Dock width, shared with DetailPane so the region keeps one size whichever
  // occupant is showing. Clamping + persistence stay in AppShell.
  width,
  onWidthChange,
}) {
  const [, setPopoverOpen] = useState(false)
  const [socket, setSocket] = useState(null)
  const [handleHover, setHandleHover] = useState(false)

  useEffect(() => {
    const s = io(API_BASE || window.location.origin, { auth: { token: getStoredToken() } })
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSocket(s)
    return () => {
      try { s.disconnect() } catch { /* already disconnected */ }
    }
  }, [])

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
        // Sole occupant of the dock — fill it.
        flex: 1,
        minHeight: 0,
        borderLeft: 'var(--border-hairline)',
        background: 'var(--bg-card)',
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        overflow: 'hidden',
        position: 'relative',
      }

  // Same per-drag listener pattern as DetailPane: closures over the start
  // point, removed by identity on mouseup, so no stale handler is left behind.
  const handleDragStart = (e) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = width
    const onMove = (ev) => onWidthChange?.(startWidth + (startX - ev.clientX))
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <section data-testid="global-shell-panel" aria-label="Global shell" style={style}>
      {/* Left-edge resize, mirroring DetailPane so the dock behaves the same
          whichever occupant is showing. Without this the region would be
          fixed-width whenever the shell is the one on top. */}
      {!narrow && onWidthChange && (
        <div
          data-testid="global-shell-resize-handle"
          onMouseDown={handleDragStart}
          onDoubleClick={() => onWidthChange?.(0)}
          onMouseEnter={() => setHandleHover(true)}
          onMouseLeave={() => setHandleHover(false)}
          title="Drag to resize · double-click to reset"
          aria-label="Resize side panel"
          role="separator"
          aria-orientation="vertical"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: '8px',
            cursor: 'col-resize',
            zIndex: 2,
            touchAction: 'none',
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: '1px',
              background: handleHover ? 'var(--accent-app)' : 'transparent',
              transition: 'background 120ms ease',
            }}
          />
        </div>
      )}

      {/* Back-chip — the task waiting behind the shell. Renders above the
          header so it reads as "you are on top of this", and clicking it
          hands the dock back rather than merely closing the terminal. */}
      {backgroundTask && (
        <button
          type="button"
          data-testid="global-shell-background-task"
          onClick={() => onReturnToTask?.()}
          title={`Back to ${backgroundTask.id}`}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            width: '100%',
            padding: '0 var(--space-3)',
            height: 30,
            flexShrink: 0,
            border: 'none',
            borderBottom: 'var(--border-hairline)',
            background: 'var(--bg-subtle, transparent)',
            color: 'var(--text-tertiary)',
            fontSize: 'var(--text-caption2)',
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <ChevronLeft className="w-3 h-3" style={{ flexShrink: 0 }} />
          <span style={{ flexShrink: 0, fontWeight: 'var(--font-semibold)' }}>{backgroundTask.id}</span>
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
            }}
          >
            {backgroundTask.title}
          </span>
        </button>
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
