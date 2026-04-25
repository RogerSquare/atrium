// GraphView — radial dependency graph rendered with @xyflow/react.
// Phase 2 of ui-graph-redesign-013.
//
// History:
//   - ui-graph-redesign-012 shipped the radial-tree layout in hand-rolled SVG.
//   - ui-graph-redesign-013 phase 1 lifted the model + layout math into
//     `viz/graphModel.js` and `viz/layouts/radial.js`.
//   - This phase replaces the SVG renderer with reactflow so we get
//     pan/zoom/minimap/selection for free and unblocks the upcoming
//     tiled-overview / unlinked-drawer / work-overlay phases.
//
// Visual grammar (preserved from v1):
//   - Node fill = task category color (feat/bug/ui/opt/devops/comp/mobile)
//   - Node radius scales with out-degree — parents are visibly bigger
//   - depends_on edges: solid, tinted with the dependent's category
//   - parent_task edges: dashed, muted, drawn underneath
//
// Layout positions come from radialLayout(); reactflow does the rest.
// Pan + zoom + minimap + reset are reactflow built-ins.

import { memo, useMemo, useState, useCallback } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Controls,
  MiniMap,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { buildModel, pickRoot } from './viz/graphModel'
import { radialLayout } from './viz/layouts/radial'
import { CATEGORY_COLOR, categoryColor } from './viz/categoryColors'
import TaskNode, { NODE_BOX } from './viz/TaskNode'
import { buildEdges, edgeTypes } from './viz/edges'
import './GraphView.css'

const nodeTypes = { task: TaskNode }

// Mirror v1's log-scale radius so a 20-child hub doesn't dwarf a 2-child node.
function nodeRadiusFor(childCount, maxChildCount) {
  const MIN = 7
  const MAX = 22
  if (maxChildCount <= 0) return MIN + 3
  const t = Math.log(1 + childCount) / Math.log(1 + maxChildCount)
  return MIN + t * (MAX - MIN)
}

function GraphCanvas({ tasks, onSelectTask }) {
  const [hoveredId, setHoveredId] = useState(null)

  const model = useMemo(() => {
    if (!tasks || tasks.length === 0) return null
    const m = buildModel(tasks)
    const { byId, parentEdges, depEdges, outDegree, neighbors } = m
    const rootId = pickRoot(byId, outDegree)
    const positions = radialLayout(m, rootId)
    const maxChildren = Math.max(1, ...Array.from(outDegree.values()))
    return { byId, positions, parentEdges, depEdges, outDegree, neighbors, rootId, maxChildren }
  }, [tasks])

  const baseNodes = useMemo(() => {
    if (!model) return []
    const { byId, positions, outDegree, rootId, maxChildren } = model
    const nodes = []
    for (const [id, { x, y }] of positions.entries()) {
      const task = byId.get(id)
      if (!task) continue
      const childCount = outDegree.get(id) || 0
      const radius = nodeRadiusFor(childCount, maxChildren)
      nodes.push({
        id,
        type: 'task',
        // Reactflow positions by top-left; offset to center the NODE_BOX
        // wrapper on the radial coordinate.
        position: { x: x - NODE_BOX / 2, y: y - NODE_BOX / 2 },
        data: { task, radius, isRoot: id === rootId, isHovered: false, dim: false },
        draggable: false,
        selectable: true,
      })
    }
    return nodes
  }, [model])

  // Layer hover state on top of base nodes without rebuilding the layout.
  const nodes = useMemo(() => {
    if (!model || !hoveredId) return baseNodes
    const adj = model.neighbors.get(hoveredId) || new Set()
    return baseNodes.map((n) => {
      const isHovered = n.id === hoveredId
      const dim = !isHovered && !adj.has(n.id)
      // Skip object churn when nothing changed — keeps memo stable.
      if (!isHovered && !dim) return n
      return { ...n, data: { ...n.data, isHovered, dim } }
    })
  }, [baseNodes, hoveredId, model])

  const edges = useMemo(() => {
    if (!model) return []
    return buildEdges(model, { hoveredId })
  }, [model, hoveredId])

  const onNodeMouseEnter = useCallback((_, node) => setHoveredId(node.id), [])
  const onNodeMouseLeave = useCallback(() => setHoveredId(null), [])
  const onNodeClick = useCallback(
    (_, node) => {
      const task = model?.byId.get(node.id)
      if (task) onSelectTask?.(task)
    },
    [model, onSelectTask],
  )

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

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodeMouseEnter={onNodeMouseEnter}
      onNodeMouseLeave={onNodeMouseLeave}
      onNodeClick={onNodeClick}
      fitView
      fitViewOptions={{ padding: 0.15 }}
      minZoom={0.15}
      maxZoom={5}
      panOnDrag
      zoomOnScroll
      nodesDraggable={false}
      nodesConnectable={false}
      proOptions={{ hideAttribution: false }}
    >
      <Controls showInteractive={false} />
      <MiniMap
        pannable
        zoomable
        nodeColor={(n) => categoryColor(n.id)}
        maskColor="rgba(0, 0, 0, 0.05)"
      />
    </ReactFlow>
  )
}

function GraphView({ tasks, onSelectTask }) {
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
      <ReactFlowProvider>
        <GraphCanvas tasks={tasks} onSelectTask={onSelectTask} />
      </ReactFlowProvider>

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
          zIndex: 4,
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
