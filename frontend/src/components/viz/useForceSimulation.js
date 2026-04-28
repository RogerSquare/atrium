// d3-force simulation hook — Phase 1 of ui-graph-polish-001-impl.
//
// Wraps d3-force so GraphView can drive node positions per-tick instead of
// rendering a static layout. Keeps the radial/tiled layout output as the seed
// (initialPositions) so the graph never starts from d3's random scatter.
//
// The pure `createSimulation` factory is exported separately so unit tests can
// drive it without a React renderer or DOM.

import { useEffect, useMemo, useRef } from 'react'
import {
  forceSimulation,
  forceManyBody,
  forceLink,
  forceX,
  forceY,
} from 'd3-force'

// Defaults loosely ported from CodePen QWQmKWG (vis-network forceAtlas2Based).
// vis-network and d3-force don't share a units system, so values were tuned
// for Atrium's ~292-node scale rather than copied literally.
//
// Continuous drift is achieved via `alphaDecay > 0` (sim cools) plus
// `alphaTarget > 0` (sim never fully stops). This is d3-force's idiom for
// "sustained low-energy motion." A first-cut tried `alphaDecay: 0` to
// emulate vis-network's perpetual energy, but that left the sim at alpha=1
// indefinitely with full-strength forces fighting each other every tick —
// nodes scattered too fast for the viewport to follow.
//
// `centerStrength` powers per-node forceX/forceY pulls toward (0, 0). The
// pen's vis-network `centralGravity` does the same — pulls each node toward
// the center proportional to distance. d3's `forceCenter` is NOT equivalent;
// it only translates the cloud centroid and lets the cloud expand without
// bound. Phase 2 first-cut used forceCenter; switched to forceX + forceY.
//
// `springLength` starts at 200 because Atrium's coordinate space is larger
// than the pen's 1000x1000 — final value gets dialed in during Phase 5.
export const DEFAULT_CONFIG = Object.freeze({
  springLength: 200,
  springStrength: 0.18,
  charge: -50,
  centerStrength: 0.05,
  velocityDecay: 0.6,
  alphaDecay: 0.02,
  alphaTarget: 0.01,
})

// Pure factory — builds a configured d3 simulation from nodes + edges.
// Exported so tests can drive it without React. Callers own the lifecycle:
// they must call `.stop()` when done.
export function createSimulation({
  nodes,
  edges,
  initialPositions,
  config = DEFAULT_CONFIG,
}) {
  const simNodes = nodes.map((n) => {
    const p = initialPositions?.get(n.id)
    return { id: n.id, x: p?.x ?? 0, y: p?.y ?? 0 }
  })
  const linkData = edges.map((e) => ({ source: e.source, target: e.target }))

  return forceSimulation(simNodes)
    .force('charge', forceManyBody().strength(config.charge))
    .force(
      'link',
      forceLink(linkData)
        .id((d) => d.id)
        .distance(config.springLength)
        .strength(config.springStrength),
    )
    .force('x', forceX(0).strength(config.centerStrength))
    .force('y', forceY(0).strength(config.centerStrength))
    .velocityDecay(config.velocityDecay)
    .alphaDecay(config.alphaDecay)
    .alphaTarget(config.alphaTarget ?? 0)
}

// React hook — manages simulation lifecycle and exposes drag-helpers.
// Phase 1 ships the surface; GraphView wires it in Phases 2-3.
export default function useForceSimulation({
  nodes,
  edges,
  initialPositions,
  excludedIds,
  enabled = true,
  onTick,
  config = DEFAULT_CONFIG,
}) {
  const simRef = useRef(null)

  useEffect(() => {
    if (!enabled || !nodes || nodes.length === 0) return undefined

    const includedNodes = excludedIds
      ? nodes.filter((n) => !excludedIds.has(n.id))
      : nodes
    const includedIds = new Set(includedNodes.map((n) => n.id))
    const includedEdges = edges
      ? edges.filter(
          (e) => includedIds.has(e.source) && includedIds.has(e.target),
        )
      : []

    const sim = createSimulation({
      nodes: includedNodes,
      edges: includedEdges,
      initialPositions,
      config,
    })

    if (onTick) {
      sim.on('tick', () => {
        const positions = new Map()
        for (const node of sim.nodes()) {
          positions.set(node.id, { x: node.x, y: node.y })
        }
        onTick(positions)
      })
    }

    simRef.current = sim
    return () => {
      sim.stop()
      simRef.current = null
    }
  }, [nodes, edges, initialPositions, excludedIds, enabled, onTick, config])

  return useMemo(
    () => ({
      pin: (id, position) => {
        const sim = simRef.current
        if (!sim) return
        const node = sim.nodes().find((n) => n.id === id)
        if (!node) return
        node.fx = position.x
        node.fy = position.y
      },
      release: (id) => {
        const sim = simRef.current
        if (!sim) return
        const node = sim.nodes().find((n) => n.id === id)
        if (!node) return
        node.fx = null
        node.fy = null
      },
      restart: (alpha = 0.3) => {
        const sim = simRef.current
        if (!sim) return
        sim.alpha(alpha).restart()
      },
    }),
    [],
  )
}
