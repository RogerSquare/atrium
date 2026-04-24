// Tiled layout — small-multiples for large multi-component projects.
// Phase 3 of ui-graph-redesign-013.
//
// Strategy:
//   1. For each connected component, build a sub-model containing only its
//      nodes + the relevant `children` edges (so radial's DFS doesn't
//      escape the component).
//   2. Run radialLayout on the sub-model anchored at the component's
//      highest-out-degree node.
//   3. Compute that component's bounding box, then place it in a packed
//      row-wrapping grid: components sorted largest-first, wrap at
//      MAX_ROW_WIDTH so the canvas doesn't sprawl horizontally forever.
//   4. Translate every node's local position to its tile's global offset.
//
// Returns a single flat Map<id, {x, y}> covering every node so the caller
// (GraphView) can feed it straight into reactflow without knowing about
// component boundaries.

import { radialLayout } from './radial'

const TILE_GAP = 80
const MAX_ROW_WIDTH = 4000

export function tiledLayout(model, _rootId, components) {
  const positions = new Map()
  if (!components || components.length === 0) return positions

  const sorted = [...components].sort((a, b) => b.nodeIds.length - a.nodeIds.length)

  let cursorX = 0
  let cursorY = 0
  let rowHeight = 0

  for (const comp of sorted) {
    const subModel = buildSubModel(model, comp.nodeIds)
    const local = radialLayout(subModel, comp.rootId)

    const bounds = boundsOf(local)
    const width = Math.max(bounds.width, 1)
    const height = Math.max(bounds.height, 1)

    if (cursorX > 0 && cursorX + width > MAX_ROW_WIDTH) {
      cursorX = 0
      cursorY += rowHeight + TILE_GAP
      rowHeight = 0
    }

    const offsetX = cursorX - bounds.minX
    const offsetY = cursorY - bounds.minY
    for (const [id, { x, y }] of local) {
      positions.set(id, { x: x + offsetX, y: y + offsetY })
    }

    cursorX += width + TILE_GAP
    if (height > rowHeight) rowHeight = height
  }

  return positions
}

function buildSubModel(model, nodeIds) {
  const allowed = new Set(nodeIds)
  const subById = new Map()
  for (const id of nodeIds) {
    const t = model.byId.get(id)
    if (t) subById.set(id, t)
  }
  const subChildren = new Map()
  for (const id of nodeIds) {
    const ch = model.children?.get(id)
    if (!ch) continue
    const filtered = new Set()
    for (const c of ch) if (allowed.has(c)) filtered.add(c)
    if (filtered.size > 0) subChildren.set(id, filtered)
  }
  return { byId: subById, children: subChildren }
}

function boundsOf(positions) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const { x, y } of positions.values()) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
}
