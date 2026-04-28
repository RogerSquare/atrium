// d3-force simulation hook — Phase 1 of ui-graph-polish-001-impl.
//
// Wraps d3-force so GraphView can drive node positions per-tick instead of
// rendering a static layout. Keeps the radial/tiled layout output as the seed
// (initialPositions) so the graph never starts from d3's random scatter.
//
// The pure `createSimulation` factory is exported separately so unit tests can
// drive it without a React renderer or DOM.

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  forceSimulation,
  forceManyBody,
  forceLink,
  forceX,
  forceY,
} from 'd3-force'

// Per-render hook for `prefers-reduced-motion`. Returns `true` if the user
// has requested reduced motion in their OS settings. Subscribes to changes
// so users toggling the setting mid-session see the simulation respond.
function useReducedMotion() {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  })
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handler = (e) => setReduced(e.matches)
    mq.addEventListener?.('change', handler)
    return () => mq.removeEventListener?.('change', handler)
  }, [])
  return reduced
}

// Defaults loosely ported from CodePen QWQmKWG (vis-network forceAtlas2Based).
// vis-network and d3-force don't share a units system, so values were tuned
// for Atrium's ~700-node scale (~230 in-graph + ~510 orphans).
//
// Continuous drift is achieved via `alphaDecay > 0` (sim cools) plus
// `alphaTarget > 0` (sim never fully stops). This is d3-force's idiom for
// "sustained low-energy motion."
//
// Forces are tuned conservatively because at 700+ nodes, even small per-tick
// position deltas multiply into expensive React reconciliations. Better to
// drift gently and still feel alive than to scatter and lock up the browser.
//
// `centerStrength` powers per-node forceX/forceY pulls toward (0, 0). The
// pen's vis-network `centralGravity` does the same. d3's `forceCenter` is
// NOT equivalent — it only translates the cloud centroid; switched to
// forceX/Y for actual per-node centripetal pull.
//
// `tickThrottle` caps how often `onTick` fires relative to internal d3
// ticks. d3-timer ticks at ~60fps; throttle=3 means React state updates
// at ~20fps, which is plenty smooth for drift and ~3x cheaper to reconcile.
export const DEFAULT_CONFIG = Object.freeze({
  springLength: 200,
  springStrength: 0.08,
  charge: -20,
  centerStrength: 0.08,
  velocityDecay: 0.75,
  alphaDecay: 0.03,
  alphaTarget: 0.005,
  tickThrottle: 3,
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
  const reducedMotion = useReducedMotion()

  // Reduced motion: cool the simulation to a hard stop instead of sustaining
  // continuous drift. Nodes settle once and freeze. Drag still works (drag
  // restarts via sim.restart, but at lower alpha), so the graph is fully
  // interactive — just no idle motion. Phase 4 of ui-graph-polish-001.
  const effectiveConfig = useMemo(() => {
    if (!reducedMotion) return config
    return {
      ...config,
      alphaDecay: 0.0228, // d3-force default — settles in ~300 ticks
      alphaTarget: 0,
    }
  }, [config, reducedMotion])

  // Content-stable keys for the structural inputs. The parent may re-render
  // with a fresh `tasks` array from socket updates — that cascades into new
  // refs for `nodes`, `edges`, etc. even when their CONTENT is identical.
  // Strings compare by value, so the effect only re-runs on real changes.
  const nodesKey = useMemo(
    () => (nodes ? nodes.map((n) => n.id).sort().join(',') : ''),
    [nodes],
  )
  const edgesKey = useMemo(
    () => (edges ? edges.map((e) => `${e.source}|${e.target}`).sort().join(';') : ''),
    [edges],
  )
  const excludedKey = useMemo(
    () => (excludedIds ? Array.from(excludedIds).sort().join(',') : ''),
    [excludedIds],
  )

  // Mutable args read inside the effect / tick callback via ref so swapping
  // them (e.g. a fresh onTick callback) doesn't tear down the simulation.
  const argsRef = useRef(null)
  argsRef.current = { nodes, edges, initialPositions, excludedIds, onTick, config: effectiveConfig }

  useEffect(() => {
    if (!enabled) return undefined
    const { nodes, edges, initialPositions, excludedIds, config } = argsRef.current
    if (!nodes || nodes.length === 0) return undefined

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

    let tickCount = 0
    const throttle = Math.max(1, config?.tickThrottle ?? 1)
    sim.on('tick', () => {
      tickCount += 1
      const cb = argsRef.current.onTick
      if (!cb) return
      // Throttle React updates: d3 ticks at ~60fps; emitting positions every
      // tick reconciles all 700+ nodes 60 times a second and chokes the
      // browser. Every Nth tick (default 3 → ~20fps) is plenty smooth.
      if (tickCount % throttle !== 0) return
      const positions = new Map()
      for (const node of sim.nodes()) {
        positions.set(node.id, { x: node.x, y: node.y })
      }
      cb(positions)
    })

    simRef.current = sim
    return () => {
      sim.stop()
      simRef.current = null
    }
    // reducedMotion is in deps because flipping it should rebuild the sim
    // with the appropriate alphaDecay/alphaTarget pair.
  }, [nodesKey, edgesKey, excludedKey, enabled, reducedMotion])

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
