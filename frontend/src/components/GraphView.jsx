// Facelift Phase 9 — GraphView (knowledge-graph rewrite).
//
// Obsidian/Roam-style network view. Circles sized by degree (more
// connections = bigger dot), force-directed layout via Fruchterman-
// Reingold, pan + zoom on the canvas, and hover-highlight that dims
// everything except the hovered node, its neighbors, and the edges
// between them. The goal is to make dependency paths readable at a
// glance without any hierarchical structure getting in the way.

import { memo, useMemo, useRef, useState, useCallback } from 'react'
import { STATUS_COLOR } from '../constants'

// ---- Simulation --------------------------------------------------------
const PADDING = 60
const ITERATIONS = 250
const K = 90                    // ideal edge length

// ---- Rendering ---------------------------------------------------------
const NODE_R_MIN = 5
const NODE_R_MAX = 16
const LABEL_FONT = 10
const ZOOM_MIN = 0.2
const ZOOM_MAX = 4

function buildGraph(tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const depEdges = []
  const parentEdges = []
  const degree = new Map()
  const neighbors = new Map() // id -> Set of connected ids
  const bump = (a, b) => {
    degree.set(a, (degree.get(a) || 0) + 1)
    degree.set(b, (degree.get(b) || 0) + 1)
    if (!neighbors.has(a)) neighbors.set(a, new Set())
    if (!neighbors.has(b)) neighbors.set(b, new Set())
    neighbors.get(a).add(b)
    neighbors.get(b).add(a)
  }

  for (const t of tasks) {
    for (const depId of t.depends_on || []) {
      if (!byId.has(depId) || depId === t.id) continue
      depEdges.push({ from: depId, to: t.id })
      bump(depId, t.id)
    }
    if (t.parent_task && byId.has(t.parent_task) && t.parent_task !== t.id) {
      parentEdges.push({ from: t.parent_task, to: t.id })
      bump(t.parent_task, t.id)
    }
  }

  const connected = tasks.filter((t) => (degree.get(t.id) || 0) > 0)
  return { connected, byId, depEdges, parentEdges, degree, neighbors }
}

function runForceLayout(nodes, edges) {
  const n = nodes.length
  if (n === 0) return new Map()

  const positions = new Map()
  const R = K * Math.sqrt(n) * 0.7
  nodes.forEach((node, i) => {
    const angle = (i / n) * Math.PI * 2
    const jitter = (Math.random() - 0.5) * 0.25
    positions.set(node.id, {
      x: Math.cos(angle + jitter) * R,
      y: Math.sin(angle + jitter) * R,
    })
  })

  const ids = nodes.map((node) => node.id)
  const T0 = R

  for (let iter = 0; iter < ITERATIONS; iter++) {
    const t = T0 * (1 - iter / ITERATIONS)
    const disp = new Map()
    for (const id of ids) disp.set(id, { x: 0, y: 0 })

    // Pair repulsion.
    for (let i = 0; i < n; i++) {
      const ai = ids[i]
      const a = positions.get(ai)
      const da = disp.get(ai)
      for (let j = i + 1; j < n; j++) {
        const bi = ids[j]
        const b = positions.get(bi)
        const db = disp.get(bi)
        const dx = a.x - b.x
        const dy = a.y - b.y
        let dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < 0.01) dist = 0.01
        const force = (K * K) / dist
        const ux = dx / dist
        const uy = dy / dist
        da.x += ux * force
        da.y += uy * force
        db.x -= ux * force
        db.y -= uy * force
      }
    }

    // Edge attraction.
    for (const e of edges) {
      const a = positions.get(e.from)
      const b = positions.get(e.to)
      if (!a || !b) continue
      const da = disp.get(e.from)
      const db = disp.get(e.to)
      const dx = a.x - b.x
      const dy = a.y - b.y
      let dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < 0.01) dist = 0.01
      const force = (dist * dist) / K
      const ux = dx / dist
      const uy = dy / dist
      da.x -= ux * force
      da.y -= uy * force
      db.x += ux * force
      db.y += uy * force
    }

    // Apply with temperature cap.
    for (const id of ids) {
      const p = positions.get(id)
      const d = disp.get(id)
      const mag = Math.sqrt(d.x * d.x + d.y * d.y) || 0.01
      const capped = Math.min(mag, t)
      p.x += (d.x / mag) * capped
      p.y += (d.y / mag) * capped
    }
  }

  return positions
}

// Map a raw degree to a node radius using a log-ish curve so high-degree
// hubs stand out without tiny-degree nodes vanishing.
function radiusFor(deg, maxDeg) {
  if (maxDeg <= 1) return NODE_R_MIN + 2
  const t = Math.log(1 + deg) / Math.log(1 + maxDeg)
  return NODE_R_MIN + t * (NODE_R_MAX - NODE_R_MIN)
}

function GraphView({ tasks, onSelectTask }) {
  const computed = useMemo(() => {
    const { connected, byId, depEdges, parentEdges, degree, neighbors } = buildGraph(tasks)
    if (connected.length === 0) {
      return { empty: true }
    }
    const positions = runForceLayout(connected, [...depEdges, ...parentEdges])

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const { x, y } of positions.values()) {
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
    const offsetX = -minX + PADDING
    const offsetY = -minY + PADDING
    for (const p of positions.values()) {
      p.x += offsetX
      p.y += offsetY
    }
    const width = maxX - minX + PADDING * 2
    const height = maxY - minY + PADDING * 2
    const maxDeg = Math.max(...Array.from(degree.values()))

    return {
      byId,
      positions,
      depEdges,
      parentEdges,
      neighbors,
      degree,
      maxDeg,
      worldWidth: width,
      worldHeight: height,
      empty: false,
    }
  }, [tasks])

  // ---- Viewport state (pan + zoom) -------------------------------------
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
    // Convert cursor to world coords BEFORE zoom so we can preserve the
    // cursor's anchor point after zooming.
    const cursorX = e.clientX - rect.left
    const cursorY = e.clientY - rect.top
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
    setZoom((prev) => {
      const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, prev * factor))
      setPan((prevPan) => {
        const scale = next / prev
        return {
          x: cursorX - scale * (cursorX - prevPan.x),
          y: cursorY - scale * (cursorY - prevPan.y),
        }
      })
      return next
    })
  }, [])

  const handlePointerDown = useCallback((e) => {
    if (e.target !== svgRef.current && !e.currentTarget.contains(e.target)) return
    // Only drag when clicking the background, not a node.
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

  if (!computed || computed.empty) {
    return (
      <div
        className="text-center py-12 italic"
        style={{ color: 'var(--text-muted)', fontSize: 'var(--text-subhead)' }}
      >
        {tasks.length === 0
          ? 'No tasks to graph.'
          : 'No dependencies yet. Set parent_task or depends_on on a few tasks to see them connected here.'}
      </div>
    )
  }

  const { byId, positions, depEdges, parentEdges, neighbors, degree, maxDeg, worldWidth, worldHeight } = computed

  const activeNeighbors = hoveredId ? (neighbors.get(hoveredId) || new Set()) : null
  const isDimmed = (id) => hoveredId && hoveredId !== id && !activeNeighbors.has(id)
  const isEdgeDimmed = (from, to) =>
    hoveredId && hoveredId !== from && hoveredId !== to

  const resetView = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  return (
    <div
      className="w-full h-full relative"
      style={{
        borderRadius: 'var(--radius-md)',
        border: 'var(--border-hairline)',
        background: 'var(--bg-card)',
        minHeight: 400,
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
        {/* Pan + zoom transform wrapper. We scale in screen space by reading
            the SVG's bounding rect in the wheel handler, but translate in
            user coordinates via this group transform. */}
        <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
          {/* Parent edges — dashed + muted. */}
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
                strokeOpacity={dim ? 0.08 : 0.45}
              />
            )
          })}
          {/* depends_on edges — solid accent. */}
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
                stroke="var(--accent-app)"
                strokeWidth={1.5 / zoom}
                strokeOpacity={dim ? 0.1 : 0.65}
              />
            )
          })}

          {/* Nodes */}
          {[...positions.entries()].map(([id, { x, y }]) => {
            const task = byId.get(id)
            if (!task) return null
            const r = radiusFor(degree.get(id) || 0, maxDeg)
            const statusColor = STATUS_COLOR[task.status] || 'var(--gray-1)'
            const dim = isDimmed(id)
            const isHovered = hoveredId === id
            const labelFontSize = LABEL_FONT / zoom
            return (
              <g
                key={id}
                onMouseEnter={() => setHoveredId(id)}
                onMouseLeave={() => setHoveredId(null)}
                onClick={() => onSelectTask?.(task)}
                style={{ cursor: 'pointer' }}
                opacity={dim ? 0.2 : 1}
              >
                <title>{task.title}</title>
                <circle
                  cx={x}
                  cy={y}
                  r={r}
                  fill={statusColor}
                  stroke={isHovered ? 'var(--accent-app)' : 'var(--bg-card)'}
                  strokeWidth={isHovered ? 2.5 / zoom : 1.5 / zoom}
                />
                <text
                  x={x}
                  y={y + r + labelFontSize + 2}
                  textAnchor="middle"
                  style={{
                    fontSize: `${labelFontSize}px`,
                    fontFamily: 'var(--font-sans)',
                    fill: isHovered ? 'var(--text-app)' : 'var(--text-muted)',
                    fontWeight: isHovered ? 600 : 400,
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
            width: 28,
            height: 28,
            borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-card)',
            border: 'var(--border-hairline)',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 600,
          }}
          title="Zoom in"
        >
          +
        </button>
        <button
          onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z / 1.25))}
          className="apple-press"
          style={{
            width: 28,
            height: 28,
            borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-card)',
            border: 'var(--border-hairline)',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 600,
          }}
          title="Zoom out"
        >
          −
        </button>
        <button
          onClick={resetView}
          className="apple-press"
          style={{
            width: 28,
            height: 28,
            borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-card)',
            border: 'var(--border-hairline)',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            fontSize: 10,
            fontWeight: 600,
          }}
          title="Reset view"
        >
          ⌂
        </button>
      </div>

      {/* Hint */}
      <div
        style={{
          position: 'absolute',
          bottom: 'var(--space-2)',
          left: 'var(--space-2)',
          fontSize: 'var(--text-caption2)',
          color: 'var(--text-tertiary)',
          pointerEvents: 'none',
        }}
      >
        scroll to zoom · drag to pan · hover a node to see its neighbors
      </div>
    </div>
  )
}

export default memo(GraphView)
