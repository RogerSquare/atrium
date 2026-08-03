// Unit tests for lib/taskThreads.js (ui-list-redesign-impl-001).
//
// The thread engine unions parent_task families with depends_on chains.
// These tests pin the display-tree rules: hierarchy wins over deps, chains
// read top-down from their research root, out-of-list deps neither link nor
// orphan, and cycles cannot recurse or vanish rows.

import { describe, it, expect } from 'vitest'
import { buildThreadRows, BUCKET_ORPHAN, BUCKET_STANDALONE } from '../taskThreads'

const T = (id, { parent = null, deps = [] } = {}) => ({ id, parent_task: parent, depends_on: deps })

const ids = (rows) => rows.map(r => r.task.id)
const depths = (rows) => rows.map(r => r.depth)

describe('buildThreadRows', () => {
  it('renders a parent_task family exactly like the old tree', () => {
    const tasks = [T('root'), T('kid-a', { parent: 'root' }), T('kid-b', { parent: 'root' }), T('grand', { parent: 'kid-a' })]
    const { threads, standalone, orphans } = buildThreadRows(tasks)

    expect(threads).toHaveLength(1)
    expect(threads[0].root.id).toBe('root')
    expect(threads[0].count).toBe(3)
    expect(ids(threads[0].rows)).toEqual(['root', 'kid-a', 'grand', 'kid-b'])
    expect(depths(threads[0].rows)).toEqual([0, 1, 2, 1])
    expect(standalone).toHaveLength(0)
    expect(orphans).toHaveLength(0)
  })

  it('stitches a research→plan→implement chain via depends_on, research at the root', () => {
    // List order is implement-first to prove structure (not input order) wins.
    const tasks = [
      T('feat-x-impl-001', { deps: ['feat-x-plan-001'] }),
      T('feat-x-plan-001', { deps: ['feat-x-research-001'] }),
      T('feat-x-research-001'),
    ]
    const { threads, standalone } = buildThreadRows(tasks)

    expect(threads).toHaveLength(1)
    expect(ids(threads[0].rows)).toEqual(['feat-x-research-001', 'feat-x-plan-001', 'feat-x-impl-001'])
    expect(depths(threads[0].rows)).toEqual([0, 1, 2])
    expect(standalone).toHaveLength(0)
  })

  it('unions a family and a chain into one thread when they connect', () => {
    const tasks = [
      T('epic'),
      T('research', { parent: 'epic' }),
      T('plan', { deps: ['research'] }),
      T('impl', { deps: ['plan'] }),
    ]
    const { threads } = buildThreadRows(tasks)

    expect(threads).toHaveLength(1)
    expect(ids(threads[0].rows)).toEqual(['epic', 'research', 'plan', 'impl'])
    expect(threads[0].count).toBe(3)
  })

  it('hierarchy beats depends_on when a task has both', () => {
    const tasks = [T('parent'), T('dep-target'), T('child', { parent: 'parent', deps: ['dep-target'] })]
    const { threads, standalone } = buildThreadRows(tasks)

    const parentThread = threads.find(th => th.root.id === 'parent')
    expect(ids(parentThread.rows)).toEqual(['parent', 'child'])
    // dep-target gets no child through the dep edge — it stands alone.
    expect(standalone.map(t => t.id)).toEqual(['dep-target'])
  })

  it('a depends_on pointing outside the list neither links nor orphans', () => {
    const tasks = [T('lonely', { deps: ['done-and-filtered-out'] })]
    const { threads, standalone, orphans } = buildThreadRows(tasks)

    expect(threads).toHaveLength(0)
    expect(orphans).toHaveLength(0)
    expect(standalone.map(t => t.id)).toEqual(['lonely'])
  })

  it('a missing parent_task still lands in the orphan bucket', () => {
    const tasks = [T('stray', { parent: 'filtered-out-parent' })]
    const { orphans, standalone } = buildThreadRows(tasks)

    expect(orphans.map(t => t.id)).toEqual(['stray'])
    expect(standalone).toHaveLength(0)
  })

  it('self-parenting is treated as no parent, not a crash or orphan', () => {
    const tasks = [T('narcissist', { parent: 'narcissist' })]
    const { standalone, orphans } = buildThreadRows(tasks)

    expect(standalone.map(t => t.id)).toEqual(['narcissist'])
    expect(orphans).toHaveLength(0)
  })

  it('a parent cycle keeps every row visible and terminates', () => {
    const tasks = [T('a', { parent: 'b' }), T('b', { parent: 'a' })]
    const { threads, standalone, orphans } = buildThreadRows(tasks)

    const rendered = [
      ...threads.flatMap(th => ids(th.rows)),
      ...standalone.map(t => t.id),
      ...orphans.map(t => t.id),
    ]
    expect(rendered.sort()).toEqual(['a', 'b'])
  })

  it('collapse hides the whole subtree but keeps the root row', () => {
    const tasks = [T('root'), T('kid', { parent: 'root' }), T('grand', { parent: 'kid' })]
    const { threads } = buildThreadRows(tasks, { root: true })

    expect(ids(threads[0].rows)).toEqual(['root'])
    expect(threads[0].rows[0].childCount).toBe(1)
    expect(threads[0].count).toBe(2) // count reflects the full family, collapsed or not
  })

  it('sibling order follows the caller-provided (sorted) order', () => {
    const tasks = [T('root'), T('z-kid', { parent: 'root' }), T('a-kid', { parent: 'root' })]
    const { threads } = buildThreadRows(tasks)
    expect(ids(threads[0].rows)).toEqual(['root', 'z-kid', 'a-kid'])
  })

  it('exports distinct bucket labels', () => {
    expect(BUCKET_ORPHAN).not.toBe(BUCKET_STANDALONE)
  })
})
