import { abs2 } from '../geometry/complex';
import { DISK_EDGE_EPSILON } from '../geometry/disk';
import {
  applyTransform,
  composeTransforms,
  type DiskTransform,
  identityTransform,
  invertTransform,
} from '../geometry/mobius';
import type { Viewport } from '../render/viewport';
import { type GridPoint, type HyperbolicTiling, nearestAnchorSymmetry } from './hyperbolicTiling';
import { nearestVisibleGridPoint } from './snap';
import { viewDiskWorldBounds } from './spatialIndex';

// Once the grid-local view-center drifts past this radius we snap it back onto the
// nearest tiling symmetry. Kept below the per-pan reanchor budget so the snapped
// view-center can never approach the disk edge, where the finite tiling runs out.
const ANCHOR_SNAP_RADIUS2 = 0.7 * 0.7;

export type AnchoredGridView = Readonly<{
  points: readonly GridPoint[];
  transform: DiskTransform;
}>;

export class AnchoredGrid {
  private gridToWorld: DiskTransform = identityTransform;

  constructor(readonly tiling: HyperbolicTiling) {}

  reanchor(transform: DiskTransform): void {
    this.gridToWorld = composeTransforms(transform, this.gridToWorld);
    this.snapToTiling();
  }

  // Keep the grid-local view-center near the origin by absorbing a tiling symmetry
  // into gridToWorld. The symmetry maps the tiling onto itself, so the visible dots
  // are unchanged, but the spatial query is recentered onto the dense interior of
  // the finite tiling instead of drifting off its edge.
  private snapToTiling(): void {
    const viewCenter = applyTransform(invertTransform(this.gridToWorld), [0, 0]);
    if (abs2(viewCenter) <= ANCHOR_SNAP_RADIUS2) {
      return;
    }

    const symmetry = nearestAnchorSymmetry(this.tiling.anchorSymmetries, viewCenter);
    if (symmetry) {
      this.gridToWorld = composeTransforms(this.gridToWorld, symmetry.transform);
    }
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
