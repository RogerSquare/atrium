// Microbenchmark for the GraphView incremental DataSet diff path.
//
// Goal: produce numbers for the opt-graph-perf-001 task comment.
//
// What this measures (node-side, no browser):
//   • diffGraphData() — pure JS work the helper adds per filter toggle
//   • new DataSet(arr) — vis-data's per-item ingest cost; both old and
//     new code paths pay something proportional to this
//   • applyDiff() — diff + DataSet add/remove/update on a live pair
//     seeded with `prev`
//
// What this does NOT measure (browser-only):
//   • Network constructor (DOM + canvas + listener wiring) — runs once
//     per build, formerly fired on every filter toggle
//   • 200 stabilization iterations (O(N²) repulsion per iter) — formerly
//     fired on every filter toggle, even with seeded positions
//   • Camera auto-fit animation
//   • Canvas redraw
//
// The dominant cost the optimization removes is items 1+2, which the
// node bench can't observe. The numbers here therefore UNDERSTATE the
// real win — they tell you the helper itself is cheap (sub-ms) and the
// vis-data ingest is also cheap. The visible "reset jolt" elimination
// and the >50% drop in filter-toggle frame time at N=2000 happen in
// the parts we can't measure here, and need browser profiling to verify.
//
// Run via: npm test (this file matches the *.test.js include pattern).

import { describe, it } from 'vitest'
import { DataSet } from 'vis-data'
import { diffGraphData, applyDiff } from '../graphViewIncremental.js'

function makeSnapshot(n, seed = 0) {
  const HUBS = 10
  const hubNodes = []
  for (let h = 0; h < HUBS; h++) {
    hubNodes.push({
      id: `__hub:p${h}`,
      shape: 'hexagon',
      x: Math.cos((h / HUBS) * Math.PI * 2) * 600,
      y: Math.sin((h / HUBS) * Math.PI * 2) * 600,
      mass: 100,
      color: { background: '#fff', border: '#fff' },
    })
  }
  const taskNodes = []
  const edges = []
  for (let i = 0; i < n; i++) {
    const hub = i % HUBS
    const id = `task-${seed}-${i}`
    taskNodes.push({
      id,
      label: id,
      size: 10,
      shape: 'dot',
      x: Math.cos(i * 0.37) * 100,
      y: Math.sin(i * 0.37) * 100,
      color: { background: '#3a4150', border: '#3a78c2' },
    })
    edges.push({ id: `hub:${id}`, from: `__hub:p${hub}`, to: id, length: 350 })
    if (i > 0 && i % 5 === 0) {
      edges.push({
        id: `p:task-${seed}-${i - 1}->${id}`,
        from: `task-${seed}-${i - 1}`,
        to: id,
        arrows: 'to',
        length: 297.5,
      })
    }
  }
  return { nodes: [...hubNodes, ...taskNodes], edges }
}

// Time a function with JIT warmup and a fresh setup callback per
// iteration (so each call sees the same starting state). Returns
// ms/iter.
function timeIt(label, iterations, setup, fn) {
  // Warmup
  for (let i = 0; i < 3; i++) fn(setup())
  // Build all setup states up front so setup time isn't in the timed
  // window. For large N this allocates ~iterations× the dataset, but
  // that's fine for our sizes.
  const states = []
  for (let i = 0; i < iterations; i++) states.push(setup())
  const t0 = performance.now()
  for (let i = 0; i < iterations; i++) fn(states[i])
  const total = performance.now() - t0
  const per = total / iterations
  console.log(`  ${label}: ${per.toFixed(2)}ms/iter (${iterations} iters, ${total.toFixed(0)}ms total)`)
  return per
}

describe('graphView perf: filter-toggle JS-side cost', () => {
  for (const N of [500, 2000]) {
    it(`N=${N}`, () => {
      const ITER = N === 500 ? 50 : 20
      console.log(`\n[N=${N}] filter-toggle drops 10% of tasks (prev → next):`)

      const prev = makeSnapshot(N)
      const dropIds = new Set()
      for (let i = 0; i < prev.nodes.length; i++) {
        if (i % 10 === 0 && !prev.nodes[i].id.startsWith('__hub:')) dropIds.add(prev.nodes[i].id)
      }
      const next = {
        nodes: prev.nodes.filter(n => !dropIds.has(n.id)),
        edges: prev.edges.filter(e => !dropIds.has(e.from) && !dropIds.has(e.to)),
      }

      // 1. Old path's measurable JS cost: build two fresh DataSets from
      //    the next snapshot. The browser-only cost (Network constructor
      //    + 200-iter stabilization + canvas init) is NOT included here
      //    and is where most of the real win lives.
      timeIt(
        'Old path (DataSet construction only — UNDER-counts real cost)',
        ITER,
        () => null,
        () => {
          const _n = new DataSet(next.nodes)
          const _e = new DataSet(next.edges)
          if (_n.length === -1 || _e.length === -1) throw new Error('unreachable')
        }
      )

      // 2. New path: diff prev→next, apply to a live DataSet pair already
      //    seeded with `prev`. Setup builds a fresh seeded pair per
      //    iteration outside the timed window so the bench measures only
      //    the per-toggle hot path (diff + add/remove/update on a live DS).
      timeIt(
        'New path (diffGraphData + applyDiff on live DataSet pair)',
        ITER,
        () => ({
          liveNodes: new DataSet(prev.nodes),
          liveEdges: new DataSet(prev.edges),
        }),
        ({ liveNodes, liveEdges }) => {
          const diff = diffGraphData(prev, next)
          applyDiff(liveNodes, liveEdges, diff)
        }
      )

      // 3. New path — filter-only fast path (component skips updateNodes
      //    when `tasks` identity is unchanged since the previous sync).
      //    This represents the steady-state cost of toggling a chip when
      //    no upstream task data has changed — the dominant case.
      timeIt(
        'New path (filter-only fast path: updateNodes skipped)',
        ITER,
        () => ({
          liveNodes: new DataSet(prev.nodes),
          liveEdges: new DataSet(prev.edges),
        }),
        ({ liveNodes, liveEdges }) => {
          const diff = diffGraphData(prev, next)
          // Mirror the component's tasksUnchanged short-circuit.
          applyDiff(liveNodes, liveEdges, { ...diff, updateNodes: [] })
        }
      )

      // 4. diffGraphData alone — pure JS the helper adds. Should be a
      //    small fraction of the apply cost and well under 1ms for
      //    realistic graph sizes; if it grows, the helper is the
      //    suspect.
      timeIt(
        'diffGraphData() alone',
        ITER,
        () => null,
        () => {
          const diff = diffGraphData(prev, next)
          if (diff.addNodes.length < 0) throw new Error('unreachable')
        }
      )
    })
  }
})
