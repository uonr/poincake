import { DISK_EDGE_EPSILON } from '../geometry/disk';
import {
  applyTransform,
  composeTransforms,
  type DiskTransform,
  identityTransform,
  invertTransform,
} from '../geometry/mobius';
import type { Viewport } from '../render/viewport';
import type { GridPoint, HyperbolicTiling } from './hyperbolicTiling';
import { nearestVisibleGridPoint } from './snap';
import { viewDiskWorldBounds } from './spatialIndex';

export type AnchoredGridView = Readonly<{
  points: readonly GridPoint[];
  transform: DiskTransform;
}>;

export class AnchoredGrid {
  private gridToWorld: DiskTransform = identityTransform;

  constructor(readonly tiling: HyperbolicTiling) {}

  reanchor(transform: DiskTransform): void {
    this.gridToWorld = composeTransforms(transform, this.gridToWorld);
  }

  visiblePoints(view: DiskTransform, maxViewRadius: number): AnchoredGridView {
    const gridView = composeTransforms(view, this.gridToWorld);
    const viewCenter = applyTransform(invertTransform(gridView), [0, 0]);
    const bounds = viewDiskWorldBounds(viewCenter, maxViewRadius);

    return {
      points: this.tiling.coarseGridIndex.queryDisk(bounds.center, bounds.radius),
      transform: gridView,
    };
  }

  snapScreenPoint(
    clientX: number,
    clientY: number,
    view: DiskTransform,
    viewport: Viewport,
  ): GridPoint | null {
    const visible = this.visiblePoints(view, Math.sqrt(DISK_EDGE_EPSILON));
    const gridPoint = nearestVisibleGridPoint(
      clientX,
      clientY,
      visible.points,
      visible.transform,
      viewport,
    );

    if (!gridPoint) {
      return null;
    }

    return {
      ...gridPoint,
      point: applyTransform(this.gridToWorld, gridPoint.point),
    };
  }
}
