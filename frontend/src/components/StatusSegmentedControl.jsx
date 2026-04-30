// Inline status-changer for the DetailPane.
//
// Visual idiom is identical to ViewSwitcher.jsx (segmented pill,
// apple-segment + apple-press classes, var(--bg-card) raised active
// segment) so the DetailPane status row reads as the same kind of
// control the user already knows from the top toolbar's view switcher.
// Compact density (28px row, smaller icons + tighter padding) because
// the DetailPane is narrower than the top toolbar.
//
// Status set: the five canonical statuses (draft, todo, in_progress,
// review, done). `waiting_input` is auto-set by atrium_create_approval
// and is rendered by the parent (DetailPane) as a non-clickable badge
// instead of this control — see DetailPane.jsx for the gate.
//
// Behavior:
// - Clicking a non-active segment fires onChange(nextStatus). The
//   parent threads through to onUpdateTask({ ...task, status: next }),
//   which hits the existing PUT /api/tasks/:id pipeline. Backend
//   validators (branch-link, etc.) are the source of truth on whether
//   the transition is allowed; the UI doesn't try to second-guess.
// - On rejection, the upstream task prop comes back unchanged → the
//   active segment naturally re-renders showing the prior status.
//
// Status colors mirror TreeView.jsx where they overlap (todo Circle
// gray, in_progress Loader2 blue spin, review Eye orange, done
// CheckCircle2 green) so the DetailPane and the tree look consistent.

import { memo } from 'react'
import { Edit3, Circle, Loader2, Eye, CheckCircle2 } from 'lucide-react'

const STATUSES = [
  { id: 'draft', label: 'Draft', icon: Edit3, color: 'var(--text-muted)' },
  { id: 'todo', label: 'Todo', icon: Circle, color: 'var(--gray-1)' },
  { id: 'in_progress', label: 'In Progress', icon: Loader2, color: 'var(--apple-blue)', spin: true },
  { id: 'review', label: 'Review', icon: Eye, color: 'var(--apple-orange)' },
  { id: 'done', label: 'Done', icon: CheckCircle2, color: 'var(--apple-green)' },
]

function StatusSegmentedControl({ activeStatus, onChange }) {
  return (
    <div
      className="flex items-center gap-0.5"
      style={{
        padding: '3px',
        borderRadius: 'var(--radius-md)',
        background: 'var(--bg-secondary)',
        // Allow horizontal scroll on very narrow viewports rather
        // than wrapping (per task spec — keep the row visually
        // intact at 375px even if it requires scrolling).
        overflowX: 'auto',
        whiteSpace: 'nowrap',
      }}
      role="radiogroup"
      aria-label="Task status"
    >
      {/* eslint-disable-next-line no-unused-vars -- linter false-positive on the destructured rename `icon: Icon`; Icon IS used in the JSX below. Same workaround used in ViewSwitcher.jsx. */}
      {STATUSES.map(({ id, label, icon: Icon, color, spin }) => {
        const isActive = activeStatus === id
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => {
              if (!isActive) onChange(id)
            }}
            className="apple-segment apple-press flex items-center gap-1.5 facelift-pill shrink-0"
            style={{
              padding: '0 10px',
              height: '24px',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--text-caption2)',
              fontWeight: 'var(--font-medium)',
              color: isActive ? 'var(--text-app)' : 'var(--text-muted)',
              background: isActive ? 'var(--bg-card)' : 'transparent',
              cursor: isActive ? 'default' : 'pointer',
              border: 'none',
            }}
            title={label}
          >
            <Icon
              className={`w-3 h-3 ${isActive && spin ? 'animate-spin' : ''}`}
              style={{ color: isActive ? color : undefined }}
            />
            <span>{label}</span>
          </button>
        )
      })}
    </div>
  )
}

export default memo(StatusSegmentedControl)
