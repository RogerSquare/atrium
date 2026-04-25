// Edge construction + custom center-to-center edge for reactflow.
// Phase 2 of ui-graph-redesign-013.
//
// v1's visual grammar:
//   - depends_on edges: solid, colored by the dependent (target) category
//   - parent_task edges: dashed, muted, drawn underneath
//
// Reactflow's default edge routing connects handle anchors at node
// boundaries, which looks fine for orthogonal layouts but breaks the
// radial "spokes from a hub" feel. CenterEdge below draws a straight
// line between node centers regardless of handle position, which is
// what radialLayout assumes.

import { useInternalNode, getStraightPath } from '@xyflow/react'
import { categoryColor } from './categoryColors'

// Build a flat reactflow edges array from the graph model.
// Drawing order matters: parent_task edges first (rendered under) then
// depends_on edges (rendered over).
export function buildEdges({ parentEdges, depEdges }, { hoveredId } = {}) {
  const isEdgeDimmed = (from, to) =>
    hoveredId && hoveredId !== from && hoveredId !== to

  const edges = []

  for (const { from, to } of parentEdges) {
    const dim = isEdgeDimmed(from, to)
    edges.push({
      id: `p-${from}->${to}`,
      source: from,
      target: to,
      type: 'center',
      style: {
        stroke: 'var(--text-tertiary)',
        strokeWidth: 1,
        strokeDasharray: '3 3',
        opacity: dim ? 0.08 : 0.4,
      },
      data: { kind: 'parent' },
    })
  }

  for (const { from, to } of depEdges) {
    const dim = isEdgeDimmed(from, to)
    edges.push({
      id: `d-${from}->${to}`,
      source: from,
      target: to,
      type: 'center',
      style: {
        stroke: categoryColor(to),
        strokeWidth: 1.5,
        opacity: dim ? 0.1 : 0.7,
      },
      data: { kind: 'dep' },
      // Reactflow sorts by `zIndex`; depends_on overlays parent_task so
      // the colored chains read clearly when both edge kinds coexist.
      zIndex: 1,
    })
  }

  return edges
}

// Custom edge that draws a straight line between node centers using the
// node's measured bounding box. Falls back to handle-based routing if a
// node hasn't been measured yet (initial render before layout effect).
export function CenterEdge({ id, source, target, style, markerEnd }) {
  const sourceNode = useInternalNode(source)
  const targetNode = useInternalNode(target)
  if (!sourceNode || !targetNode) return null

  const sPos = sourceNode.internals.positionAbsolute
  const tPos = targetNode.internals.positionAbsolute
  const sw = sourceNode.measured?.width ?? 0
  const sh = sourceNode.measured?.height ?? 0
  const tw = targetNode.measured?.width ?? 0
  const th = targetNode.measured?.height ?? 0

  const sx = sPos.x + sw / 2
  const sy = sPos.y + sh / 2
  const tx = tPos.x + tw / 2
  const ty = tPos.y + th / 2

  const [path] = getStraightPath({ sourceX: sx, sourceY: sy, targetX: tx, targetY: ty })

  return (
    <path
      id={id}
      d={path}
      style={style}
      fill="none"
      markerEnd={markerEnd}
      className="react-flow__edge-path"
    />
  )
}

export const edgeTypes = {
  center: CenterEdge,
}
