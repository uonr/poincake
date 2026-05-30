import { describe, expect, it } from 'vitest';
import { abs2 } from '../src/geometry/complex';
import {
  applyTransform,
  identityTransform,
  invertTransform,
  transformFromPointPair,
} from '../src/geometry/mobius';
import { AnchoredGrid } from '../src/grid/anchoredGrid';
import { generateHyperbolicTiling } from '../src/grid/hyperbolicTiling';
import { projectDiskPoint, type Viewport } from '../src/render/viewport';

describe('hyperbolic tiling', () => {
  it('generates snap points inside the configured boundary', () => {
    const maxRadius = 0.96;
    const tiling = generateHyperbolicTiling({ maxRadius, maxTiles: 400 });

    expect(tiling.coarseGridPoints.length).toBeGreaterThan(0);

    for (const gridPoint of tiling.coarseGridPoints) {
      expect(abs2(gridPoint.point)).toBeLessThanOrEqual(maxRadius * maxRadius);
    }
  });

  it('reaches close to the edge without using a Euclidean lattice', () => {
    const tiling = generateHyperbolicTiling({ maxRadius: 0.99, maxTiles: 1000 });

    expect(tiling.coarseGridPoints.some((gp) => abs2(gp.point) > 0.9 * 0.9)).toBe(true);
  });

  it('keeps enough visible snap points for the initial demo view', () => {
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
