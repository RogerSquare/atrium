// Facelift Phase 9 — GraphView.
//
// Fourth view for the focal zone. Visualizes tasks as a layered DAG keyed on
// the `depends_on` field: upstream tasks on the left, dependents on the right.
// Tasks with no incoming or outgoing edges collect into an "Orphans" column
// on the far right so the main graph stays readable.
//
// Rendering: SVG + absolute-positioned DOM nodes (no new deps). Layering by
// Kahn-ish topological pass with a cycle-safe fallback (anything that can't be
// ordered drops to layer 0 so a malformed chain still renders).

import { memo, useMemo } from 'react'
import { STATUS_COLOR } from '../constants'

const NODE_WIDTH = 200
const NODE_HEIGHT = 58
const LAYER_GAP = 64   // horizontal gap between layers
const ROW_GAP = 16     // vertical gap between nodes within a layer
const PADDING = 24

function buildLayers(tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  // Layering considers BOTH edge kinds (depends_on + parent_task) so sub-tasks
  // sit to the right of their parent and blocked tasks sit to the right of
  // their blockers. Dangling references (archived/deleted tasks) are stripped
  // so one broken pointer doesn't trap the whole chain at layer 0.
  const layerEdges = new Map()  // incoming-edge set used for Kahn ordering
  const depEdges = new Map()    // depends_on only — rendered as solid edges
  const parentEdges = new Map() // parent_task only — rendered as dashed edges
  const anyIn = new Map()
  const anyOut = new Map()
  for (const t of tasks) {
    const deps = (t.depends_on || []).filter((d) => byId.has(d) && d !== t.id)
    const parent = t.parent_task && byId.has(t.parent_task) && t.parent_task !== t.id ? t.parent_task : null
    depEdges.set(t.id, new Set(deps))
    parentEdges.set(t.id, parent)
    const incoming = new Set(deps)
    if (parent) incoming.add(parent)
    layerEdges.set(t.id, incoming)
    anyIn.set(t.id, incoming.size > 0)
    for (const src of incoming) {
      if (!anyOut.has(src)) anyOut.set(src, 0)
      anyOut.set(src, anyOut.get(src) + 1)
    }
  }

  // Kahn's algorithm — nodes with zero incoming edges are layer 0; each pass
  // peels the next layer. Any remaining nodes (part of a cycle) land in a
  // final "unresolved" layer so nothing disappears.
  const layer = new Map()
  const remaining = new Set(tasks.map((t) => t.id))
  let depth = 0
  while (remaining.size > 0) {
    const ready = []
    for (const id of remaining) {
      const incoming = layerEdges.get(id)
      if ([...incoming].every((x) => layer.has(x))) ready.push(id)
    }
    if (ready.length === 0) {
      for (const id of remaining) layer.set(id, depth)
      break
    }
    for (const id of ready) {
      layer.set(id, depth)
      remaining.delete(id)
    }
    depth += 1
  }

  // Isolated = no edges of either kind in or out.
  const isolated = new Set()
  for (const t of tasks) {
    if (!anyIn.get(t.id) && !(anyOut.get(t.id) > 0)) isolated.add(t.id)
  }

  // Collect layer buckets for connected nodes.
  const connectedLayers = new Map()
  for (const t of tasks) {
    if (isolated.has(t.id)) continue
    const l = layer.get(t.id) ?? 0
    if (!connectedLayers.has(l)) connectedLayers.set(l, [])
    connectedLayers.get(l).push(t)
  }
  const sortedLayers = [...connectedLayers.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, list]) => list)

  if (isolated.size > 0) {
    sortedLayers.push(tasks.filter((t) => isolated.has(t.id)))
  }

  return { layers: sortedLayers, byId, depEdges, parentEdges }
}

function GraphView({ tasks, onSelectTask }) {
  const { byId, positions, depLines, parentLines, canvasWidth, canvasHeight } = useMemo(() => {
    const { layers, depEdges, parentEdges } = buildLayers(tasks)

    // Assign (x, y) per task.
    const positions = new Map()
    layers.forEach((layerTasks, layerIdx) => {
      const x = PADDING + layerIdx * (NODE_WIDTH + LAYER_GAP)
      layerTasks.forEach((t, rowIdx) => {
        const y = PADDING + rowIdx * (NODE_HEIGHT + ROW_GAP)
        positions.set(t.id, { x, y })
      })
    })

    // depends_on → solid edges. parent → dashed edges. Both only drawn when
    // both endpoints are on canvas.
    const depLines = []
    const parentLines = []
    for (const t of tasks) {
      for (const depId of depEdges.get(t.id) || []) {
        if (!positions.has(depId) || !positions.has(t.id)) continue
        depLines.push({ from: depId, to: t.id })
      }
      const parentId = parentEdges.get(t.id)
      if (parentId && positions.has(parentId) && positions.has(t.id)) {
        parentLines.push({ from: parentId, to: t.id })
      }
    }

    const canvasWidth = PADDING + layers.length * (NODE_WIDTH + LAYER_GAP)
    const canvasHeight =
      PADDING + Math.max(1, ...layers.map((l) => l.length)) * (NODE_HEIGHT + ROW_GAP)

    return {
      byId: new Map(tasks.map((t) => [t.id, t])),
      positions,
      depLines,
      parentLines,
      canvasWidth,
      canvasHeight,
    }
  }, [tasks])

  if (tasks.length === 0) {
    return (
      <div
        className="text-center py-12 italic"
        style={{ color: 'var(--text-muted)', fontSize: 'var(--text-subhead)' }}
      >
        No tasks to graph.
      </div>
    )
  }

  return (
    <div
      className="overflow-auto custom-scrollbar"
      style={{
        borderRadius: 'var(--radius-md)',
        border: 'var(--border-hairline)',
        background: 'var(--bg-card)',
        height: '100%',
        minHeight: 0,
      }}
    >
      <div
        className="relative"
        style={{
          width: Math.max(canvasWidth, 400),
          height: Math.max(canvasHeight, 200),
        }}
      >
        {/* Edges — drawn beneath nodes via absolute SVG.
            Parent-task edges render first (underneath) with a dashed, muted
            stroke so they read as hierarchy/grouping. depends_on edges render
            on top with a solid, accented stroke so blockers stand out. */}
        <svg
          width={canvasWidth}
          height={canvasHeight}
          className="absolute top-0 left-0 pointer-events-none"
        >
          {parentLines.map(({ from, to }) => {
            const a = positions.get(from)
            const b = positions.get(to)
            if (!a || !b) return null
            const x1 = a.x + NODE_WIDTH
            const y1 = a.y + NODE_HEIGHT / 2
            const x2 = b.x
            const y2 = b.y + NODE_HEIGHT / 2
            const midX = (x1 + x2) / 2
            const d = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`
            return (
              <path
                key={`p-${from}->${to}`}
                d={d}
                stroke="var(--text-tertiary)"
                strokeWidth="1"
                strokeDasharray="4 4"
                strokeOpacity="0.5"
                fill="none"
              />
            )
          })}
          {depLines.map(({ from, to }) => {
            const a = positions.get(from)
            const b = positions.get(to)
            if (!a || !b) return null
            const x1 = a.x + NODE_WIDTH
            const y1 = a.y + NODE_HEIGHT / 2
            const x2 = b.x
            const y2 = b.y + NODE_HEIGHT / 2
            const midX = (x1 + x2) / 2
            const d = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`
            return (
              <path
                key={`d-${from}->${to}`}
                d={d}
                stroke="var(--accent-app)"
                strokeWidth="1.5"
                strokeOpacity="0.6"
                fill="none"
              />
            )
          })}
        </svg>

        {/* Nodes */}
        {[...positions.entries()].map(([id, { x, y }]) => {
          const task = byId.get(id)
          if (!task) return null
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelectTask?.(task)}
              className="apple-press absolute text-left"
              style={{
                left: x,
                top: y,
                width: NODE_WIDTH,
                height: NODE_HEIGHT,
                padding: 'var(--space-2)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--bg-card)',
                border: 'var(--border-hairline)',
                boxShadow: 'var(--shadow-card)',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                cursor: 'pointer',
              }}
              title={task.title}
            >
              <div className="flex items-center gap-1.5">
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: STATUS_COLOR[task.status] || 'var(--gray-1)',
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-caption2)',
                    color: 'var(--text-tertiary)',
                  }}
                >
                  {task.id}
                </span>
              </div>
              <span
                className="truncate"
                style={{
                  fontSize: 'var(--text-caption1)',
                  fontWeight: 'var(--font-medium)',
                  color: 'var(--text-app)',
                }}
              >
                {task.title}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default memo(GraphView)
