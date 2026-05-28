import { abs2 } from '../geometry/complex';
import { DISK_EDGE_EPSILON } from '../geometry/disk';
import { applyTransform, type DiskTransform } from '../geometry/mobius';
import { projectDiskPoint, type Viewport } from '../render/viewport';
import type { GridPoint } from './hyperbolicTiling';

export const nearestVisibleGridPoint = (
  clientX: number,
  clientY: number,
  gridPoints: readonly GridPoint[],
  view: DiskTransform,
  viewport: Viewport,
  maxViewRadius2 = DISK_EDGE_EPSILON,
): GridPoint | null => {
  const screenX = clientX - viewport.left;
  const screenY = clientY - viewport.top;
  let bestDistance2 = Infinity;
  let best: GridPoint | null = null;

  for (const gridPoint of gridPoints) {
    const transformed = applyTransform(view, gridPoint.point);
    if (abs2(transformed) > maxViewRadius2) {
      continue;
    }

    const projected = projectDiskPoint(transformed, viewport);
    const dx = screenX - projected.x;
    const dy = screenY - projected.y;
    const distance2 = dx * dx + dy * dy;

    if (distance2 < bestDistance2) {
      bestDistance2 = distance2;
      best = gridPoint;
    }
  }

  return best;
};
