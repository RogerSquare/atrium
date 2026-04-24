// Graph model — pure functions that turn a flat task list into the shape a
// layout algorithm wants. Phase 1 of ui-graph-redesign-013.
//
// Exported:
//   - buildModel(tasks)        → { byId, parentEdges, depEdges, outDegree, neighbors, children }
//   - pickRoot(byId, outDegree)→ id of the most-connected task (anchor for radial)
//   - detectComponents(byId, neighbors) → [{ rootId, nodeIds }] — weakly-connected components via union-find
//   - pickLayoutStrategy({ totalNodes, ... }) → 'small' | 'medium' | 'large'
//
// No rendering. No React. These are the primitives every layout consumes.

export function buildModel(tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const parentEdges = []   // parent_task: parent → child
  const depEdges = []      // depends_on:  blocker → dependent
  const outDegree = new Map()
  const neighbors = new Map()
  const children = new Map()

  const touch = (parent, child) => {
    outDegree.set(parent, (outDegree.get(parent) || 0) + 1)
    if (!neighbors.has(parent)) neighbors.set(parent, new Set())
    if (!neighbors.has(child)) neighbors.set(child, new Set())
    neighbors.get(parent).add(child)
    neighbors.get(child).add(parent)
    if (!children.has(parent)) children.set(parent, new Set())
    children.get(parent).add(child)
  }

  for (const t of tasks) {
    if (t.parent_task && byId.has(t.parent_task) && t.parent_task !== t.id) {
      parentEdges.push({ from: t.parent_task, to: t.id })
      touch(t.parent_task, t.id)
    }
    for (const depId of t.depends_on || []) {
      if (!byId.has(depId) || depId === t.id) continue
      depEdges.push({ from: depId, to: t.id })
      touch(depId, t.id)
    }
  }

  return { byId, parentEdges, depEdges, outDegree, neighbors, children }
}

export function pickRoot(byId, outDegree) {
  let best = null
  let bestCount = -1
  for (const id of byId.keys()) {
    const count = outDegree.get(id) || 0
    if (count > bestCount || (count === bestCount && (!best || id < best))) {
      best = id
      bestCount = count
    }
  }
  return best
}

// Weakly-connected components via union-find over the undirected `neighbors`
// adjacency. Isolated tasks (no in/out edges) each form their own component.
// Returns an array of { rootId, nodeIds }:
//   - rootId is the component's anchor for a radial layout — the node with
//     the highest out-degree inside that component (ties broken lexicographically).
//   - nodeIds is every task id in the component.
export function detectComponents(byId, neighbors, outDegree = new Map()) {
  const parent = new Map()
  const find = (x) => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)))  // path compression
      x = parent.get(x)
    }
    return x
  }
  const union = (a, b) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }

  for (const id of byId.keys()) parent.set(id, id)
  for (const [a, nbrs] of neighbors) {
    for (const b of nbrs) union(a, b)
  }

  const groups = new Map()
  for (const id of byId.keys()) {
    const root = find(id)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root).push(id)
  }

  const components = []
  for (const nodeIds of groups.values()) {
    let best = nodeIds[0]
    let bestCount = outDegree.get(best) || 0
    for (const id of nodeIds) {
      const c = outDegree.get(id) || 0
      if (c > bestCount || (c === bestCount && id < best)) {
        best = id
        bestCount = c
      }
    }
    components.push({ rootId: best, nodeIds })
  }
  components.sort((a, b) => b.nodeIds.length - a.nodeIds.length)
  return components
}

// Decide which layout strategy to use based on project size. Thresholds are
// conservative defaults; tune in Phase 3 if real data says otherwise.
export function pickLayoutStrategy({ totalNodes, componentCount, largestComponentSize } = {}) {
  if (totalNodes == null) return 'small'
  if (totalNodes < 30) return 'small'
  if (totalNodes <= 150) return 'medium'
  return 'large'
}
