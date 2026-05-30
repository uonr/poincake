import type { HyperbolicTiling } from '../src/grid/hyperbolicTiling';
import type { GridAnchor } from '../src/grid/tilingAddress';

export const anchorAt = (tiling: HyperbolicTiling, index: number): GridAnchor | undefined => {
  const point = tiling.coarseGridPoints[index];
  return point?.anchor;
};
