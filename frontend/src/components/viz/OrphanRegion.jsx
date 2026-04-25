// OrphanRegion — synthetic reactflow node that renders a framed "Unlinked"
// backdrop behind the orphan task cluster. Phase 4 of ui-graph-redesign-013.
//
// This is a decoration, not a real task. It's:
//   - Positioned by GraphView at the orphan packer's region offset
//   - Sized to fit the orphan grid (width/height come via data)
//   - Placed first in the nodes array so reactflow renders it behind tasks
//   - Pointer-events disabled so hover/click on orphan tasks passes through
//   - Marked non-selectable so reactflow doesn't try to manage it as a task

import { memo } from 'react'

function OrphanRegion({ data }) {
  const { width, height, count } = data
  return (
    <div
      style={{
        width,
        height,
        borderRadius: 'var(--radius-md)',
        border: '1.5px dashed var(--separator)',
        background: 'rgba(127, 127, 127, 0.04)',
        pointerEvents: 'none',
        position: 'relative',
        boxSizing: 'border-box',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 10,
          left: 14,
          fontSize: 10,
          fontFamily: 'var(--font-sans)',
          color: 'var(--text-tertiary)',
          fontWeight: 500,
          letterSpacing: '0.3px',
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
        }}
      >
        Unlinked · {count}
      </span>
    </div>
  )
}

export default memo(OrphanRegion)
