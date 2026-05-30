import { abs2 } from '../geometry/complex';
import { clampDisk, clampInsideDisk, type DiskPoint } from '../geometry/disk';
import {
  applyTransform,
  composeTransforms,
  type DiskTransform,
  identityTransform,
  invertTransform,
} from '../geometry/mobius';
import { screenToDisk, type Viewport } from '../render/viewport';
import { type GridPoint, type HyperbolicTiling, nearestAnchorSymmetry } from './hyperbolicTiling';
import { nearestVisibleGridPoint } from './snap';
import { viewDiskWorldBounds } from './spatialIndex';
import { resolveAnchorScene, tileSymmetryTransformForWalk } from './tileWalk';
import {
  anchorInChart,
  type ChartId,
  type GridAnchor,
  type ReducedWalk,
  ROOT_CHART_ID,
  rootWalk,
} from './tilingAddress';

// Once the grid-local view-center drifts past this radius we snap it back onto the
// nearest tiling symmetry. Kept below the per-pan reanchor budget so the snapped
// view-center can never approach the disk edge, where the finite tiling runs out.
const ANCHOR_SNAP_RADIUS2 = 0.7 * 0.7;

// Radius (grid-local) of the neighbourhood queried around the cursor when
// snapping. Reanchoring keeps the cursor near the grid-local origin, so this
// covers the nearest dots while scanning a handful of points instead of every
// visible one — snapping must stay cheap enough to run on each pointer move.
const SNAP_QUERY_RADIUS = 0.35;

export type AnchoredGridView = Readonly<{
  points: readonly GridPoint[];
  transform: DiskTransform;
}>;

export type SnappedGridPoint = GridPoint & Readonly<{ anchor: GridAnchor }>;

export type GridChartSnapshot = Readonly<{
  id: ChartId;
  parentId: ChartId | null;
  transition: ReducedWalk;
}>;

export class AnchoredGrid {
  private gridToWorld: DiskTransform = identityTransform;
  // The net tiling symmetry absorbed by reanchoring. It names the current chart
  // and keeps rendering O(1); older chart transforms stay in chartToScene so
  // relative anchors can be resolved after navigation or reload.
  private netSymmetry: DiskTransform = identityTransform;
  private currentChartId: ChartId = ROOT_CHART_ID;
  private nextChartId = 1;
  private readonly chartGraph = new Map<ChartId, GridChartSnapshot>([
    [ROOT_CHART_ID, { id: ROOT_CHART_ID, parentId: null, transition: rootWalk }],
  ]);
  private readonly chartToSceneCache = new Map<ChartId, DiskTransform>([
    [ROOT_CHART_ID, identityTransform],
  ]);

  constructor(readonly tiling: HyperbolicTiling) {}

  chartSnapshots(): GridChartSnapshot[] {
    return [...this.chartGraph.values()];
  }

  restoreChartSnapshots(snapshots: readonly GridChartSnapshot[]): void {
    this.chartGraph.clear();
    this.chartGraph.set(ROOT_CHART_ID, { id: ROOT_CHART_ID, parentId: null, transition: rootWalk });
    for (const snapshot of snapshots) {
      this.chartGraph.set(snapshot.id, snapshot);
      const numericId = /^chart-(\d+)$/.exec(snapshot.id)?.[1];
      if (numericId) {
        this.nextChartId = Math.max(this.nextChartId, Number(numericId) + 1);
      }
    }
    this.chartToSceneCache.clear();
    this.chartToSceneCache.set(ROOT_CHART_ID, identityTransform);
  }

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
      // gridToWorld and netSymmetry both gain the symmetry on the right; for a
      // fixed scene anchor the two factors cancel, so absorbing a symmetry never
      // moves a placed note (see sceneToWorld below).
      this.gridToWorld = composeTransforms(this.gridToWorld, symmetry.transform);
      this.netSymmetry = composeTransforms(this.netSymmetry, symmetry.transform);
      const parentId = this.currentChartId;
      this.currentChartId = `chart-${this.nextChartId}`;
      this.nextChartId += 1;
      this.chartGraph.set(this.currentChartId, {
        id: this.currentChartId,
        parentId,
        transition: symmetry.walk,
      });
      this.chartToSceneCache.set(this.currentChartId, this.netSymmetry);
    }
  }

  // Per-frame transform for the GPU grid renderer: reanchoring lands here, in the
  // transform, so the static grid-local point buffer never needs re-uploading.
  worldView(view: DiskTransform): DiskTransform {
    return composeTransforms(view, this.gridToWorld);
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
  ): SnappedGridPoint | null {
    const gridView = composeTransforms(view, this.gridToWorld);
    // Only consider grid points near the cursor, not every visible dot: map the
    // cursor into the grid-local frame and query a small disk there.
    const cursorView = clampDisk(screenToDisk(clientX, clientY, viewport));
    const cursorLocal = applyTransform(invertTransform(gridView), cursorView);
    const candidates = this.tiling.coarseGridIndex.queryDisk(cursorLocal, SNAP_QUERY_RADIUS);
    const gridPoint = nearestVisibleGridPoint(clientX, clientY, candidates, gridView, viewport);

    if (!gridPoint) {
      return null;
    }

    return {
      ...gridPoint,
      anchor: anchorInChart(gridPoint.anchor, this.currentChartId),
      point: applyTransform(this.gridToWorld, gridPoint.point),
    };
  }

  // Fixed-scene -> current-world map. gridToWorld carries the camera while
  // netSymmetry⁻¹ undoes the chart symmetries the camera absorbed.
  private sceneToWorld(): DiskTransform {
    return composeTransforms(this.gridToWorld, invertTransform(this.netSymmetry));
  }

  worldPointForAnchor(anchor: GridAnchor): DiskPoint {
    const chartToScene = this.resolveChartToScene(anchor.chartId);
    // Deep anchors resolve near the disk boundary where float64 can round a vertex
    // to |z| >= 1; clamp so the result is always a legal disk point and can never
    // crash a downstream Möbius constructor (e.g. flyTo's transformFromPointPair).
    const scenePoint = applyTransform(chartToScene, resolveAnchorScene(anchor));
    return clampInsideDisk(applyTransform(this.sceneToWorld(), scenePoint));
  }

  private resolveChartToScene(chartId: ChartId): DiskTransform {
    const cached = this.chartToSceneCache.get(chartId);
    if (cached) {
      return cached;
    }

    const chart = this.chartGraph.get(chartId);
    if (!chart) {
      throw new Error(`Missing chart ${chartId} for persisted grid anchor.`);
    }
    if (!chart.parentId) {
      return identityTransform;
    }

    const parent = this.resolveChartToScene(chart.parentId);
    const transition = tileSymmetryTransformForWalk(chart.transition);
    const transform = composeTransforms(parent, transition);
    this.chartToSceneCache.set(chartId, transform);
    return transform;
  }
}
