// GraphView — radial tree (task ui-graph-redesign-012).
//
// Layout model:
//   - The task with the most children (combined parent_task + depends_on
//     in-edges) becomes the canvas center. "Main branch" sits in the middle.
//   - BFS outward assigns a depth to every reachable task; nodes are placed
//     on concentric rings keyed by depth. Children cluster around their
//     parent's angle so a subtree reads as a contiguous wedge.
//   - Tasks not reachable from the root (separate connected components,
//     true orphans, phase/plan/research nodes with no edges) are all still
//     shown — they land on a final outer ring so nothing disappears.
//
// Visual grammar:
//   - Node fill = task category color (feat/bug/ui/opt/devops/comp/mobile).
//   - Node radius scales with out-degree — parents are visibly bigger.
//   - depends_on edges: solid, at the category color of the dependent.
//   - parent_task edges: dashed, muted, drawn underneath.
//
// Navigation: drag to pan, scroll to zoom. No orphan filtering.

import { memo, useMemo, useRef, useState, useCallback } from 'react'

const CATEGORY_COLOR = {
  feat:   'var(--apple-blue)',
  bug:    'var(--apple-red)',
  ui:     'var(--apple-teal)',
  opt:    'var(--apple-orange)',
  devops: 'var(--apple-purple)',
  comp:   'var(--gray-1)',
  mobile: 'var(--apple-pink)',
}
const DEFAULT_COLOR = 'var(--gray-1)'

function categoryColor(taskId) {
  if (!taskId) return DEFAULT_COLOR
  const prefix = taskId.split('-')[0]?.toLowerCase()
  return CATEGORY_COLOR[prefix] || DEFAULT_COLOR
}

// Ring spacing — bigger at center, compressed as we go out so deep trees
// don't blow out the canvas.
function radiusForDepth(depth) {
  if (depth === 0) return 0
  // Diminishing returns: depth 1 = 160, 2 = 280, 3 = 380, 4 = 460, ...
  return 160 + 120 * Math.log2(depth + 1) * Math.sqrt(depth)
}

function nodeRadiusFor(childCount, maxChildCount) {
  const MIN = 7
  const MAX = 22
  if (maxChildCount <= 0) return MIN + 3
  // Log scale so a hub with 20 children doesn't dwarf a node with 2.
  const t = Math.log(1 + childCount) / Math.log(1 + maxChildCount)
  return MIN + t * (MAX - MIN)
}

// Build edges, adjacency, and child-count map from a flat task list.
function buildModel(tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const parentEdges = []  // parent_task: parent -> child
  const depEdges = []     // depends_on: blocker -> dependent
  const outDegree = new Map() // how many children/dependents this node has
  const neighbors = new Map() // id -> Set of connected ids (both directions)
  const children = new Map()  // id -> Set of downstream node ids

  const touch = (parent, child) => {
    outDegree.set(parent, (outDegree.get(parent) || 0) + 1)
    if (!neighbors.has(parent)) neighbors.set(parent, new Set())
    if (!neighbors.has(child)) neighbors.set(child, new Set())
    neighbors.get(parent).add(child)
    neighbors.get(child).add(parent)
    if (!children.has(parent)) children.set(parent, new Set())
    children.get(parent).add(child)
  }

  for (const t of tasks) {
    if (t.parent_task && byId.has(t.parent_task) && t.parent_task !== t.id) {
      parentEdges.push({ from: t.parent_task, to: t.id })
      touch(t.parent_task, t.id)
    }
    for (const depId of t.depends_on || []) {
      if (!byId.has(depId) || depId === t.id) continue
      depEdges.push({ from: depId, to: t.id })
      touch(depId, t.id)
    }
  }

  return { byId, parentEdges, depEdges, outDegree, neighbors, children }
}

// Find the task that should anchor the canvas — the one with the most
// downstream children. Ties broken by task id for stability.
function pickRoot(byId, outDegree) {
  let best = null
  let bestCount = -1
  for (const id of byId.keys()) {
    const count = outDegree.get(id) || 0
    if (count > bestCount || (count === bestCount && (!best || id < best))) {
      best = id
      bestCount = count
    }
  }
  return best
}

// Radial BFS from root. Each node gets a depth + an angle; children fan
// out inside the angular slice reserved for their parent.
function radialLayout(byId, children, neighbors, root) {
  const depth = new Map()
  const angle = new Map()
  const positions = new Map()
  if (!root) return positions

  depth.set(root, 0)
  angle.set(root, 0)
  positions.set(root, { x: 0, y: 0 })

  // Assign angles to children by recursing through the tree. Each child
  // receives a slice of its parent's arc proportional to its subtree size
  // so dense branches get visually more room than sparse ones.
  const subtreeSize = new Map()
  const computeSize = (id, visited) => {
    if (visited.has(id)) return 0
    visited.add(id)
    let size = 1
    const kids = children.get(id)
    if (kids) for (const c of kids) size += computeSize(c, visited)
    subtreeSize.set(id, size)
    return size
  }
  computeSize(root, new Set())

  const assign = (id, startAngle, endAngle, d, visited) => {
    if (visited.has(id)) return
    visited.add(id)
    const mid = (startAngle + endAngle) / 2
    depth.set(id, d)
    angle.set(id, mid)
    const r = radiusForDepth(d)
    positions.set(id, { x: Math.cos(mid) * r, y: Math.sin(mid) * r })

    const kids = [...(children.get(id) || [])].filter((k) => !visited.has(k))
    if (kids.length === 0) return

    // Split the arc proportionally among children by subtree size.
    const totalSize = kids.reduce((s, k) => s + (subtreeSize.get(k) || 1), 0)
    const arcSpan = endAngle - startAngle
    let cursor = startAngle
    for (const k of kids) {
      const ks = subtreeSize.get(k) || 1
      const span = (ks / totalSize) * arcSpan
      assign(k, cursor, cursor + span, d + 1, visited)
      cursor += span
    }
  }

  const visited = new Set()
  // Root gets full 360° sweep.
  assign(root, -Math.PI, Math.PI, 0, visited)

  // Anything not visited from the root lives in its own island. Give each
  // island a small sub-sweep and place it on a ring beyond the farthest
  // reached depth, so they're visible but clearly separate from the main tree.
  const unreached = [...byId.keys()].filter((id) => !visited.has(id))
  if (unreached.length > 0) {
    const outerDepth = Math.max(...[...depth.values()], 0) + 1
    const outerR = radiusForDepth(outerDepth) + 80
    const step = (Math.PI * 2) / unreached.length
    unreached.forEach((id, i) => {
      const a = i * step - Math.PI
      depth.set(id, outerDepth)
      angle.set(id, a)
      positions.set(id, { x: Math.cos(a) * outerR, y: Math.sin(a) * outerR })
    })
  }

  return positions
}

// ---- Component ---------------------------------------------------------

const ZOOM_MIN = 0.15
const ZOOM_MAX = 5

function GraphView({ tasks, onSelectTask }) {
  const model = useMemo(() => {
    if (!tasks || tasks.length === 0) return null
    const { byId, parentEdges, depEdges, outDegree, neighbors, children } = buildModel(tasks)
    const rootId = pickRoot(byId, outDegree)
    const positions = radialLayout(byId, children, neighbors, rootId)

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const { x, y } of positions.values()) {
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
    const PAD = 80
    const offsetX = -minX + PAD
    const offsetY = -minY + PAD
    for (const p of positions.values()) {
      p.x += offsetX
      p.y += offsetY
    }
    const width = (maxX - minX) + PAD * 2
    const height = (maxY - minY) + PAD * 2
    const maxChildren = Math.max(1, ...Array.from(outDegree.values()))

    return {
      byId,
      positions,
      parentEdges,
      depEdges,
      outDegree,
      neighbors,
      rootId,
      maxChildren,
      worldWidth: width,
      worldHeight: height,
    }
  }, [tasks])

  // Viewport state (pan + zoom).
  const svgRef = useRef(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const dragRef = useRef(null)
  const [hoveredId, setHoveredId] = useState(null)

  const handleWheel = useCallback((e) => {
    e.preventDefault()
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
    setZoom((prev) => {
      const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, prev * factor))
      const scale = next / prev
      setPan((prevPan) => ({
        x: cx - scale * (cx - prevPan.x),
        y: cy - scale * (cy - prevPan.y),
      }))
      return next
    })
  }, [])

  const handlePointerDown = useCallback((e) => {
    if (e.target.tagName === 'circle' || e.target.tagName === 'text') return
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }, [pan])

  const handlePointerMove = useCallback((e) => {
    if (!dragRef.current) return
    const dx = e.clientX - dragRef.current.startX
    const dy = e.clientY - dragRef.current.startY
    setPan({ x: dragRef.current.panX + dx, y: dragRef.current.panY + dy })
  }, [])

  const handlePointerUp = useCallback((e) => {
    dragRef.current = null
    e.currentTarget.releasePointerCapture?.(e.pointerId)
  }, [])

  const resetView = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  if (!model) {
    return (
      <div
        className="text-center py-12 italic"
        style={{ color: 'var(--text-muted)', fontSize: 'var(--text-subhead)' }}
      >
        No tasks to graph.
      </div>
    )
  }

  const {
    byId, positions, parentEdges, depEdges,
    outDegree, neighbors, rootId, maxChildren,
    worldWidth, worldHeight,
  } = model

  const activeNeighbors = hoveredId ? (neighbors.get(hoveredId) || new Set()) : null
  const isDimmed = (id) => hoveredId && hoveredId !== id && !activeNeighbors.has(id)
  const isEdgeDimmed = (from, to) =>
    hoveredId && hoveredId !== from && hoveredId !== to

  return (
    <div
      className="w-full h-full relative"
      style={{
        borderRadius: 'var(--radius-md)',
        border: 'var(--border-hairline)',
        background: 'var(--bg-card)',
        minHeight: 420,
        overflow: 'hidden',
      }}
    >
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        viewBox={`0 0 ${worldWidth} ${worldHeight}`}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        style={{
          display: 'block',
          cursor: dragRef.current ? 'grabbing' : 'grab',
          touchAction: 'none',
        }}
      >
        <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
          {/* Depth rings — a quiet visual anchor so the radial structure
              reads even when the tree is sparse. */}
          {(() => {
            const root = positions.get(rootId)
            if (!root) return null
            const depths = [1, 2, 3, 4]
            return depths.map((d) => (
              <circle
                key={`ring-${d}`}
                cx={root.x}
                cy={root.y}
                r={radiusForDepth(d)}
                fill="none"
                stroke="var(--separator)"
                strokeWidth={0.5 / zoom}
                strokeOpacity={0.5}
              />
            ))
          })()}

          {/* parent_task edges: dashed, muted, underneath. */}
          {parentEdges.map(({ from, to }) => {
            const a = positions.get(from)
            const b = positions.get(to)
            if (!a || !b) return null
            const dim = isEdgeDimmed(from, to)
            return (
              <line
                key={`p-${from}->${to}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="var(--text-tertiary)"
                strokeWidth={1 / zoom}
                strokeDasharray={`${3 / zoom} ${3 / zoom}`}
                strokeOpacity={dim ? 0.08 : 0.4}
              />
            )
          })}
          {/* depends_on edges: solid, tinted with the dependent's category. */}
          {depEdges.map(({ from, to }) => {
            const a = positions.get(from)
            const b = positions.get(to)
            if (!a || !b) return null
            const dim = isEdgeDimmed(from, to)
            return (
              <line
                key={`d-${from}->${to}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={categoryColor(to)}
                strokeWidth={1.5 / zoom}
                strokeOpacity={dim ? 0.1 : 0.7}
              />
            )
          })}

          {/* Nodes */}
          {[...positions.entries()].map(([id, { x, y }]) => {
            const task = byId.get(id)
            if (!task) return null
            const childCount = outDegree.get(id) || 0
            const r = nodeRadiusFor(childCount, maxChildren)
            const fill = categoryColor(id)
            const dim = isDimmed(id)
            const isHovered = hoveredId === id
            const isRoot = id === rootId
            const labelFontSize = 10 / zoom

            return (
              <g
                key={id}
                onMouseEnter={() => setHoveredId(id)}
                onMouseLeave={() => setHoveredId(null)}
                onClick={() => onSelectTask?.(task)}
                style={{ cursor: 'pointer' }}
                opacity={dim ? 0.22 : 1}
              >
                <title>{task.title}</title>
                <circle
                  cx={x}
                  cy={y}
                  r={r}
                  fill={fill}
                  stroke={isRoot || isHovered ? 'var(--text-app)' : 'var(--bg-card)'}
                  strokeWidth={(isRoot ? 2.5 : isHovered ? 2 : 1.5) / zoom}
                />
                <text
                  x={x}
                  y={y + r + labelFontSize + 2}
                  textAnchor="middle"
                  style={{
                    fontSize: `${labelFontSize}px`,
                    fontFamily: 'var(--font-sans)',
                    fill: isHovered ? 'var(--text-app)' : 'var(--text-muted)',
                    fontWeight: isHovered || isRoot ? 600 : 400,
                    pointerEvents: 'none',
                  }}
                >
                  {task.id}
                </text>
              </g>
            )
          })}
        </g>
      </svg>

      {/* Controls overlay */}
      <div
        style={{
          position: 'absolute',
          top: 'var(--space-2)',
          right: 'var(--space-2)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-1)',
        }}
      >
        <button
          onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z * 1.25))}
          className="apple-press"
          style={{
            width: 28, height: 28,
            borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-card)',
            border: 'var(--border-hairline)',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            fontSize: 14, fontWeight: 600,
          }}
          title="Zoom in"
        >+</button>
        <button
          onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z / 1.25))}
          className="apple-press"
          style={{
            width: 28, height: 28,
            borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-card)',
            border: 'var(--border-hairline)',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            fontSize: 14, fontWeight: 600,
          }}
          title="Zoom out"
        >−</button>
        <button
          onClick={resetView}
          className="apple-press"
          style={{
            width: 28, height: 28,
            borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-card)',
            border: 'var(--border-hairline)',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            fontSize: 10, fontWeight: 600,
          }}
          title="Reset view"
        >⌂</button>
      </div>

      {/* Category legend */}
      <div
        style={{
          position: 'absolute',
          bottom: 'var(--space-2)',
          left: 'var(--space-2)',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 'var(--space-2)',
          fontSize: 'var(--text-caption2)',
          color: 'var(--text-tertiary)',
          pointerEvents: 'none',
          maxWidth: 'calc(100% - 80px)',
        }}
      >
        {Object.entries(CATEGORY_COLOR).map(([key, color]) => (
          <span key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
            {key}
          </span>
        ))}
      </div>
    </div>
  )
}

export default memo(GraphView)
