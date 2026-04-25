// Work-overlay toggle — top-right pill that flips per-node decorations on:
// status-ring, PR dot, and recency fade. Phase 5 of ui-graph-redesign-013.
//
// Default state is OFF so the graph reads as a clean dependency map first.
// Persists in component state only — no localStorage; users opt in per
// session.

import { Activity } from 'lucide-react'

export default function WorkOverlayToggle({ active, onToggle }) {
  return (
    <button
      onClick={onToggle}
      className="apple-press"
      title={active ? 'Hide work overlay' : 'Show work overlay (status, PR, recency)'}
      aria-pressed={active}
      style={{
        position: 'absolute',
        top: 'var(--space-2)',
        right: 'var(--space-2)',
        zIndex: 5,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        height: 28,
        borderRadius: 'var(--radius-sm)',
        background: active ? 'var(--accent-app)' : 'var(--bg-card)',
        border: 'var(--border-hairline)',
        color: active ? 'var(--text-on-accent, white)' : 'var(--text-muted)',
        fontSize: 'var(--text-caption2)',
        fontWeight: 500,
        cursor: 'pointer',
        transition: 'background 120ms ease, color 120ms ease',
      }}
    >
      <Activity size={14} />
      Work
    </button>
  )
}
