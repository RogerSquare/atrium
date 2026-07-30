// Unit tests for taskTree (ui-list-usability-001).
//
// The two cases that matter most are the ones real data produces: a parent
// filtered out of the view (ListView gets the FILTERED task list, so this
// happens every time you filter by status), and a parent_task cycle (nothing
// in the backend forbids one, and a naive walk recurses forever).

import { describe, it, expect } from 'vitest'
import {
  indexTasks,
  buildForest,
  countDescendants,
  flattenFamily,
  buildTreeRows,
} from '../taskTree'

const t = (id, parent_task = null, extra = {}) => ({ id, title: id, parent_task, ...extra })

describe('indexTasks', () => {
  it('indexes children under their parent', () => {
    const { childrenOf } = indexTasks([t('a'), t('b', 'a'), t('c', 'a')])
    expect(childrenOf.get('a').map(x => x.id)).toEqual(['b', 'c'])
  })

  it('ignores a parent that is not in the list', () => {
    const { childrenOf } = indexTasks([t('b', 'missing')])
    expect(childrenOf.size).toBe(0)
  })

  it('ignores self-parenting — a cycle of length one', () => {
    const { childrenOf } = indexTasks([t('a', 'a')])
    expect(childrenOf.size).toBe(0)
  })
})

describe('buildForest', () => {
  it('separates families, standalone tasks, and orphans', () => {
    const tasks = [t('parent'), t('child', 'parent'), t('lonely'), t('lost', 'filtered-out')]
    const { families, standalone, orphans } = buildForest(tasks)
    expect(families.map(f => f.root.id)).toEqual(['parent'])
    expect(standalone.map(x => x.id)).toEqual(['lonely'])
    expect(orphans.map(x => x.id)).toEqual(['lost'])
  })

  // A "family" of one is just a row with extra chrome.
  it('a childless root is standalone, not a one-member family', () => {
    const { families, standalone } = buildForest([t('solo')])
    expect(families).toHaveLength(0)
    expect(standalone.map(x => x.id)).toEqual(['solo'])
  })

  // This is the filtered-view case, and the reason orphans exist as a concept:
  // filtering to status=todo hides parents whose children still match.
  it('keeps a child whose parent was filtered out of the view', () => {
    const { orphans, families, standalone } = buildForest([t('child', 'parent-not-in-list')])
    expect(orphans.map(x => x.id)).toEqual(['child'])
    expect(families).toHaveLength(0)
    expect(standalone).toHaveLength(0)
  })

  it('never lists a task twice across the three buckets', () => {
    const tasks = [t('p'), t('c1', 'p'), t('c2', 'p'), t('solo'), t('orph', 'gone')]
    const { families, standalone, orphans } = buildForest(tasks)
    const { childrenOf } = indexTasks(tasks)
    const rendered = [
      ...families.flatMap(f => flattenFamily(f.root, childrenOf).map(r => r.task.id)),
      ...standalone.map(x => x.id),
      ...orphans.map(x => x.id),
    ]
    expect(rendered.sort()).toEqual(['c1', 'c2', 'orph', 'p', 'solo'])
    expect(new Set(rendered).size).toBe(rendered.length)
  })

  it('does not hang on a parent_task cycle', () => {
    const tasks = [t('a', 'b'), t('b', 'a')]
    expect(() => buildForest(tasks)).not.toThrow()
  })
})

describe('countDescendants', () => {
  it('counts the whole subtree, not just direct children', () => {
    const tasks = [t('a'), t('b', 'a'), t('c', 'b'), t('d', 'c')]
    const { childrenOf } = indexTasks(tasks)
    expect(countDescendants(tasks[0], childrenOf)).toBe(3)
  })

  it('terminates on a cycle', () => {
    const tasks = [t('a', 'c'), t('b', 'a'), t('c', 'b')]
    const { childrenOf } = indexTasks(tasks)
    expect(() => countDescendants(tasks[0], childrenOf)).not.toThrow()
  })
})

describe('flattenFamily', () => {
  it('assigns increasing depth down the tree', () => {
    const tasks = [t('a'), t('b', 'a'), t('c', 'b')]
    const { childrenOf } = indexTasks(tasks)
    expect(flattenFamily(tasks[0], childrenOf).map(r => [r.task.id, r.depth]))
      .toEqual([['a', 0], ['b', 1], ['c', 2]])
  })

  // Hiding only direct children would leave grandchildren floating with no
  // visible parent, which reads as corruption rather than collapse.
  it('collapsing hides the entire subtree, not just direct children', () => {
    const tasks = [t('a'), t('b', 'a'), t('c', 'b')]
    const { childrenOf } = indexTasks(tasks)
    const rows = flattenFamily(tasks[0], childrenOf, { a: true })
    expect(rows.map(r => r.task.id)).toEqual(['a'])
  })

  it('collapsing mid-tree keeps ancestors visible', () => {
    const tasks = [t('a'), t('b', 'a'), t('c', 'b')]
    const { childrenOf } = indexTasks(tasks)
    const rows = flattenFamily(tasks[0], childrenOf, { b: true })
    expect(rows.map(r => r.task.id)).toEqual(['a', 'b'])
  })

  it('reports childCount so the caller can render a disclosure only when useful', () => {
    const tasks = [t('a'), t('b', 'a')]
    const { childrenOf } = indexTasks(tasks)
    const rows = flattenFamily(tasks[0], childrenOf)
    expect(rows[0].childCount).toBe(1)
    expect(rows[1].childCount).toBe(0)
  })
})

describe('buildTreeRows', () => {
  it('preserves the caller\'s ordering, so column sort still applies', () => {
    // Children deliberately supplied in reverse-alphabetical order.
    const tasks = [t('a'), t('z', 'a'), t('m', 'a')]
    const { families } = buildTreeRows(tasks)
    expect(families[0].rows.map(r => r.task.id)).toEqual(['a', 'z', 'm'])
  })

  it('returns every bucket even when empty', () => {
    const out = buildTreeRows([])
    expect(out).toEqual({ families: [], standalone: [], orphans: [] })
  })
})
