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

export const NODE_BOX = 48  // max-diameter wrapper, room for stroke

function TaskNode({ data }) {
  const { task, radius, isRoot, isHovered, dim, isOrphan } = data
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

  return (
    <div
      className="atrium-task-node"
      title={task.title}
      style={{
        width: NODE_BOX,
        height: NODE_BOX,
        position: 'relative',
        opacity: dim ? 0.22 : 1,
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
        <circle
          cx={NODE_BOX / 2}
          cy={NODE_BOX / 2}
          r={effectiveRadius}
          fill={fill}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeDasharray={strokeDasharray}
          opacity={isOrphan ? 0.85 : 1}
        />
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
