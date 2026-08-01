// Approvals inbox bell (ui-approvals-inbox-001, usability P0-4).
//
// Human-in-the-loop is Atrium's core value, yet a task sitting in
// waiting_input was nearly invisible in the default shell. This bell lives
// in the TopBar with a live count of waiting tasks; clicking it lists them
// and clicking a row opens the task in the DetailPane, where ApprovalPanel
// is now actionable.
//
// The count derives from the tasks the shell already holds — TaskContext
// live-updates them over the socket (taskUpdated / approvalCreated flows),
// so no extra fetch or subscription is needed here.

import { useEffect, useRef, useState } from 'react'
import { Bell } from 'lucide-react'

export default function ApprovalsBell({ tasks = [], onSelectTask }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)

  const waiting = tasks.filter((t) => t.status === 'waiting_input')

  // Click-outside to close — same pattern as AvatarPopover/ProjectAnchor.
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [open])

  const hasWaiting = waiting.length > 0

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="apple-press relative flex items-center justify-center"
        data-testid="approvals-bell"
        aria-label={hasWaiting ? `${waiting.length} task${waiting.length > 1 ? 's' : ''} waiting on your response` : 'Approvals'}
        aria-haspopup="menu"
        aria-expanded={open}
        title={hasWaiting ? `${waiting.length} waiting on you` : 'Approvals'}
        style={{
          width: 28,
          height: 28,
          padding: 0,
          borderRadius: 'var(--radius-sm)',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: hasWaiting ? 'var(--apple-yellow)' : 'var(--text-muted)',
        }}
      >
        <Bell className={`w-3.5 h-3.5 ${hasWaiting ? 'animate-gentle-pulse' : ''}`} />
        {hasWaiting && (
          <span
            data-testid="approvals-bell-count"
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              minWidth: 14,
              height: 14,
              padding: '0 3px',
              borderRadius: 'var(--radius-full)',
              background: 'var(--apple-yellow)',
              color: '#000',
              fontSize: '9px',
              fontWeight: 'var(--font-bold)',
              lineHeight: '14px',
              textAlign: 'center',
            }}
          >
            {waiting.length}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          data-testid="approvals-bell-menu"
          className="absolute z-50"
          style={{
            top: 'calc(100% + var(--space-1))',
            right: 0,
            width: '300px',
            padding: 'var(--space-1)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--bg-card)',
            border: 'var(--border-hairline)',
            boxShadow: 'var(--shadow-popover)',
          }}
        >
          <div
            style={{
              padding: 'var(--space-2)',
              fontSize: 'var(--text-caption1)',
              color: 'var(--text-muted)',
              borderBottom: 'var(--border-hairline)',
              marginBottom: 'var(--space-1)',
            }}
          >
            {hasWaiting ? 'Waiting on your response' : 'Approvals'}
          </div>
          {hasWaiting ? (
            waiting.map((t) => (
              <button
                key={t.id}
                role="menuitem"
                data-testid="approvals-bell-item"
                onClick={() => { setOpen(false); onSelectTask?.(t) }}
                className="apple-press w-full text-left"
                style={{
                  display: 'block',
                  padding: 'var(--space-2)',
                  borderRadius: 'var(--radius-sm)',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                <span
                  className="block truncate"
                  style={{ fontSize: 'var(--text-caption2)', fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)' }}
                >
                  {t.id}
                </span>
                <span
                  className="block truncate"
                  style={{ fontSize: 'var(--text-caption1)', color: 'var(--text-app)', fontWeight: 'var(--font-medium)' }}
                >
                  {t.title}
                </span>
              </button>
            ))
          ) : (
            <div style={{ padding: 'var(--space-3)', fontSize: 'var(--text-caption1)', color: 'var(--text-tertiary)', textAlign: 'center' }}>
              No tasks are waiting on you.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
