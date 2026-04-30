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

  // Fragment with absolute-positioned children — the parent (DetailPane's
  // shell pane) provides the bounding box; each child fills it via inset:0.
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
            <ShellTerminal task={t} socket={socket} isActive={isActive} />
          </div>
        )
      })}
    </>
  )
}
