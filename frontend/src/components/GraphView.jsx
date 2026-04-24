// Facelift Phase 9 — GraphView (force-directed rewrite).
//
// Tasks float freely in a circular cloud. A Fruchterman-Reingold-ish
// force simulation — repulsion between every pair + attraction along
// each edge + mild center gravity — settles the graph over ~300
// iterations before render, so connected clusters naturally gravitate
// toward each other and unrelated chains drift apart.
//
// Orphans (no edges in or out) are hidden — a dependency graph with
// unconnected singletons is just noise. Use Board/List for those.

import { memo, useMemo } from 'react'
import { STATUS_COLOR } from '../constants'

const NODE_W = 72
const NODE_H = 22
const PADDING = 40           // canvas padding around the settled cloud
const ITERATIONS = 300
const IDEAL_EDGE_LEN = 90    // target distance between connected nodes
const REPULSION_K = 95       // pair-repulsion constant
const CENTER_GRAVITY = 0.004 // pull toward (0, 0) each iteration

function buildGraph(tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const depEdges = []
  const parentEdges = []
  const anyIn = new Map()
  const anyOut = new Map()

  for (const t of tasks) {
    for (const depId of t.depends_on || []) {
      if (!byId.has(depId) || depId === t.id) continue
      depEdges.push({ from: depId, to: t.id })
      anyIn.set(t.id, true)
      anyOut.set(depId, true)
    }
    if (t.parent_task && byId.has(t.parent_task) && t.parent_task !== t.id) {
      parentEdges.push({ from: t.parent_task, to: t.id })
      anyIn.set(t.id, true)
      anyOut.set(t.parent_task, true)
    }
  }

  // Keep only nodes that participate in an edge — orphans don't belong in a
  // dependency graph and just crowd the canvas.
  const connected = tasks.filter((t) => anyIn.get(t.id) || anyOut.get(t.id))
  return { connected, byId, depEdges, parentEdges }
}

function runForceLayout(nodes, edges) {
  if (nodes.length === 0) return new Map()

  // Seed positions on a circle so the simulation starts with something stable.
  const positions = new Map()
  const R = Math.max(120, nodes.length * 8)
  nodes.forEach((n, i) => {
    const a = (i / nodes.length) * Math.PI * 2
    positions.set(n.id, { x: Math.cos(a) * R, y: Math.sin(a) * R })
  })

  const ids = nodes.map((n) => n.id)
  const n = ids.length

  for (let iter = 0; iter < ITERATIONS; iter++) {
    // Alpha cools over time so late iterations make only fine adjustments.
    const alpha = 1 - iter / ITERATIONS

    // Pair repulsion (O(n²) — fine up to a few hundred nodes).
    for (let i = 0; i < n; i++) {
      const a = positions.get(ids[i])
      for (let j = i + 1; j < n; j++) {
        const b = positions.get(ids[j])
        const dx = b.x - a.x
        const dy = b.y - a.y
        const distSq = dx * dx + dy * dy || 0.01
        const dist = Math.sqrt(distSq)
        const force = (REPULSION_K * REPULSION_K) / dist
        const fx = (dx / dist) * force * alpha
        const fy = (dy / dist) * force * alpha
        a.x -= fx
        a.y -= fy
        b.x += fx
        b.y += fy
      }
    }

    // Edge attraction pulls connected nodes toward each other.
    for (const e of edges) {
      const a = positions.get(e.from)
      const b = positions.get(e.to)
      if (!a || !b) continue
      const dx = b.x - a.x
      const dy = b.y - a.y
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01
      const force = (dist * dist) / IDEAL_EDGE_LEN
      const fx = (dx / dist) * force * alpha * 0.5
      const fy = (dy / dist) * force * alpha * 0.5
      a.x += fx
      a.y += fy
      b.x -= fx
      b.y -= fy
    }

    // Gentle center gravity so the cloud doesn't drift off into infinity.
    for (const id of ids) {
      const p = positions.get(id)
      p.x *= 1 - CENTER_GRAVITY
      p.y *= 1 - CENTER_GRAVITY
    }
  }

  return positions
}

function GraphView({ tasks, onSelectTask }) {
  const { byId, positions, depLines, parentLines, viewBox, isEmpty } = useMemo(() => {
    const { connected, byId, depEdges, parentEdges } = buildGraph(tasks)
    if (connected.length === 0) {
      return { byId, positions: new Map(), depLines: [], parentLines: [], viewBox: '0 0 400 200', isEmpty: true }
    }

    // Run simulation over both edge kinds (parent edges pull like deps).
    const allEdges = [...depEdges, ...parentEdges]
    const positions = runForceLayout(connected, allEdges)

    // Compute bounding box + translate to positive quadrant so SVG renders.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const { x, y } of positions.values()) {
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
    // Shift so origin is top-left with padding.
    const offsetX = -minX + PADDING
    const offsetY = -minY + PADDING
    for (const p of positions.values()) {
      p.x += offsetX
      p.y += offsetY
    }
    const width = (maxX - minX) + PADDING * 2
    const height = (maxY - minY) + PADDING * 2

    const depLines = depEdges
      .map(({ from, to }) => ({ from, to, a: positions.get(from), b: positions.get(to) }))
      .filter((l) => l.a && l.b)
    const parentLines = parentEdges
      .map(({ from, to }) => ({ from, to, a: positions.get(from), b: positions.get(to) }))
      .filter((l) => l.a && l.b)

    return {
      byId,
      positions,
      depLines,
      parentLines,
      viewBox: `0 0 ${width} ${height}`,
      isEmpty: false,
    }
  }, [tasks])

  if (tasks.length === 0 || isEmpty) {
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

  return (
    <div
      className="w-full h-full"
      style={{
        borderRadius: 'var(--radius-md)',
        border: 'var(--border-hairline)',
        background: 'var(--bg-card)',
        minHeight: 400,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <svg
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block' }}
      >
        {/* Parent edges first (underneath) — muted + dashed. */}
        {parentLines.map(({ from, to, a, b }) => (
          <line
            key={`p-${from}->${to}`}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke="var(--text-tertiary)"
            strokeWidth="1"
            strokeDasharray="3 3"
            strokeOpacity="0.5"
          />
        ))}
        {/* depends_on edges on top — accent color. */}
        {depLines.map(({ from, to, a, b }) => (
          <line
            key={`d-${from}->${to}`}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke="var(--accent-app)"
            strokeWidth="1.25"
            strokeOpacity="0.6"
          />
        ))}

        {/* Nodes — small pills carrying the task id. Full title on hover. */}
        {[...positions.entries()].map(([id, { x, y }]) => {
          const task = byId.get(id)
          if (!task) return null
          const statusColor = STATUS_COLOR[task.status] || 'var(--gray-1)'
          return (
            <g
              key={id}
              transform={`translate(${x - NODE_W / 2}, ${y - NODE_H / 2})`}
              style={{ cursor: 'pointer' }}
              onClick={() => onSelectTask?.(task)}
            >
              <title>{task.title}</title>
              <rect
                width={NODE_W}
                height={NODE_H}
                rx="11"
                ry="11"
                fill="var(--bg-card)"
                stroke={statusColor}
                strokeWidth="1.5"
              />
              <circle cx="10" cy={NODE_H / 2} r="3" fill={statusColor} />
              <text
                x="20"
                y={NODE_H / 2 + 3.5}
                style={{
                  fontSize: '9px',
                  fontFamily: 'var(--font-mono)',
                  fill: 'var(--text-app)',
                }}
              >
                {task.id.length > 14 ? task.id.slice(0, 13) + '…' : task.id}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

export default memo(GraphView)
