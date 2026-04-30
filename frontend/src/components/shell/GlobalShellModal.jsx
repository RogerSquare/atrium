// GlobalShellModal — top-bar-launched claude shell oriented around
// creation flows ("new project", "new unassigned task", "start
// research/plan/implement", "show backlog").
//
// Reuses the same ShellTerminal + CommandCard the DetailPane Shell
// tab uses. The synthetic task `{ id: '__global__', title: 'Global
// Shell' }` flows through both: ShellTerminal sees `__global__` as a
// signal to skip the task-YAML write path (see Terminal.jsx →
// GLOBAL_TASK_ID) and CommandCard receives the creation-oriented
// GLOBAL_COMMANDS plus a headerLabel override.
//
// Close affordances: X button, Esc key, backdrop click. When the
// CommandCard popover is open, the first Esc closes the popover (its
// own handler) and a second Esc closes the modal (this component's
// handler is gated on `popoverOpen`).

import { useCallback, useEffect, useState } from 'react'
import { X } from 'lucide-react'
import ShellTerminal from '../web-shell/Terminal'
import CommandCard from '../web-shell/CommandCard'
import { GLOBAL_COMMANDS } from '../web-shell/globalCommands'

const GLOBAL_TASK = { id: '__global__', title: 'Global Shell' }

export default function GlobalShellModal({ socket, onClose }) {
  const [popoverOpen, setPopoverOpen] = useState(false)

  // Esc closes the modal — but only when the CommandCard popover is
  // closed. The popover registers its own Esc handler while open;
  // both handlers fire on the same keypress, so we gate this one on
  // `popoverOpen` to enforce "first Esc closes popover, second Esc
  // closes modal." Capture phase = false (default) so the popover's
  // Esc handler runs first via mount-order; by the time this handler
  // fires the popover has already setIsOpen(false), but `popoverOpen`
  // is still its prior value (the React state update hasn't flushed
  // for this tick), so the modal correctly skips on this keypress.
  // The next Esc finds popoverOpen === false and dismisses the modal.
  useEffect(() => {
    const handler = (e) => {
      if (e.key !== 'Escape') return
      if (popoverOpen) return
      e.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [popoverOpen, onClose])

  // Lock body scroll while the modal is open. Mirrors ModalOverlay's
  // pattern so other modal-aware affordances (e.g. the global `?`
  // help shortcut in AppShell) suppress themselves while we're up.
  useEffect(() => {
    const original = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.body.classList.add('modal-open')
    return () => {
      document.body.style.overflow = original
      document.body.classList.remove('modal-open')
    }
  }, [])

  const handleBackdropMouseDown = useCallback((e) => {
    // Only dismiss when the click landed on the backdrop itself —
    // clicks inside the modal content shouldn't bubble up and close it.
    if (e.target !== e.currentTarget) return
    if (popoverOpen) return
    onClose()
  }, [popoverOpen, onClose])

  return (
    <div
      onMouseDown={handleBackdropMouseDown}
      role="dialog"
      aria-modal="true"
      aria-label="Global shell"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        background: 'rgba(0, 0, 0, 0.55)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-4)',
      }}
    >
      <div
        style={{
          width: 'min(80vw, 1100px)',
          height: 'min(80vh, 800px)',
          background: 'var(--bg-card)',
          border: 'var(--border-hairline)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-popover)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {/* Header — title + close button */}
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
            aria-label="Close"
            title="Close (Esc)"
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

        {/* Body — mirrors DetailPane Shell tab layout exactly:
            outer absolute-positioned container (provides relative
            positioning context for the floating CommandCard), with the
            terminal layer reserving the bottom 56px for the pill so
            claude's status row never overlaps the button. */}
        <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
          <div style={{ position: 'absolute', inset: 'var(--space-4)' }}>
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
      </div>
    </div>
  )
}
