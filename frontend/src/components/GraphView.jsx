// GraphView — radial tree (task ui-graph-redesign-012, refactored in -013 phase 1).
//
// Phase 1 of ui-graph-redesign-013 extracted the pure graph model + layout
// math into sibling modules under `./viz/`. This file now owns the rendering,
// viewport, and interaction glue only. Visual output is unchanged.
//
// Visual grammar:
//   - Node fill = task category color (feat/bug/ui/opt/devops/comp/mobile).
//   - Node radius scales with out-degree — parents are visibly bigger.
//   - depends_on edges: solid, at the category color of the dependent.
//   - parent_task edges: dashed, muted, drawn underneath.
//
// Navigation: drag to pan, scroll to zoom. No orphan filtering.

import { memo, useMemo, useRef, useState, useCallback } from 'react'
import { buildModel, pickRoot } from './viz/graphModel'
import { radialLayout, radiusForDepth } from './viz/layouts/radial'

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

function nodeRadiusFor(childCount, maxChildCount) {
  const MIN = 7
  const MAX = 22
  if (maxChildCount <= 0) return MIN + 3
  // Log scale so a hub with 20 children doesn't dwarf a node with 2.
  const t = Math.log(1 + childCount) / Math.log(1 + maxChildCount)
  return MIN + t * (MAX - MIN)
}

// ---- Component ---------------------------------------------------------

const ZOOM_MIN = 0.15
const ZOOM_MAX = 5

function GraphView({ tasks, onSelectTask }) {
  const model = useMemo(() => {
    if (!tasks || tasks.length === 0) return null
    const model = buildModel(tasks)
    const { byId, parentEdges, depEdges, outDegree, neighbors } = model
    const rootId = pickRoot(byId, outDegree)
    const positions = radialLayout(model, rootId)

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
