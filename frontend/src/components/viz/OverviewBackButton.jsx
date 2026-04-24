// "Back to overview" button — visible in the top-left of GraphView when a
// component is focused. Esc keybind does the same thing; this is the
// pointer-friendly equivalent.
//
// Phase 3 of ui-graph-redesign-013.

import { ArrowLeft } from 'lucide-react'

export default function OverviewBackButton({ onClick }) {
  return (
    <button
      onClick={onClick}
      className="apple-press"
      title="Back to overview (Esc)"
      style={{
        position: 'absolute',
        top: 'var(--space-2)',
        left: 'var(--space-2)',
        zIndex: 5,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        height: 28,
        borderRadius: 'var(--radius-sm)',
        background: 'var(--bg-card)',
        border: 'var(--border-hairline)',
        color: 'var(--text-app)',
        fontSize: 'var(--text-caption2)',
        fontWeight: 500,
        cursor: 'pointer',
      }}
    >
      <ArrowLeft size={14} />
      Overview
    </button>
  )
}
