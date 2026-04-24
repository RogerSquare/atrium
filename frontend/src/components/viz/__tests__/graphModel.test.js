import { describe, it, expect } from 'vitest'
import {
  buildModel,
  pickRoot,
  detectComponents,
  pickLayoutStrategy,
} from '../graphModel'

// Fixture helpers — keep task shape minimal, matching the real API response.
const task = (id, { parent_task = null, depends_on = [] } = {}) => ({
  id,
  parent_task,
  depends_on,
})

describe('buildModel', () => {
  it('handles an empty list', () => {
    const m = buildModel([])
    expect(m.byId.size).toBe(0)
    expect(m.parentEdges).toHaveLength(0)
    expect(m.depEdges).toHaveLength(0)
    expect(m.outDegree.size).toBe(0)
  })

  it('records parent_task edges and counts out-degree', () => {
    const tasks = [
      task('feat-a-001'),
      task('feat-b-001', { parent_task: 'feat-a-001' }),
      task('feat-c-001', { parent_task: 'feat-a-001' }),
    ]
    const m = buildModel(tasks)
    expect(m.parentEdges).toEqual([
      { from: 'feat-a-001', to: 'feat-b-001' },
      { from: 'feat-a-001', to: 'feat-c-001' },
    ])
    expect(m.outDegree.get('feat-a-001')).toBe(2)
    expect(m.outDegree.get('feat-b-001')).toBeUndefined()
    expect(m.children.get('feat-a-001')).toEqual(new Set(['feat-b-001', 'feat-c-001']))
  })

  it('records depends_on edges independently of parent_task', () => {
    const tasks = [
      task('feat-a-001'),
      task('feat-b-001', { depends_on: ['feat-a-001'] }),
      task('feat-c-001', { depends_on: ['feat-a-001', 'feat-b-001'] }),
    ]
    const m = buildModel(tasks)
    expect(m.depEdges).toHaveLength(3)
    expect(m.outDegree.get('feat-a-001')).toBe(2)
    expect(m.outDegree.get('feat-b-001')).toBe(1)
  })

  it('ignores self-edges and edges to unknown ids', () => {
    const tasks = [
      task('feat-a-001', { parent_task: 'feat-a-001' }),          // self
      task('feat-b-001', { depends_on: ['feat-a-001', 'ghost'] }),
    ]
    const m = buildModel(tasks)
    expect(m.parentEdges).toHaveLength(0)
    expect(m.depEdges).toEqual([{ from: 'feat-a-001', to: 'feat-b-001' }])
  })
})

describe('pickRoot', () => {
  it('returns null for an empty model', () => {
    const m = buildModel([])
    expect(pickRoot(m.byId, m.outDegree)).toBeNull()
  })

  it('picks the task with the highest out-degree', () => {
    const tasks = [
      task('feat-hub-001'),
      task('feat-leaf-001', { parent_task: 'feat-hub-001' }),
      task('feat-leaf-002', { parent_task: 'feat-hub-001' }),
      task('feat-leaf-003', { parent_task: 'feat-hub-001' }),
      task('feat-other-001'),
    ]
    const m = buildModel(tasks)
    expect(pickRoot(m.byId, m.outDegree)).toBe('feat-hub-001')
  })

  it('breaks ties lexicographically', () => {
    const tasks = [
      task('feat-z-001'),
      task('feat-a-001'),
      task('feat-child-z', { parent_task: 'feat-z-001' }),
      task('feat-child-a', { parent_task: 'feat-a-001' }),
    ]
    const m = buildModel(tasks)
    // Both have out-degree 1; feat-a-001 wins lexicographically.
    expect(pickRoot(m.byId, m.outDegree)).toBe('feat-a-001')
  })
})

describe('detectComponents', () => {
  it('groups isolated tasks as their own single-node components', () => {
    const tasks = [task('feat-a-001'), task('feat-b-001'), task('feat-c-001')]
    const m = buildModel(tasks)
    const comps = detectComponents(m.byId, m.neighbors, m.outDegree)
    expect(comps).toHaveLength(3)
    expect(comps.every((c) => c.nodeIds.length === 1)).toBe(true)
  })

  it('groups a parent chain into one component', () => {
    const tasks = [
      task('feat-root-001'),
      task('feat-mid-001', { parent_task: 'feat-root-001' }),
      task('feat-leaf-001', { parent_task: 'feat-mid-001' }),
      // second child of root so root has the strictly highest out-degree
      task('feat-sibling-001', { parent_task: 'feat-root-001' }),
    ]
    const m = buildModel(tasks)
    const comps = detectComponents(m.byId, m.neighbors, m.outDegree)
    expect(comps).toHaveLength(1)
    expect(comps[0].nodeIds.sort()).toEqual([
      'feat-leaf-001',
      'feat-mid-001',
      'feat-root-001',
      'feat-sibling-001',
    ])
    // The highest-out-degree node anchors the component.
    expect(comps[0].rootId).toBe('feat-root-001')
  })

  it('separates disconnected subgraphs and sorts components by size', () => {
    const tasks = [
      // Component A (size 3)
      task('feat-a-root'),
      task('feat-a-kid1', { parent_task: 'feat-a-root' }),
      task('feat-a-kid2', { parent_task: 'feat-a-root' }),
      // Component B (size 2)
      task('feat-b-root'),
      task('feat-b-kid', { parent_task: 'feat-b-root' }),
      // Isolated
      task('feat-orphan-001'),
    ]
    const m = buildModel(tasks)
    const comps = detectComponents(m.byId, m.neighbors, m.outDegree)
    expect(comps).toHaveLength(3)
    expect(comps[0].nodeIds).toHaveLength(3)  // largest first
    expect(comps[1].nodeIds).toHaveLength(2)
    expect(comps[2].nodeIds).toEqual(['feat-orphan-001'])
  })

  it('merges components linked by depends_on (not just parent_task)', () => {
    const tasks = [
      task('feat-a-001'),
      task('feat-b-001'),
      task('feat-c-001', { depends_on: ['feat-a-001', 'feat-b-001'] }),
    ]
    const m = buildModel(tasks)
    const comps = detectComponents(m.byId, m.neighbors, m.outDegree)
    expect(comps).toHaveLength(1)
    expect(comps[0].nodeIds.sort()).toEqual(['feat-a-001', 'feat-b-001', 'feat-c-001'])
  })
})

describe('pickLayoutStrategy', () => {
  it('returns small for <30 nodes', () => {
    expect(pickLayoutStrategy({ totalNodes: 5 })).toBe('small')
    expect(pickLayoutStrategy({ totalNodes: 29 })).toBe('small')
  })

  it('returns medium for 30-150 nodes', () => {
    expect(pickLayoutStrategy({ totalNodes: 30 })).toBe('medium')
    expect(pickLayoutStrategy({ totalNodes: 150 })).toBe('medium')
  })

  it('returns large for >150 nodes', () => {
    expect(pickLayoutStrategy({ totalNodes: 151 })).toBe('large')
    expect(pickLayoutStrategy({ totalNodes: 1000 })).toBe('large')
  })

  it('defaults to small when totalNodes is missing', () => {
    expect(pickLayoutStrategy({})).toBe('small')
    expect(pickLayoutStrategy()).toBe('small')
  })
})
