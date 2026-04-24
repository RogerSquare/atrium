// Radial layout — DFS tree with arc-proportional subtree partitioning.
// Extracted from GraphView.jsx v1 (Phase 1 of ui-graph-redesign-013).
//
// Input:
//   - model:  { byId, children, neighbors } from graphModel.buildModel()
//   - rootId: anchor id (from graphModel.pickRoot or component.rootId)
//
// Output:
//   Map<id, { x, y }>  — positions in world coordinates, root at origin.
//
// Orphans (ids present in byId but not reachable from rootId through the
// `children` tree) get placed on a single outer ring beyond the deepest
// reached ring. Same behavior as v1 — the v2 plan replaces this with a
// dedicated "Unlinked" drawer in Phase 4, so keep this honest for now.

// Diminishing-returns ring spacing: depth 1=160, 2=280, 3=380, 4=460, ...
export function radiusForDepth(depth) {
  if (depth === 0) return 0
  return 160 + 120 * Math.log2(depth + 1) * Math.sqrt(depth)
}

export function radialLayout({ byId, children }, rootId) {
  const depth = new Map()
  const angle = new Map()
  const positions = new Map()
  if (!rootId || !byId || !byId.has(rootId)) return positions

  depth.set(rootId, 0)
  angle.set(rootId, 0)
  positions.set(rootId, { x: 0, y: 0 })

  const subtreeSize = new Map()
  const computeSize = (id, visited) => {
    if (visited.has(id)) return 0
    visited.add(id)
    let size = 1
    const kids = children.get(id)
    if (kids) for (const c of kids) size += computeSize(c, visited)
    subtreeSize.set(id, size)
    return size
  }
  computeSize(rootId, new Set())

  const assign = (id, startAngle, endAngle, d, visited) => {
    if (visited.has(id)) return
    visited.add(id)
    const mid = (startAngle + endAngle) / 2
    depth.set(id, d)
    angle.set(id, mid)
    const r = radiusForDepth(d)
    positions.set(id, { x: Math.cos(mid) * r, y: Math.sin(mid) * r })

    const kids = [...(children.get(id) || [])].filter((k) => !visited.has(k))
    if (kids.length === 0) return

    const totalSize = kids.reduce((s, k) => s + (subtreeSize.get(k) || 1), 0)
    const arcSpan = endAngle - startAngle
    let cursor = startAngle
    for (const k of kids) {
      const ks = subtreeSize.get(k) || 1
      const span = (ks / totalSize) * arcSpan
      assign(k, cursor, cursor + span, d + 1, visited)
      cursor += span
    }
  }

  const visited = new Set()
  assign(rootId, -Math.PI, Math.PI, 0, visited)

  const unreached = [...byId.keys()].filter((id) => !visited.has(id))
  if (unreached.length > 0) {
    const outerDepth = Math.max(...[...depth.values()], 0) + 1
    const outerR = radiusForDepth(outerDepth) + 80
    const step = (Math.PI * 2) / unreached.length
    unreached.forEach((id, i) => {
      const a = i * step - Math.PI
      depth.set(id, outerDepth)
      angle.set(id, a)
      positions.set(id, { x: Math.cos(a) * outerR, y: Math.sin(a) * outerR })
    })
  }

  return positions
}
