// Parent/child grouping for the List view (ui-list-usability-001).
//
// Measured against the real board before writing any of this: of 769 tasks,
// 220 carry a `parent_task`, resolving to 72 real parents, with families up to
// 11 children and nesting up to 3 deep. So this has to be an actual tree, not
// a single level of indentation.
//
// Two edge cases drive the shape of the output, and both are real:
//
//   - A parent can be MISSING from the list. ListView receives the *filtered*
//     task set, so filtering to `status: todo` routinely hides a parent whose
//     children still match. Those children must not silently vanish, and they
//     must not be presented as roots either — they get their own bucket.
//   - `parent_task` chains can CYCLE. Nothing in the backend forbids
//     a -> b -> a, and a naive walk would recurse forever. Every traversal
//     here carries a seen-set.

/** Tasks that reference a parent which isn't in the given list. */
export const BUCKET_ORPHAN = 'Parent not shown'
/** Tasks with no parent and no children — the flat majority. */
export const BUCKET_STANDALONE = 'No parent'

/**
 * Index tasks by id and by parent.
 * Exported for tests; callers normally want buildForest.
 */
export function indexTasks(tasks) {
  const byId = new Map()
  for (const t of tasks) byId.set(t.id, t)

  const childrenOf = new Map()
  for (const t of tasks) {
    const parentId = t.parent_task
    // Self-parenting is a cycle of length 1 and shows up in hand-edited YAML.
    if (!parentId || parentId === t.id || !byId.has(parentId)) continue
    if (!childrenOf.has(parentId)) childrenOf.set(parentId, [])
    childrenOf.get(parentId).push(t)
  }
  return { byId, childrenOf }
}

/**
 * Walk from a task to its root, stopping on a cycle.
 * Returns the root id, or the task's own id when it is a root.
 */
export function rootIdOf(task, byId, guard = new Set()) {
  let current = task
  guard.add(current.id)
  while (current.parent_task && byId.has(current.parent_task)) {
    const next = byId.get(current.parent_task)
    if (guard.has(next.id)) return current.id // cycle — treat here as the root
    guard.add(next.id)
    current = next
  }
  return current.id
}

/**
 * Build the display forest.
 *
 * @returns {{
 *   families: Array<{ root: object, count: number }>,
 *   standalone: object[],
 *   orphans: object[]
 * }}
 * `families` are roots that actually have descendants; a root with none is
 * standalone, because a "family" of one is just a row with extra chrome.
 */
export function buildForest(tasks) {
  const { byId, childrenOf } = indexTasks(tasks)

  const families = []
  const standalone = []
  const orphans = []

  for (const task of tasks) {
    const parentId = task.parent_task
    const hasResolvableParent = parentId && parentId !== task.id && byId.has(parentId)
    if (hasResolvableParent) continue // rendered beneath its parent

    if (parentId && !byId.has(parentId)) {
      // Points at something real that is filtered out, or at nothing at all.
      // Either way it cannot be placed, so surface it rather than drop it.
      orphans.push(task)
      continue
    }

    const count = countDescendants(task, childrenOf)
    if (count > 0) families.push({ root: task, count })
    else standalone.push(task)
  }

  return { families, standalone, orphans }
}

/** Total descendants beneath a task, cycle-safe. */
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
 * Flatten a family into render rows, honouring per-task collapse.
 *
 * Collapsing a node hides its whole subtree, not just its direct children —
 * anything else would leave grandchildren floating with no visible parent.
 *
 * @returns {Array<{ task, depth, childCount }>}
 */
export function flattenFamily(root, childrenOf, collapsedIds = {}, depth = 0, seen = new Set()) {
  if (seen.has(root.id)) return [] // cycle guard
  seen.add(root.id)

  const children = childrenOf.get(root.id) || []
  const rows = [{ task: root, depth, childCount: children.length }]
  if (collapsedIds[root.id]) return rows

  for (const child of children) {
    rows.push(...flattenFamily(child, childrenOf, collapsedIds, depth + 1, seen))
  }
  return rows
}

/**
 * Everything ListView needs for one render pass.
 * Sorting is the caller's job — this preserves the order it is given, so the
 * column sort still applies within each level of the tree.
 */
export function buildTreeRows(tasks, collapsedIds = {}) {
  const { childrenOf } = indexTasks(tasks)
  const { families, standalone, orphans } = buildForest(tasks)

  return {
    families: families.map(({ root, count }) => ({
      root,
      count,
      rows: flattenFamily(root, childrenOf, collapsedIds),
    })),
    standalone,
    orphans,
  }
}
