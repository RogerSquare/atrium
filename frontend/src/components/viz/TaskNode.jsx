// Reactflow custom node — Phase 2 of ui-graph-redesign-013.
// Preserves v1's visual grammar: category-colored circle, parent nodes
// visibly larger (radius scales with out-degree), task id label below.
//
// Reactflow positions nodes by their top-left corner, but our radial
// layout produces center coordinates. The wrapper div is sized to the
// node's max diameter (NODE_BOX) so we can offset positions consistently
// in GraphView (subtract NODE_BOX/2 from each coord).

import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import { categoryColor } from './categoryColors'
import { statusColor } from './statusColors'
import { MERGE_STATUS } from '../../constants'

export const NODE_BOX = 48  // max-diameter wrapper, room for stroke

function TaskNode({ data }) {
  const { task, radius, isRoot, isHovered, dim, isOrphan, overlay } = data
  const fill = categoryColor(task.id)

  // Orphans render uniformly small with a dashed stroke — visually flagged
  // as "no relationships yet" without being hidden. Cap radius regardless
  // of what the layout asked for.
  const effectiveRadius = isOrphan ? 7 : radius

  // Stroke widens for the canvas anchor and on hover, matching v1.
  const strokeColor = isRoot || isHovered ? 'var(--text-app)' : 'var(--bg-card)'
  const baseStrokeWidth = isRoot ? 2.5 : isHovered ? 2 : 1.5
  const strokeWidth = isOrphan ? 1 : baseStrokeWidth
  const strokeDasharray = isOrphan ? '2 2' : undefined

  // Work overlay decorations (Phase 5). When `overlay` is present in data,
  // we add a status-tinted ring outside the main circle, a tiny corner dot
  // for tasks with a PR, and dim stale tasks (>30 days untouched).
  const overlayStatusColor = overlay ? statusColor(task.status) : null
  const prMeta = overlay?.prState ? MERGE_STATUS[overlay.prState] : null
  const baseOpacity = dim ? 0.22 : 1
  const wrapperOpacity = overlay?.isStale ? baseOpacity * 0.7 : baseOpacity

  // Position PR dot in the upper-right of the circle (45° offset).
  const center = NODE_BOX / 2
  const dotRadius = 3
  const dotOffset = effectiveRadius * 0.7071  // cos/sin 45°

  return (
    <div
      className="atrium-task-node"
      title={task.title}
      style={{
        width: NODE_BOX,
        height: NODE_BOX,
        position: 'relative',
        opacity: wrapperOpacity,
        // Reactflow tracks pointer events via the wrapper; the inner SVG
        // is the visual but the whole box is the click/hover target.
        cursor: 'pointer',
      }}
    >
      {/* Hidden handles at the center top/bottom — required so reactflow
          can register source/target connections. The custom CenterEdge
          ignores them and computes its own endpoints from node bounds. */}
      <Handle
        type="target"
        position={Position.Top}
        style={{ visibility: 'hidden', width: 0, height: 0, pointerEvents: 'none' }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ visibility: 'hidden', width: 0, height: 0, pointerEvents: 'none' }}
      />

      <svg
        width={NODE_BOX}
        height={NODE_BOX}
        viewBox={`0 0 ${NODE_BOX} ${NODE_BOX}`}
        style={{ overflow: 'visible', pointerEvents: 'none' }}
      >
        {/* Status ring — outer concentric circle, only when overlay is on.
            Drawn first so the main circle layers on top of its inner edge. */}
        {overlayStatusColor && (
          <circle
            cx={center}
            cy={center}
            r={effectiveRadius + 4}
            fill="none"
            stroke={overlayStatusColor}
            strokeWidth={2}
            opacity={0.85}
          />
        )}
        <circle
          cx={center}
          cy={center}
          r={effectiveRadius}
          fill={fill}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeDasharray={strokeDasharray}
          opacity={isOrphan ? 0.85 : 1}
        />
        {/* PR dot — upper-right corner, masked by a thin background ring so
            it doesn't blend into the status ring or the circle below. */}
        {prMeta && (
          <circle
            cx={center + dotOffset}
            cy={center - dotOffset}
            r={dotRadius}
            fill={prMeta.dotColor}
            stroke="var(--bg-card)"
            strokeWidth={1.5}
          />
        )}
      </svg>

      {/* Label escapes the wrapper bounds so node hover-targets stay tight
          to the circle while the id is still readable. */}
      <span
        style={{
          position: 'absolute',
          top: '100%',
          left: '50%',
          transform: 'translateX(-50%)',
          marginTop: 2,
          fontSize: 10,
          fontFamily: 'var(--font-sans)',
          color: isHovered ? 'var(--text-app)' : 'var(--text-muted)',
          fontWeight: isHovered || isRoot ? 600 : 400,
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      >
        {task.id}
      </span>
    </div>
  )
}

export default memo(TaskNode)
