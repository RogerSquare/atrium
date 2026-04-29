// Unit tests for graphViewIncremental — the diff helper that lets
// GraphView avoid destroy+recreate on every filter chip toggle.

import { describe, it, expect } from 'vitest'
import { diffGraphData, applyDiff } from '../graphViewIncremental.js'

const node = (id, extra = {}) => ({ id, label: id, x: 0, y: 0, ...extra })
const edge = (id, from, to, extra = {}) => ({ id, from, to, ...extra })

describe('diffGraphData', () => {
  it('returns empty diff for identical snapshots (initial mount no-op)', () => {
    const snap = { nodes: [node('a'), node('b')], edges: [edge('e1', 'a', 'b')] }
    const d = diffGraphData(snap, snap)
    expect(d.removeNodeIds).toEqual([])
    expect(d.addNodes).toEqual([])
    expect(d.removeEdgeIds).toEqual([])
    expect(d.addEdges).toEqual([])
    // Identical-id nodes still appear in updateNodes — that's the channel
    // attribute changes flow through.
    expect(d.updateNodes).toHaveLength(2)
  })

  it('detects added nodes (filter widening)', () => {
    const prev = { nodes: [node('a')], edges: [] }
    const next = { nodes: [node('a'), node('b'), node('c')], edges: [] }
    const d = diffGraphData(prev, next)
    expect(d.addNodes.map(n => n.id).sort()).toEqual(['b', 'c'])
    expect(d.removeNodeIds).toEqual([])
  })

  it('detects removed nodes (filter narrowing)', () => {
    const prev = { nodes: [node('a'), node('b'), node('c')], edges: [] }
    const next = { nodes: [node('a')], edges: [] }
    const d = diffGraphData(prev, next)
    expect(d.removeNodeIds.sort()).toEqual(['b', 'c'])
    expect(d.addNodes).toEqual([])
  })

  it('strips x/y from updated nodes so live physics positions survive', () => {
    // Same id in both — represents a node that stays visible across the
    // filter toggle. Its x/y in the next snapshot is the seeded coord
    // (recomputed by graphData useMemo) but the network's body has the
    // real runtime position. Updating with x/y would snap it back.
    const prev = { nodes: [node('a', { x: 100, y: 100, color: 'red' })], edges: [] }
    const next = { nodes: [node('a', { x: 0, y: 0, color: 'blue' })], edges: [] }
    const d = diffGraphData(prev, next)
    expect(d.updateNodes).toHaveLength(1)
    expect(d.updateNodes[0]).not.toHaveProperty('x')
    expect(d.updateNodes[0]).not.toHaveProperty('y')
    // But other attribute drift IS pushed — status border, priority
    // size, etc. propagate through here.
    expect(d.updateNodes[0].color).toBe('blue')
    expect(d.updateNodes[0].id).toBe('a')
    expect(d.updateNodes[0].label).toBe('a')
  })

  it('keeps x/y on truly-new nodes (vis-data needs them as starting coords)', () => {
    const prev = { nodes: [], edges: [] }
    const next = { nodes: [node('a', { x: 50, y: 50 })], edges: [] }
    const d = diffGraphData(prev, next)
    expect(d.addNodes).toHaveLength(1)
    expect(d.addNodes[0].x).toBe(50)
    expect(d.addNodes[0].y).toBe(50)
  })

  it('handles edge add/remove independently of node changes', () => {
    const prev = {
      nodes: [node('a'), node('b'), node('c')],
      edges: [edge('e1', 'a', 'b'), edge('e2', 'b', 'c')],
    }
    const next = {
      nodes: [node('a'), node('b'), node('c')],
      edges: [edge('e1', 'a', 'b'), edge('e3', 'a', 'c')],
    }
    const d = diffGraphData(prev, next)
    expect(d.removeEdgeIds).toEqual(['e2'])
    expect(d.addEdges).toHaveLength(1)
    expect(d.addEdges[0].id).toBe('e3')
  })

  it('treats null prev as full add (matches first-mount-fallback path)', () => {
    const next = { nodes: [node('a')], edges: [edge('e1', 'a', 'a')] }
    const d = diffGraphData(null, next)
    expect(d.addNodes).toHaveLength(1)
    expect(d.addEdges).toHaveLength(1)
    expect(d.removeNodeIds).toEqual([])
  })
})

describe('applyDiff', () => {
  // Minimal fake DataSet that records the operations applied to it.
  // We don't pull in vis-data here — the contract we're testing is the
  // *order* and *targets* of the calls; the real vis-data DataSet
  // semantics are separately battle-tested.
  function makeFakeDataSet(label) {
    const calls = []
    return {
      label,
      calls,
      add: items => calls.push({ op: 'add', items }),
      update: items => calls.push({ op: 'update', items }),
      remove: ids => calls.push({ op: 'remove', ids }),
    }
  }

  it('applies removes before adds and removes edges before nodes', () => {
    const nodesDS = makeFakeDataSet('nodes')
    const edgesDS = makeFakeDataSet('edges')
    const diff = {
      removeNodeIds: ['x'],
      addNodes: [node('y')],
      updateNodes: [{ id: 'a' }],
      removeEdgeIds: ['e_old'],
      addEdges: [edge('e_new', 'a', 'y')],
    }
    applyDiff(nodesDS, edgesDS, diff)

    // Order check: edges remove → nodes remove → nodes update → nodes add → edges add.
    const all = [
      ...edgesDS.calls.map(c => ({ ...c, ds: 'edges' })),
      ...nodesDS.calls.map(c => ({ ...c, ds: 'nodes' })),
    ]
    // Reconstruct insertion order by checking individual datasets.
    expect(edgesDS.calls[0]).toMatchObject({ op: 'remove', ids: ['e_old'] })
    expect(edgesDS.calls[1]).toMatchObject({ op: 'add' })
    expect(nodesDS.calls[0]).toMatchObject({ op: 'remove', ids: ['x'] })
    expect(nodesDS.calls[1]).toMatchObject({ op: 'update' })
    expect(nodesDS.calls[2]).toMatchObject({ op: 'add' })
    expect(all.length).toBe(5)
  })

  it('skips empty buckets entirely (no zero-length DataSet writes)', () => {
    const nodesDS = makeFakeDataSet('nodes')
    const edgesDS = makeFakeDataSet('edges')
    applyDiff(nodesDS, edgesDS, {
      removeNodeIds: [],
      addNodes: [],
      updateNodes: [],
      removeEdgeIds: [],
      addEdges: [],
    })
    expect(nodesDS.calls).toHaveLength(0)
    expect(edgesDS.calls).toHaveLength(0)
  })
})
