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
const ITERATIONS = 250
const K = 90                 // ideal edge length (also the force constant)

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

// Canonical Fruchterman-Reingold.
//
// Key correctness points the first pass missed:
// - Per-iteration displacement is CAPPED by a cooling temperature, so a big
//   attractive/repulsive force never teleports a node across the canvas.
// - Attraction uses d²/k (strong but bounded by the temperature cap) and
//   only fires along edges. Repulsion uses k²/d and fires on every pair.
// - No multiplicative center gravity (that was shrinking the whole cloud
//   to ~30% over 300 iterations). Drift control comes from repulsion
//   between disconnected pairs plus a tiny end-of-loop pull to origin.
function runForceLayout(nodes, edges) {
  const n = nodes.length
  if (n === 0) return new Map()

  const positions = new Map()
  // Seed radius scales with sqrt(n) so density stays roughly constant across
  // graphs of different sizes. Tiny random jitter breaks symmetry on the
  // seed circle so repulsion doesn't lock nodes into perfect polygonal rings.
  const R = K * Math.sqrt(n) * 0.7
  nodes.forEach((node, i) => {
    const angle = (i / n) * Math.PI * 2
    const jitter = (Math.random() - 0.5) * 0.2
    positions.set(node.id, {
      x: Math.cos(angle + jitter) * R,
      y: Math.sin(angle + jitter) * R,
    })
  })

  const ids = nodes.map((node) => node.id)
  // Initial temperature = seed radius, cooled linearly to 0.
  const T0 = R

  for (let iter = 0; iter < ITERATIONS; iter++) {
    const t = T0 * (1 - iter / ITERATIONS)
    const disp = new Map()
    for (const id of ids) disp.set(id, { x: 0, y: 0 })

    // Repulsion between every pair: f_r = k² / d, direction = from other to self.
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

    // Attraction along edges: f_a = d² / k, direction = toward other.
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

    // Apply displacement, CAPPED at current temperature so no node moves
    // more than ~t units per iteration. This is the critical stability knob.
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
