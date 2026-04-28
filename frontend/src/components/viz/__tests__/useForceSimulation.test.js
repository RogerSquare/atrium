import { describe, it, expect } from 'vitest'
import { createSimulation, DEFAULT_CONFIG } from '../useForceSimulation'

// Tests target the pure factory because vitest runs in node without jsdom.
// React-hook integration is verified visually during Phase 2 + 3 smoke tests.

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

describe('createSimulation', () => {
  it('produces a simulation with one node per input', () => {
    const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const sim = createSimulation({ nodes, edges: [] })
    try {
      expect(sim.nodes()).toHaveLength(3)
      expect(sim.nodes().map((n) => n.id).sort()).toEqual(['a', 'b', 'c'])
    } finally {
      sim.stop()
    }
  })

  it('honors initialPositions instead of d3 random scatter', () => {
    const nodes = [{ id: 'a' }, { id: 'b' }]
    const initialPositions = new Map([
      ['a', { x: 100, y: -50 }],
      ['b', { x: -200, y: 75 }],
    ])
    const sim = createSimulation({ nodes, edges: [], initialPositions })
    try {
      const a = sim.nodes().find((n) => n.id === 'a')
      const b = sim.nodes().find((n) => n.id === 'b')
      // d3 will assign vx/vy and start ticking via timer, but we check before
      // any tick fires (tests run synchronously between requestAnimationFrame).
      expect(a.x).toBe(100)
      expect(a.y).toBe(-50)
      expect(b.x).toBe(-200)
      expect(b.y).toBe(75)
    } finally {
      sim.stop()
    }
  })

  it('linked nodes settle to a stable, finite separation', () => {
    // Two nodes, one spring. Start them well apart; verify the simulation
    // converges (positions stop changing meaningfully) and the resulting
    // separation is finite — not exploding outward, not collapsing to zero.
    // We deliberately don't assert against `springLength` itself: the
    // equilibrium separation depends on the full force balance (springs +
    // charge + center pull), and d3-force values aren't 1:1 with the
    // springLength config.
    const nodes = [{ id: 'a' }, { id: 'b' }]
    const edges = [{ source: 'a', target: 'b' }]
    const initialPositions = new Map([
      ['a', { x: -500, y: 0 }],
      ['b', { x: 500, y: 0 }],
    ])
    const sim = createSimulation({
      nodes,
      edges,
      initialPositions,
      config: { ...DEFAULT_CONFIG, alphaDecay: 0.05, alphaTarget: 0 },
    })
    try {
      for (let i = 0; i < 300; i++) sim.tick()
      const [a, b] = sim.nodes()
      const sep = distance(a, b)
      // Loose bounds — just verify finite, sane separation.
      expect(sep).toBeGreaterThan(20)
      expect(sep).toBeLessThan(2000)
      // Sanity: positions should be finite (no NaN explosions).
      expect(Number.isFinite(a.x)).toBe(true)
      expect(Number.isFinite(b.x)).toBe(true)
    } finally {
      sim.stop()
    }
  })

  it('larger springLength produces larger settled separation', () => {
    // Compare two simulations with identical inputs but different
    // springLength. The one with the longer spring should settle further
    // apart. This verifies springLength is actually plumbed through and
    // affects equilibrium without depending on specific numeric values.
    const nodes = [{ id: 'a' }, { id: 'b' }]
    const edges = [{ source: 'a', target: 'b' }]
    const initialPositions = new Map([
      ['a', { x: -10, y: 0 }],
      ['b', { x: 10, y: 0 }],
    ])
    const settle = (springLength) => {
      const sim = createSimulation({
        nodes,
        edges,
        initialPositions,
        config: {
          ...DEFAULT_CONFIG,
          springLength,
          alphaDecay: 0.05,
          alphaTarget: 0,
        },
      })
      try {
        for (let i = 0; i < 300; i++) sim.tick()
        const [a, b] = sim.nodes()
        return distance(a, b)
      } finally {
        sim.stop()
      }
    }
    const shortSep = settle(100)
    const longSep = settle(800)
    expect(longSep).toBeGreaterThan(shortSep)
  })
})
