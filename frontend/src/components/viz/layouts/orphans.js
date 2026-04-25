// Orphan packer — places isolated tasks (no incoming OR outgoing edges) in
// a tight square grid inside their own visual region.
//
// Phase 4 of ui-graph-redesign-013. The user asked for orphans to remain
// on the canvas (rather than a side drawer) so the graph still represents
// every task connected via dependencies; orphans get their own framed
// "Unlinked · N" tile to signal "these have no relationships yet."
//
// Returns:
//   - positions: Map<id, {x, y}>  — local coords starting near (PADDING, PADDING)
//   - region:    { x, y, width, height, count } | null
//
// The caller offsets these coords to wherever it wants the region to sit
// in the global canvas. We don't apply the offset here so consumers can
// re-use the packer regardless of where they place the result.

const ORPHAN_NODE_SPACING = 56
const ORPHAN_REGION_PADDING = 32

export function packOrphans(orphanIds) {
  const positions = new Map()
  if (!orphanIds || orphanIds.length === 0) {
    return { positions, region: null }
  }

  const cols = Math.max(1, Math.ceil(Math.sqrt(orphanIds.length)))
  const rows = Math.ceil(orphanIds.length / cols)

  for (let i = 0; i < orphanIds.length; i++) {
    const col = i % cols
    const row = Math.floor(i / cols)
    positions.set(orphanIds[i], {
      x: ORPHAN_REGION_PADDING + col * ORPHAN_NODE_SPACING + ORPHAN_NODE_SPACING / 2,
      y: ORPHAN_REGION_PADDING + row * ORPHAN_NODE_SPACING + ORPHAN_NODE_SPACING / 2,
    })
  }

  const width = cols * ORPHAN_NODE_SPACING + ORPHAN_REGION_PADDING * 2
  const height = rows * ORPHAN_NODE_SPACING + ORPHAN_REGION_PADDING * 2

  return {
    positions,
    region: {
      x: 0,
      y: 0,
      width,
      height,
      count: orphanIds.length,
    },
  }
}
