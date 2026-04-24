// Facelift DetailPane — Phase 2 placeholder.
//
// The right-side master-detail pane. Phase 3 fills in the real tabs
// (Description / Comments / Activity / AI / Agent Log), URL binding, resize,
// and Cmd+Shift+Enter expand-to-modal.
//
// Phase 2 only: empty placeholder when open, nothing rendered when closed.

import { IconButton } from '../ui'
import { X } from 'lucide-react'

export default function DetailPane({ task, onClose }) {
  if (!task) return null

  return (
    <aside
      style={{
        gridArea: 'detail',
        borderLeft: 'var(--border-hairline)',
        background: 'var(--bg-card)',
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        overflow: 'hidden',
      }}
    >
      <header
        className="flex items-center justify-between shrink-0"
        style={{
          height: '48px',
          padding: '0 var(--space-3)',
          borderBottom: 'var(--border-hairline)',
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="truncate"
            style={{ fontSize: 'var(--text-caption2)', fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)' }}
          >
            {task.id}
          </span>
          <span
            className="truncate"
            style={{ fontSize: 'var(--text-footnote)', fontWeight: 'var(--font-semibold)', color: 'var(--text-app)' }}
          >
            {task.title}
          </span>
        </div>
        <IconButton size="sm" onClick={onClose} aria-label="Close detail" title="Close">
          <X className="w-4 h-4" />
        </IconButton>
      </header>

      <div
        className="flex-1 overflow-y-auto custom-scrollbar"
        style={{ padding: 'var(--space-4)' }}
      >
        <p style={{ fontSize: 'var(--text-caption1)', color: 'var(--text-muted)', fontStyle: 'italic' }}>
          Detail pane placeholder. Phase 3 adds tabs (Description / Comments / Activity / AI / Agent Log),
          URL binding, resize handle, and Cmd+Shift+Enter expand-to-focus-modal.
        </p>
      </div>
    </aside>
  )
}
