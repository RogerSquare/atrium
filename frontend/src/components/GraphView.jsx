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

import { memo, useMemo, useState, useCallback, useEffect } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Controls,
  MiniMap,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { buildModel, pickRoot, detectComponents } from './viz/graphModel'
import { radialLayout } from './viz/layouts/radial'
import { tiledLayout } from './viz/layouts/tiled'
import { packOrphans } from './viz/layouts/orphans'
import { CATEGORY_COLOR, categoryColor } from './viz/categoryColors'
import TaskNode, { NODE_BOX } from './viz/TaskNode'
import OrphanRegion from './viz/OrphanRegion'
import { buildEdges, edgeTypes } from './viz/edges'
import OverviewBackButton from './viz/OverviewBackButton'
import WorkOverlayToggle from './viz/WorkOverlayToggle'
import GraphSearch from './viz/GraphSearch'
import useForceSimulation from './viz/useForceSimulation'
import './GraphView.css'

// Tasks untouched for this many days fade in the work overlay.
const STALE_AFTER_DAYS = 30
const STALE_AFTER_MS = STALE_AFTER_DAYS * 24 * 60 * 60 * 1000

// Tiled layout takes over once the project is large enough to have meaningful
// disjoint sub-graphs. For Atrium today (292 nodes, ~20 components) this
// triggers; for Loom (49 nodes, denser) it stays on radial.
const TILED_NODE_THRESHOLD = 150

// Gap between the main layout's right edge and the orphan region.
const ORPHAN_REGION_GUTTER = 160

const ORPHAN_REGION_NODE_ID = '__orphan-region__'

const nodeTypes = {
  task: TaskNode,
  orphanRegion: OrphanRegion,
}

// Mirror v1's log-scale radius so a 20-child hub doesn't dwarf a 2-child node.
function nodeRadiusFor(childCount, maxChildCount) {
  const MIN = 7
  const MAX = 22
  if (maxChildCount <= 0) return MIN + 3
  const t = Math.log(1 + childCount) / Math.log(1 + maxChildCount)
  return MIN + t * (MAX - MIN)
}

function GraphCanvas({ tasks, onSelectTask, githubLinks }) {
  const [hoveredId, setHoveredId] = useState(null)
  const [focusedComponentId, setFocusedComponentId] = useState(null)
  const [overlayEnabled, setOverlayEnabled] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  // Live positions from the d3-force simulation. Initialized from
  // model.positions on each model rebuild, then mutated per tick.
  // baseNodes reads from this instead of model.positions so the graph
  // drifts continuously per the CodePen reference (ui-graph-polish-001).
  const [livePositions, setLivePositions] = useState(null)
  const reactFlow = useReactFlow()

  const model = useMemo(() => {
    if (!tasks || tasks.length === 0) return null
    const m = buildModel(tasks)
    const { byId, parentEdges, depEdges, outDegree, neighbors } = m
    const rootId = pickRoot(byId, outDegree)
    const components = detectComponents(byId, neighbors, outDegree)

    // Orphans are single-node components with no edges in either direction.
    // detectComponents already isolates them as size-1 entries; we just need
    // to confirm there's no neighbor presence (a 2-node parent_task pair
    // would also be size-1-per-component if we ran this wrong, but neighbors
    // would have entries — so the check is correct).
    const orphanIdSet = new Set()
    const connectedComponents = []
    for (const c of components) {
      if (c.nodeIds.length === 1 && !neighbors.has(c.rootId)) {
        orphanIdSet.add(c.rootId)
      } else {
        connectedComponents.push(c)
      }
    }
    const orphanIds = [...orphanIdSet]

    const useTiled =
      byId.size > TILED_NODE_THRESHOLD && connectedComponents.length > 1

    let positions = useTiled
      ? tiledLayout(m, rootId, connectedComponents)
      : radialLayout(m, rootId)

    // The radial layout drops unreachable nodes (other components, orphans)
    // onto a single outer ring. Strip orphan placements from there so we
    // can re-place them inside the dedicated region below; secondary
    // connected components on the ring stay untouched.
    if (!useTiled && orphanIdSet.size > 0) {
      for (const id of orphanIds) positions.delete(id)
    }

    // Compute the bounding box of the connected layout so we know where to
    // park the orphan region (to its right, with a gutter).
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const { x, y } of positions.values()) {
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
    if (!isFinite(minX)) {
      // Edge case: project is 100% orphans — anchor the region at origin.
      minX = 0; minY = 0; maxX = 0; maxY = 0
    }

    const orphanResult = packOrphans(orphanIds)
    let orphanRegion = null
    if (orphanResult.region) {
      const offsetX = maxX + ORPHAN_REGION_GUTTER
      const offsetY = minY
      for (const [id, p] of orphanResult.positions) {
        positions.set(id, { x: p.x + offsetX, y: p.y + offsetY })
      }
      orphanRegion = {
        x: offsetX,
        y: offsetY,
        width: orphanResult.region.width,
        height: orphanResult.region.height,
        count: orphanResult.region.count,
      }
    }

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
      components,
      connectedComponents,
      orphanIds,
      orphanIdSet,
      orphanRegion,
      strategy: useTiled ? 'tiled' : 'radial',
    }
  }, [tasks])

  // Reset livePositions when the model rebuilds (new tasks loaded or layout
  // strategy changed). The simulation effect below picks this up and
  // initializes a fresh d3-force run from the radial/tiled seed positions.
  useEffect(() => {
    if (model?.positions) setLivePositions(new Map(model.positions))
    else setLivePositions(null)
  }, [model])

  // Inputs to d3-force. Nodes come from model.byId; edges merge parent_task
  // and depends_on with a single spring per pair (deduped + symmetric so
  // A→B and B→A collapse to one edge).
  const simNodes = useMemo(() => {
    if (!model) return []
    return Array.from(model.byId.keys()).map((id) => ({ id }))
  }, [model])
  const simEdges = useMemo(() => {
    if (!model) return []
    const seen = new Set()
    const out = []
    const all = [...(model.parentEdges || []), ...(model.depEdges || [])]
    for (const { from, to } of all) {
      const key = from < to ? `${from}|${to}` : `${to}|${from}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ source: from, target: to })
    }
    return out
  }, [model])

  const handleTick = useCallback((positions) => {
    setLivePositions(positions)
  }, [])

  useForceSimulation({
    nodes: simNodes,
    edges: simEdges,
    initialPositions: model?.positions,
    excludedIds: model?.orphanIdSet,
    enabled: !!model && simNodes.length > 0,
    onTick: handleTick,
  })

  const baseNodes = useMemo(() => {
    if (!model) return []
    const { byId, outDegree, rootId, maxChildren, orphanIdSet, orphanRegion } = model
    // Merge live (sim-driven) positions on top of static (model) positions.
    // The simulation excludes orphans, so livePositions is missing entries
    // for them — falling through to model.positions keeps them parked in the
    // orphan region.
    let positions
    if (livePositions) {
      positions = new Map(model.positions)
      for (const [id, p] of livePositions) positions.set(id, p)
    } else {
      positions = model.positions
    }
    const nodes = []

    // Synthetic backdrop FIRST — reactflow renders nodes in array order, so
    // anything later in the array sits on top. Pointer events are off and
    // the node is non-selectable so clicks/hover pass through to tasks.
    if (orphanRegion) {
      nodes.push({
        id: ORPHAN_REGION_NODE_ID,
        type: 'orphanRegion',
        position: { x: orphanRegion.x, y: orphanRegion.y },
        data: {
          width: orphanRegion.width,
          height: orphanRegion.height,
          count: orphanRegion.count,
        },
        draggable: false,
        selectable: false,
      })
    }

    for (const [id, { x, y }] of positions.entries()) {
      const task = byId.get(id)
      if (!task) continue
      const isOrphan = orphanIdSet.has(id)
      const childCount = outDegree.get(id) || 0
      const radius = nodeRadiusFor(childCount, maxChildren)
      nodes.push({
        id,
        type: 'task',
        // Reactflow positions by top-left; offset to center the NODE_BOX
        // wrapper on the layout coordinate.
        position: { x: x - NODE_BOX / 2, y: y - NODE_BOX / 2 },
        data: {
          task,
          radius,
          isRoot: id === rootId,
          isHovered: false,
          dim: false,
          isOrphan,
        },
        draggable: false,
        selectable: true,
      })
    }
    return nodes
  }, [model, livePositions])

  // Per-task work-overlay data — status/prState/isStale. Computed once and
  // selectively projected into node data only when overlayEnabled. Keeps
  // base layout memos stable on toggle.
  const overlayData = useMemo(() => {
    const map = new Map()
    if (!tasks) return map
    const now = Date.now()
    for (const t of tasks) {
      let lastTime = null
      if (Array.isArray(t.activity_log) && t.activity_log.length > 0) {
        const ts = t.activity_log[t.activity_log.length - 1]?.timestamp
        if (ts) lastTime = new Date(ts).getTime()
      }
      if (!lastTime) {
        const fallback = t.started_at || t.created_at
        if (fallback) lastTime = new Date(fallback).getTime()
      }
      const isStale = lastTime ? now - lastTime > STALE_AFTER_MS : false
      const prState = githubLinks?.[t.id]?.pr_state || null
      map.set(t.id, { status: t.status, prState, isStale })
    }
    return map
  }, [tasks, githubLinks])

  // Layer hover + overlay state on top of base nodes without rebuilding the layout.
  const nodes = useMemo(() => {
    if (!model) return baseNodes
    if (!hoveredId && !overlayEnabled) return baseNodes

    const adj = hoveredId ? model.neighbors.get(hoveredId) || new Set() : null
    return baseNodes.map((n) => {
      // Synthetic decorations (orphan region) don't participate in hover/overlay.
      if (n.type !== 'task') return n
      const isHovered = adj ? n.id === hoveredId : false
      const dim = adj ? !isHovered && !adj.has(n.id) : false
      const overlay = overlayEnabled ? overlayData.get(n.id) || null : null
      if (!isHovered && !dim && !overlay) return n
      return { ...n, data: { ...n.data, isHovered, dim, overlay } }
    })
  }, [baseNodes, hoveredId, model, overlayEnabled, overlayData])

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
  const onNodeDoubleClick = useCallback(
    (_, node) => {
      if (!model || model.strategy !== 'tiled') return
      const comp = model.components?.find((c) => c.nodeIds.includes(node.id))
      if (comp) setFocusedComponentId(comp.rootId)
    },
    [model],
  )

  // Drive reactflow's viewport from focus state. When focused, fit to the
  // selected component's nodes; when unfocused, fit the whole canvas.
  useEffect(() => {
    if (!model) return
    const padding = 0.15
    const duration = 350
    if (focusedComponentId) {
      const comp = model.components?.find((c) => c.rootId === focusedComponentId)
      if (comp) {
        reactFlow.fitView({
          nodes: comp.nodeIds.map((id) => ({ id })),
          padding,
          duration,
        })
      }
    } else {
      reactFlow.fitView({ padding, duration })
    }
  }, [focusedComponentId, model, reactFlow])

  // Esc clears the focus. Listen on the window so the keybind works even
  // when the canvas isn't focused. The search modal also handles Esc;
  // gate this on !searchOpen so closing search doesn't also un-focus.
  useEffect(() => {
    if (!focusedComponentId) return
    const onKey = (e) => {
      if (searchOpen) return
      if (e.key === 'Escape') setFocusedComponentId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focusedComponentId, searchOpen])

  // Cmd+K (Mac) / Ctrl+K opens search from anywhere on the page.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onSearchSelect = useCallback(
    (task) => {
      if (!model) return
      // In tiled mode, prefer switching focused component so the user
      // sees the matched node in context. The fitView effect handles
      // the rest. In radial mode, fitView directly on the node since
      // the whole connected layout is already on one canvas.
      if (model.strategy === 'tiled') {
        const comp = model.components?.find((c) =>
          c.nodeIds.includes(task.id),
        )
        if (comp) {
          setFocusedComponentId(comp.rootId)
          return
        }
      }
      reactFlow.fitView({
        nodes: [{ id: task.id }],
        padding: 0.5,
        duration: 350,
      })
    },
    [model, reactFlow],
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
    <>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeMouseEnter={onNodeMouseEnter}
        onNodeMouseLeave={onNodeMouseLeave}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
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
      {focusedComponentId && (
        <OverviewBackButton onClick={() => setFocusedComponentId(null)} />
      )}
      <WorkOverlayToggle
        active={overlayEnabled}
        onToggle={() => setOverlayEnabled((v) => !v)}
      />
      <GraphSearch
        open={searchOpen}
        tasks={tasks}
        onClose={() => setSearchOpen(false)}
        onSelect={onSearchSelect}
      />
    </>
  )
}

function GraphView({ tasks, onSelectTask, githubLinks }) {
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
        <GraphCanvas
          tasks={tasks}
          onSelectTask={onSelectTask}
          githubLinks={githubLinks}
        />
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
