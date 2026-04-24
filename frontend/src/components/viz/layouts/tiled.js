// Tiled layout — placeholder for Phase 3 of ui-graph-redesign-013.
//
// When Phase 3 lands, this will pack each connected component into its own
// mini-radial and grid them across the canvas (small-multiples). For Phase 1
// it delegates to the single-canvas radial so output stays pixel-identical
// to v1 while the module surface exists for Phase 3 to fill in.

import { radialLayout } from './radial'

export function tiledLayout(model, rootId /* , components, options */) {
  return radialLayout(model, rootId)
}
