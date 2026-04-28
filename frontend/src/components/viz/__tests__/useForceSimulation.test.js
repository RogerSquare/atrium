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

  it('linked nodes converge toward springLength after settling', () => {
    // Two nodes, one spring. Start them well apart and let the simulation
    // settle. Their separation should approach DEFAULT_CONFIG.springLength
    // (200) within a generous tolerance — we're verifying the spring force
    // is wired, not exact convergence.
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
      // Override alphaDecay so the simulation actually cools and settles
      // within a finite tick count for the test (default is 0 = continuous).
      config: { ...DEFAULT_CONFIG, alphaDecay: 0.05 },
    })
    try {
      // Run enough ticks to settle (~200 covers it with alphaDecay 0.05).
      for (let i = 0; i < 300; i++) sim.tick()
      const [a, b] = sim.nodes()
      const sep = distance(a, b)
      // Tolerance ±40% — d3-force never lands exactly on springLength because
      // charge repulsion fights the spring.
      expect(sep).toBeGreaterThan(DEFAULT_CONFIG.springLength * 0.6)
      expect(sep).toBeLessThan(DEFAULT_CONFIG.springLength * 1.6)
    } finally {
      sim.stop()
    }
  })

  it('respects custom config overrides', () => {
    const nodes = [{ id: 'a' }, { id: 'b' }]
    const edges = [{ source: 'a', target: 'b' }]
    const initialPositions = new Map([
      ['a', { x: -10, y: 0 }],
      ['b', { x: 10, y: 0 }],
    ])
    const customSpringLength = 800
    const sim = createSimulation({
      nodes,
      edges,
      initialPositions,
      config: {
        ...DEFAULT_CONFIG,
        springLength: customSpringLength,
        alphaDecay: 0.05,
      },
    })
    try {
      for (let i = 0; i < 300; i++) sim.tick()
      const [a, b] = sim.nodes()
      const sep = distance(a, b)
      // With springLength=800 the pair should end up far apart, well past
      // what the default 200 would produce.
      expect(sep).toBeGreaterThan(400)
    } finally {
      sim.stop()
    }
  })
})
