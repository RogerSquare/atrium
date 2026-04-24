// Layout barrel — resolves a strategy name to its implementation.
// Strategy names come from graphModel.pickLayoutStrategy().

import { radialLayout, radiusForDepth } from './radial'
import { tiledLayout } from './tiled'

export { radialLayout, radiusForDepth, tiledLayout }

export function getLayout(strategy) {
  switch (strategy) {
    case 'large':
      return tiledLayout
    case 'small':
    case 'medium':
    default:
      return radialLayout
  }
}
