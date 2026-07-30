// ShellManager — multi-instance host for ShellTerminal.
//
// Phase 3 of `feat-shell-background-sessions-001`. Keeps every task's
// xterm alive across activeTask changes so navigating between tasks no
// longer disposes the prior xterm + tears down its socket listeners.
// Combined with Phase 2's backend Map, this is the user-visible-value
// boundary: switching tasks leaves the prior claude session running and
// returning to it shows the live PTY with full scrollback.
//
// Design (per the plan's QP5 default):
//   - openTasks state grows as the user opens new task shells; it
//     never shrinks during a Shell-tab session. Closing the DetailPane
//     unmounts the manager and drops everything (Q4 default — "I'm
//     done with task work" signal). Phase 4 adds a per-task "close
//     session" affordance that removes a single entry.
//   - Renders ALL instances; only the one whose taskId === activeTask.id
//     is visible (CSS `display: block` vs `display: none`). NOT
//     conditional render — that would unmount xterm and defeat the
//     whole point.
//   - Passes `isActive={taskId === activeTask.id}` so each ShellTerminal
//     can re-fit + focus when it just became visible (ResizeObserver
//     doesn't fire on `display: none` elements).
//   - Mounted at DetailPane level so the manager survives switching
//     between Shell and other tabs within the same DetailPane. The
//     parent toggles its own visibility based on activeTab — that
//     keeps the xterms alive across tab nav too.

import { useState } from 'react'
import { X } from 'lucide-react'
import ShellTerminal from './Terminal'

export default function ShellManager({ activeTask, socket }) {
  // Tasks whose Shell tab has been opened in the current DetailPane
  // lifecycle. Append-only, deduped by id. We hold the original task
  // object (not just id) so each ShellTerminal still gets the prop
  // shape it expects (`{ id, title, ... }`).
  //
  // Update strategy: setState during render (with a guard) instead of
  // a useEffect. This is the React 18+ recommended pattern for state
  // derived from props — it avoids the cascading-render that the
  // react-hooks/set-state-in-effect rule flags, and the result is the
  // same: openTasks gets the new task before the children render.
  const [openTasks, setOpenTasks] = useState([])
  if (activeTask?.id && !openTasks.some((t) => t.id === activeTask.id)) {
    setOpenTasks([...openTasks, activeTask])
  }

  const activeId = activeTask?.id ?? null

  // Phase 4 — manual close affordance. Emits webshell:close on the wire;
  // the backend kills the active PTY and its onExit handler emits the
  // standard webshell:exit, which the existing recovery overlay handles.
  // We deliberately do NOT remove the entry from openTasks here — leaving
  // the ShellTerminal mounted lets the overlay show with Resume / Start
  // new / Dismiss, matching the UX of a natural claude exit.
  const handleCloseActive = () => {
    if (!activeId || !socket?.connected) return
    socket.emit('webshell:close', { taskId: activeId })
  }

  // Fragment with absolute-positioned children — the parent (DetailPane's
  // shell pane) provides the bounding box; each child fills it via inset:0.
  // The close button sits in the top-right corner above the active xterm
  // (z-index below the recovery overlay so it disappears when the overlay
  // arms — prevents double-clicks while a session is exiting).
  return (
    <>
      {openTasks.map((t) => {
        const isActive = t.id === activeId
        return (
          <div
            key={t.id}
            aria-hidden={!isActive}
            style={{
              position: 'absolute',
              inset: 0,
              display: isActive ? 'block' : 'none',
            }}
          >
            {/* Reserve the corner this component's close-session button
                occupies (right:4 + width:24 + 4px gap) so the terminal's own
                Copy button lands beside it rather than underneath it. */}
            <ShellTerminal task={t} socket={socket} isActive={isActive} topRightInset={32} />
          </div>
        )
      })}
      {activeId && (
        <button
          type="button"
          onClick={handleCloseActive}
          aria-label="Close session"
          title="Close session"
          className="apple-press"
          style={{
            position: 'absolute',
            top: 4,
            right: 4,
            zIndex: 5,
            width: 24,
            height: 24,
            padding: 0,
            border: 'none',
            background: 'rgba(0, 0, 0, 0.4)',
            color: 'rgba(255, 255, 255, 0.7)',
            borderRadius: 'var(--radius-sm)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </>
  )
}
