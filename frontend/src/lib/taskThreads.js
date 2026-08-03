// Thread grouping for the List view (ui-list-redesign-impl-001).
//
// A "thread of work" is bigger than a parent/subtask family. Since the
// continuation pipeline started populating `depends_on` (24% of tasks as of
// 2026-08, up from 0% when lib/listColumns.js first ruled it out), the board
// has two real structures worth following:
//
//   - parent_task hierarchies (the families lib/taskTree.js already renders)
//   - research → plan → implement chains, linked by depends_on
//
// This module unions them: a thread is a connected component over BOTH edge
// kinds, displayed as a tree. taskTree.js stays untouched — the Board and any
// other consumer keep their behavior; the List view switches to this.
//
// Display-tree rules (a component is a DAG; rendering needs a tree):
//   - A node's display parent is its `parent_task` when that task is in the
//     list (hierarchy wins), otherwise its first in-list `depends_on` entry.
//     Chains read top-down automatically: implement depends_on plan
//     depends_on research, so research renders as the thread root.
//   - Extra depends_on edges beyond the display parent don't add rows; they
//     already belong to the same component.
//   - depends_on pointing OUTSIDE the list adds no edge and no orphan — deps
//     on filtered-out (usually done) tasks are the common case and must not
//     flood the orphan bucket. Only a missing parent_task orphans a task,
//     preserving lib/taskTree.js semantics exactly.
//   - Cycles cannot recurse: every walk carries a seen-set, same discipline
//     as taskTree.js.

/** Tasks whose parent_task references something not in the given list. */
export const BUCKET_ORPHAN = 'Parent not shown'
/** Tasks connected to nothing — the flat majority. */
export const BUCKET_STANDALONE = 'Not in a thread'

/**
 * Index tasks and resolve each task's display parent.
 * Exported for tests; callers normally want buildThreadRows.
 */
export function indexThreads(tasks) {
  const byId = new Map()
  for (const t of tasks) byId.set(t.id, t)

  const parentOf = new Map()   // taskId -> display-parent id
  for (const t of tasks) {
    // Self-references are cycles of length 1; hand-edited YAML produces them.
    if (t.parent_task && t.parent_task !== t.id && byId.has(t.parent_task)) {
      parentOf.set(t.id, t.parent_task)
      continue
    }
    const deps = Array.isArray(t.depends_on) ? t.depends_on : []
    const dep = deps.find(d => d && d !== t.id && byId.has(d))
    if (dep) parentOf.set(t.id, dep)
  }

  const childrenOf = new Map() // taskId -> [child tasks], in caller's order
  for (const t of tasks) {
    const p = parentOf.get(t.id)
    if (!p) continue
    if (!childrenOf.has(p)) childrenOf.set(p, [])
    childrenOf.get(p).push(t)
  }

  return { byId, parentOf, childrenOf }
}

/** Total descendants beneath a task in the display tree, cycle-safe. */
export function countDescendants(task, childrenOf, seen = new Set()) {
  if (seen.has(task.id)) return 0
  seen.add(task.id)
  let total = 0
  for (const child of childrenOf.get(task.id) || []) {
    total += 1 + countDescendants(child, childrenOf, seen)
  }
  return total
}

/**
 * Flatten one thread into render rows, honouring per-task collapse.
 * Collapsing hides the whole subtree, matching taskTree.flattenFamily.
 *
 * @returns {Array<{ task, depth, childCount }>}
 */
export function flattenThread(root, childrenOf, collapsedIds = {}, depth = 0, seen = new Set()) {
  if (seen.has(root.id)) return []
  seen.add(root.id)

  const children = childrenOf.get(root.id) || []
  const rows = [{ task: root, depth, childCount: children.length }]
  if (collapsedIds[root.id]) return rows

  for (const child of children) {
    rows.push(...flattenThread(child, childrenOf, collapsedIds, depth + 1, seen))
  }
  return rows
}

/**
 * Everything the List view needs for one render pass in Thread mode.
 * Row order within a level follows the order tasks were given in, so the
 * caller's column sort still applies inside each thread level.
 *
 * @returns {{
 *   threads: Array<{ root: object, count: number, rows: Array }>,
 *   standalone: object[],
 *   orphans: object[]
 * }}
 */
export function buildThreadRows(tasks, collapsedIds = {}) {
  const { byId, parentOf, childrenOf } = indexThreads(tasks)

  // A cycle leaves every member claiming a parent, so none would render as a
  // root and the whole component would vanish (or, naively, each member would
  // render the others — duplicating every row). Break each cycle ONCE: the
  // first member in list order becomes the root; the rest stay children.
  const cycleRoots = pickCycleRoots(tasks, parentOf)

  const threads = []
  const standalone = []
  const orphans = []

  for (const task of tasks) {
    if (parentOf.has(task.id)) {
      if (!cycleRoots.has(task.id)) continue // rendered beneath its display parent
    } else if (task.parent_task && task.parent_task !== task.id && !byId.has(task.parent_task)) {
      // Points at a real parent hidden by a filter (or long deleted). Surface
      // it — silently vanishing rows read as data loss. depends_on misses do
      // NOT land here by design (see module header).
      orphans.push(task)
      continue
    }

    const count = countDescendants(task, childrenOf)
    if (count > 0) {
      threads.push({ root: task, count, rows: flattenThread(task, childrenOf, collapsedIds) })
    } else {
      standalone.push(task)
    }
  }

  return { threads, standalone, orphans }
}

// One root per cycle: walk each task's ancestor chain; when the walk loops
// back to the task itself it is in a cycle, and it becomes the root only if
// no member of that cycle was already chosen (list order decides).
function pickCycleRoots(tasks, parentOf) {
  const roots = new Set()
  const claimed = new Set() // every member of an already-broken cycle

  for (const task of tasks) {
    if (!parentOf.has(task.id) || claimed.has(task.id)) continue
    const walked = new Set([task.id])
    let current = parentOf.get(task.id)
    while (current && !walked.has(current)) {
      walked.add(current)
      current = parentOf.get(current)
    }
    if (current === task.id) {
      roots.add(task.id)
      for (const id of walked) claimed.add(id)
    }
  }
  return roots
}
