import { DISK_EDGE_EPSILON } from '../geometry/disk';
import { applyTransform, invertTransform, type DiskTransform } from '../geometry/mobius';
import type { Viewport } from '../render/viewport';
import { nearestVisibleGridPoint } from './snap';
import { transformHyperbolicTiling, type GridPoint, type HyperbolicTiling } from './hyperbolicTiling';
import { viewDiskWorldBounds } from './spatialIndex';

export class AnchoredGrid {
  constructor(private currentTiling: HyperbolicTiling) {}

  get tiling(): HyperbolicTiling {
    return this.currentTiling;
  }

  reanchor(transform: DiskTransform): void {
    this.currentTiling = transformHyperbolicTiling(this.currentTiling, transform);
  }

  snapScreenPoint(
    clientX: number,
    clientY: number,
    view: DiskTransform,
    viewport: Viewport,
  ): GridPoint | null {
    const viewCenter = applyTransform(invertTransform(view), [0, 0]);
    const bounds = viewDiskWorldBounds(viewCenter, Math.sqrt(DISK_EDGE_EPSILON));
    const candidates = this.tiling.coarseGridIndex.queryDisk(bounds.center, bounds.radius);
    return nearestVisibleGridPoint(clientX, clientY, candidates, view, viewport);
  }
}
