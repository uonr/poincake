import { describe, expect, it } from 'vitest';
import { abs2 } from '../src/geometry/complex';
import type { DiskPoint } from '../src/geometry/disk';
import {
  applyTransform,
  composeTransforms,
  identityTransform,
  invertTransform,
  transformFromPointPair,
} from '../src/geometry/mobius';
import { AnchoredGrid, type GridChartSnapshot } from '../src/grid/anchoredGrid';
import { generateHyperbolicTiling } from '../src/grid/hyperbolicTiling';
import { canonicalizeFromScene } from '../src/grid/tileCanonical';
import { resolveAnchorScene, tileSymmetryTransformForWalk } from '../src/grid/tileWalk';
import { gridAnchor, gridAnchorKey, ROOT_CHART_ID, rootWalk } from '../src/grid/tilingAddress';
import { projectDiskPoint, type Viewport } from '../src/render/viewport';

const resolveChartSnapshot = (
  charts: readonly GridChartSnapshot[],
  chartId: string,
): ReturnType<typeof tileSymmetryTransformForWalk> => {
  const chart = charts.find((candidate) => candidate.id === chartId);
  if (!chart?.parentId) {
    return identityTransform;
  }
  return composeTransforms(
    resolveChartSnapshot(charts, chart.parentId),
    tileSymmetryTransformForWalk(chart.transition),
  );
};

describe('hyperbolic tiling', () => {
  it('generates snap points inside the configured boundary', () => {
    const maxRadius = 0.96;
    const tiling = generateHyperbolicTiling({ maxRadius, maxTiles: 400 });

    expect(tiling.coarseGridPoints.length).toBeGreaterThan(0);

    for (const gridPoint of tiling.coarseGridPoints) {
      expect(abs2(gridPoint.point)).toBeLessThanOrEqual(maxRadius * maxRadius);
    }
  });

  it('rejects tiling radii that do not stay inside the Poincare disk', () => {
    expect(() => generateHyperbolicTiling({ maxRadius: 0 })).toThrow(/inside the unit disk/);
    expect(() => generateHyperbolicTiling({ maxRadius: 1 })).toThrow(/inside the unit disk/);
    expect(() => generateHyperbolicTiling({ maxRadius: 1.1 })).toThrow(/inside the unit disk/);
  });

  it('keeps shared grid points on one canonical identity', () => {
    const tiling = generateHyperbolicTiling({ maxRadius: 0.75, maxTiles: 8 });

    // Canonicalizing each grid point round-trips to its own coordinate, and any
    // two grid points that canonicalize to the same anchor are the same point —
    // a vertex shared by several tiles has exactly one identity.
    const byKey = new Map<string, DiskPoint>();
    for (const gridPoint of tiling.coarseGridPoints) {
      const anchor = canonicalizeFromScene(gridPoint.point, tiling.edgeSubdivisions);
      const resolved = resolveAnchorScene(anchor);
      expect(resolved[0]).toBeCloseTo(gridPoint.point[0], 9);
      expect(resolved[1]).toBeCloseTo(gridPoint.point[1], 9);

      const previous = byKey.get(gridAnchorKey(anchor));
      if (previous) {
        expect(previous[0]).toBeCloseTo(gridPoint.point[0], 9);
        expect(previous[1]).toBeCloseTo(gridPoint.point[1], 9);
      } else {
        byKey.set(gridAnchorKey(anchor), gridPoint.point);
      }
    }
    expect(byKey.size).toBeGreaterThan(0);
  });

  it('resolves a walk that immediately backtracks to its root tile', () => {
    // [0, 0] reflects across edge 0 and straight back: a non-canonical walk that
    // must still resolve to the same point the canonical root walk does.
    const rootCenter = gridAnchor(rootWalk, { kind: 'center' });
    const backtracked = gridAnchor([0, 0], { kind: 'center' });

    const canonicalPoint = resolveAnchorScene(rootCenter);
    const backtrackedPoint = resolveAnchorScene(backtracked);

    expect(backtrackedPoint[0]).toBeCloseTo(canonicalPoint[0], 10);
    expect(backtrackedPoint[1]).toBeCloseTo(canonicalPoint[1], 10);
  });

  it('reaches close to the edge without using a Euclidean lattice', () => {
    const tiling = generateHyperbolicTiling({ maxRadius: 0.99, maxTiles: 1000 });

    expect(tiling.coarseGridPoints.some((gp) => abs2(gp.point) > 0.9 * 0.9)).toBe(true);
  });

  it('keeps enough visible snap points for the initial view', () => {
    const tiling = generateHyperbolicTiling();
    const initialViewPoints = tiling.coarseGridPoints.filter((gp) => abs2(gp.point) <= 0.92 * 0.92);

    expect(initialViewPoints.length).toBeGreaterThan(700);
  });

  it('keeps snapped points on the same world grid after the view moves', () => {
    const tiling = generateHyperbolicTiling({ maxRadius: 0.8, maxTiles: 80 });
    const grid = new AnchoredGrid(tiling);
    const view = transformFromPointPair([0.5, 0], [0, 0]);
    const viewport: Viewport = {
      width: 800,
      height: 600,
      left: 0,
      top: 0,
      cx: 400,
      cy: 300,
      radius: 500,
      zoom: 1,
      visualScale: 1,
    };
    const gridPoint = tiling.coarseGridPoints.find(
      (candidate) => abs2(applyTransform(view, candidate.point)) < 0.2 * 0.2,
    );

    expect(gridPoint).toBeDefined();

    if (!gridPoint) {
      return;
    }

    const projected = projectDiskPoint(applyTransform(view, gridPoint.point), viewport);
    const snapped = grid.snapScreenPoint(projected.x, projected.y, view, viewport);

    expect(snapped?.point[0]).toBeCloseTo(gridPoint.point[0], 10);
    expect(snapped?.point[1]).toBeCloseTo(gridPoint.point[1], 10);
  });

  it('keeps the same visible grid through reanchoring', () => {
    const tiling = generateHyperbolicTiling({ maxRadius: 0.85, maxTiles: 160 });
    const grid = new AnchoredGrid(tiling);
    const view = transformFromPointPair([0.55, 0.15], [0, 0]);
    const viewport: Viewport = {
      width: 800,
      height: 600,
      left: 0,
      top: 0,
      cx: 400,
      cy: 300,
      radius: 500,
      zoom: 1,
      visualScale: 1,
    };
    const original = tiling.coarseGridPoints.find(
      (candidate) => abs2(candidate.point) < 0.35 * 0.35,
    );

    expect(original).toBeDefined();

    if (!original) {
      return;
    }

    const expected = applyTransform(view, original.point);
    const projected = projectDiskPoint(expected, viewport);

    grid.reanchor(view);

    const snapped = grid.snapScreenPoint(projected.x, projected.y, identityTransform, viewport);

    expect(snapped?.point[0]).toBeCloseTo(expected[0], 10);
    expect(snapped?.point[1]).toBeCloseTo(expected[1], 10);
  });

  it('reanchors without rebuilding the generated tiling index', () => {
    const tiling = generateHyperbolicTiling({ maxRadius: 0.85, maxTiles: 160 });
    const grid = new AnchoredGrid(tiling);

    grid.reanchor(transformFromPointPair([0.55, 0.15], [0, 0]));

    expect(grid.tiling).toBe(tiling);
    expect(grid.tiling.coarseGridIndex).toBe(tiling.coarseGridIndex);
  });

  it('keeps the grid populated after panning far across the plane', () => {
    const tiling = generateHyperbolicTiling();
    const grid = new AnchoredGrid(tiling);
    const drawRadius = Math.sqrt(0.94 * 0.94);

    // One sustained pan reaches the reanchor budget; repeating it walks the view
    // far enough across the hyperbolic plane to run off the un-snapped tiling.
    const panStep = transformFromPointPair([0, 0], [0, 0.5]);

    const baseline = grid.visiblePoints(identityTransform, drawRadius).points.length;
    expect(baseline).toBeGreaterThan(1000);

    let worst = baseline;
    for (let i = 0; i < 20; i += 1) {
      grid.reanchor(panStep);
      worst = Math.min(worst, grid.visiblePoints(identityTransform, drawRadius).points.length);
    }

    // Without symmetry-snapping the count collapsed toward zero (~160 after 8 pans).
    expect(worst).toBeGreaterThan(1000);
  });

  it('snaps the grid-local view-center back near the origin on reanchor', () => {
    const tiling = generateHyperbolicTiling();
    const grid = new AnchoredGrid(tiling);
    const panStep = transformFromPointPair([0, 0], [0, 0.5]);

    for (let i = 0; i < 20; i += 1) {
      grid.reanchor(panStep);
    }

    const view = grid.visiblePoints(identityTransform, 1);
    const viewCenter = applyTransform(invertTransform(view.transform), [0, 0]);
    expect(abs2(viewCenter)).toBeLessThan(0.7 * 0.7);
  });

  it('keeps anchor identity stable when reanchoring absorbs tiling symmetries', () => {
    const tiling = generateHyperbolicTiling();
    const grid = new AnchoredGrid(tiling);
    const near = tiling.coarseGridPoints.find((candidate) => abs2(candidate.point) < 0.2 * 0.2);
    const anchor = near && canonicalizeFromScene(near.point, tiling.edgeSubdivisions);
    const panStep = transformFromPointPair([0, 0], [0, 0.5]);

    expect(anchor).toBeDefined();
    if (!anchor) {
      return;
    }

    let expected = grid.worldPointForAnchor(anchor);

    for (let i = 0; i < 20; i += 1) {
      expected = applyTransform(panStep, expected);
      grid.reanchor(panStep);
    }

    const actual = grid.worldPointForAnchor(anchor);
    expect(actual[0]).toBeCloseTo(expected[0], 10);
    expect(actual[1]).toBeCloseTo(expected[1], 10);
  });

  it('snaps to anchors that resolve back to the clicked point after distant reanchors', () => {
    const tiling = generateHyperbolicTiling();
    const grid = new AnchoredGrid(tiling);
    // A deep but in-envelope pan: ~14 reflections from the origin, where the fold
    // round-trips to float64 precision. (Far beyond ~17 the fold degrades; see the
    // precision-envelope note in tileCanonical.)
    const panStep = transformFromPointPair([0, 0], [0, 0.3]);
    const viewport: Viewport = {
      width: 800,
      height: 600,
      left: 0,
      top: 0,
      cx: 400,
      cy: 300,
      radius: 500,
      zoom: 1,
      visualScale: 1,
    };

    for (let i = 0; i < 10; i += 1) {
      grid.reanchor(panStep);
    }

    const visible = grid.visiblePoints(identityTransform, 0.5);
    const target = visible.points.find(
      (candidate) => abs2(applyTransform(visible.transform, candidate.point)) < 0.1 * 0.1,
    );

    expect(target).toBeDefined();
    if (!target) {
      return;
    }

    const clicked = applyTransform(visible.transform, target.point);
    const projected = projectDiskPoint(clicked, viewport);
    const snapped = grid.snapScreenPoint(projected.x, projected.y, identityTransform, viewport);

    expect(snapped).toBeDefined();
    if (!snapped) {
      return;
    }

    const resolved = grid.worldPointForAnchor(snapped.anchor);
    expect(resolved[0]).toBeCloseTo(snapped.point[0], 10);
    expect(resolved[1]).toBeCloseTo(snapped.point[1], 10);
    // After distant reanchoring the anchor remains shallow and records the chart
    // that gives that local address its scene meaning.
    expect(snapped.anchor.chartId).not.toBe(ROOT_CHART_ID);
    expect(snapped.anchor.walk.length).toBeLessThan(8);
  });

  it('resolves a chart-relative anchor on a fresh grid when its chart graph is restored', () => {
    const tiling = generateHyperbolicTiling();
    const panned = new AnchoredGrid(tiling);
    const panStep = transformFromPointPair([0, 0], [0, 0.3]);
    const viewport: Viewport = {
      width: 800,
      height: 600,
      left: 0,
      top: 0,
      cx: 400,
      cy: 300,
      radius: 500,
      zoom: 1,
      visualScale: 1,
    };

    for (let i = 0; i < 10; i += 1) {
      panned.reanchor(panStep);
    }

    const visible = panned.visiblePoints(identityTransform, 0.5);
    const target = visible.points.find(
      (candidate) => abs2(applyTransform(visible.transform, candidate.point)) < 0.1 * 0.1,
    );
    expect(target).toBeDefined();
    if (!target) {
      return;
    }
    const clicked = applyTransform(visible.transform, target.point);
    const snapped = panned.snapScreenPoint(
      projectDiskPoint(clicked, viewport).x,
      projectDiskPoint(clicked, viewport).y,
      identityTransform,
      viewport,
    );
    expect(snapped).toBeDefined();
    if (!snapped) {
      return;
    }
    expect(snapped.anchor.chartId).not.toBe(ROOT_CHART_ID);
    expect(snapped.anchor.walk.length).toBeLessThan(8);

    // A reload must persist the chart graph alongside notes; the note anchor itself
    // stays local instead of replaying the navigation as a deep root walk.
    const charts = panned.chartSnapshots();
    const fresh = new AnchoredGrid(tiling);
    fresh.restoreChartSnapshots(charts);
    const resolved = fresh.worldPointForAnchor(snapped.anchor);
    const direct = applyTransform(
      resolveChartSnapshot(charts, snapped.anchor.chartId),
      resolveAnchorScene(snapped.anchor),
    );
    expect(resolved[0]).toBeCloseTo(direct[0], 10);
    expect(resolved[1]).toBeCloseTo(direct[1], 10);
    expect(abs2(resolved)).toBeLessThan(1);
  });

  it('snaps to coarse grid points', () => {
    const tiling = generateHyperbolicTiling({ maxRadius: 0.8, maxTiles: 120 });
    const grid = new AnchoredGrid(tiling);
    const coarsePoint = tiling.coarseGridPoints.find(
      (candidate) => abs2(candidate.point) < 0.4 * 0.4,
    );
    const viewport: Viewport = {
      width: 800,
      height: 600,
      left: 0,
      top: 0,
      cx: 400,
      cy: 300,
      radius: 500,
      zoom: 1.2,
      visualScale: 1.2,
    };

    expect(coarsePoint).toBeDefined();

    if (!coarsePoint) {
      return;
    }

    const projected = projectDiskPoint(coarsePoint.point, viewport);
    const snapped = grid.snapScreenPoint(projected.x, projected.y, identityTransform, viewport);

    expect(snapped?.id).toEqual(coarsePoint.id);
    expect(snapped?.layer).toBe('coarse');
  });
});
