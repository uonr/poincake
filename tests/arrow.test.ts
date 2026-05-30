import { describe, expect, it } from 'vitest';
import { abs2 } from '../src/geometry/complex';
import { sampleGeodesic } from '../src/geometry/hyperbolic';
import { applyTransform, transformFromPointPair } from '../src/geometry/mobius';
import { AnchoredGrid } from '../src/grid/anchoredGrid';
import { generateHyperbolicTiling } from '../src/grid/hyperbolicTiling';
import type { Arrow } from '../src/model/arrow';
import { applyWorldCommand, applyWorldPatch } from '../src/model/commands';
import { HyperbolicWorldState } from '../src/model/worldState';
import { anchorAt } from './support';

const createWorld = () => {
  const tiling = generateHyperbolicTiling({ maxRadius: 0.75, maxTiles: 80 });
  const grid = new AnchoredGrid(tiling);
  return new HyperbolicWorldState([], grid, []);
};

const makeArrow = (world: HyperbolicWorldState, id: string): Arrow => {
  const from = anchorAt(world.grid.tiling, 0);
  const to = anchorAt(world.grid.tiling, 1);
  if (!from || !to) {
    throw new Error('Test tiling did not generate enough grid anchors.');
  }

  return {
    id,
    from,
    to,
    label: '',
    appearance: { color: 'c1', headMode: 'end' },
    createdAt: 1,
    updatedAt: 1,
  };
};

describe('arrow commands', () => {
  it('creates an arrow and produces a reversible patch', () => {
    const world = createWorld();
    const arrow = makeArrow(world, 'arrow-0');

    const result = applyWorldCommand(world, { type: 'create-arrow', arrow });

    expect(world.arrows.map((candidate) => candidate.id)).toEqual(['arrow-0']);
    expect(result.patch).toEqual({ type: 'create-arrow', arrow });

    if (!result.patch) {
      return;
    }

    applyWorldPatch(world, result.patch, 'backward');
    expect(world.arrows).toEqual([]);

    applyWorldPatch(world, result.patch, 'forward');
    expect(world.arrows.map((candidate) => candidate.id)).toEqual(['arrow-0']);
  });

  it('deletes an arrow and restores it from the patch', () => {
    const world = createWorld();
    applyWorldCommand(world, { type: 'create-arrow', arrow: makeArrow(world, 'arrow-0') });

    const result = applyWorldCommand(world, { type: 'delete-arrow', arrowId: 'arrow-0' });
    expect(world.arrows).toEqual([]);
    expect(result.patch).toBeDefined();

    if (!result.patch) {
      return;
    }

    applyWorldPatch(world, result.patch, 'backward');
    expect(world.arrows[0]?.id).toBe('arrow-0');
  });

  it('updates label and color through one reversible command', () => {
    const world = createWorld();
    applyWorldCommand(world, { type: 'create-arrow', arrow: makeArrow(world, 'arrow-0') });

    const result = applyWorldCommand(world, {
      type: 'update-arrow',
      arrowId: 'arrow-0',
      label: 'depends on',
      appearance: { color: 'c3', headMode: 'both' },
      updatedAt: 9,
    });

    expect(world.arrows[0]?.label).toBe('depends on');
    expect(world.arrows[0]?.appearance).toEqual({ color: 'c3', headMode: 'both' });
    expect(world.arrows[0]?.updatedAt).toBe(9);
    expect(result.patch).toEqual({
      type: 'update-arrow',
      arrowId: 'arrow-0',
      before: { label: '', appearance: { color: 'c1', headMode: 'end' }, updatedAt: 1 },
      after: { label: 'depends on', appearance: { color: 'c3', headMode: 'both' }, updatedAt: 9 },
    });

    if (!result.patch) {
      return;
    }

    applyWorldPatch(world, result.patch, 'backward');
    expect(world.arrows[0]?.label).toBe('');
    expect(world.arrows[0]?.appearance.color).toBe('c1');

    applyWorldPatch(world, result.patch, 'forward');
    expect(world.arrows[0]?.label).toBe('depends on');
    expect(world.arrows[0]?.appearance.color).toBe('c3');
  });

  it('does not produce a patch when updating a missing arrow', () => {
    const world = createWorld();
    const result = applyWorldCommand(world, {
      type: 'update-arrow',
      arrowId: 'missing',
      label: 'x',
      appearance: { color: 'c2', headMode: 'none' },
      updatedAt: 2,
    });
    expect(result.patch).toBeUndefined();
  });

  it('does not produce a patch when deleting a missing arrow', () => {
    const world = createWorld();
    const result = applyWorldCommand(world, { type: 'delete-arrow', arrowId: 'missing' });
    expect(result.patch).toBeUndefined();
  });

  it('carries arrow endpoints through reanchoring', () => {
    const world = createWorld();
    const arrow = makeArrow(world, 'arrow-0');
    applyWorldCommand(world, { type: 'create-arrow', arrow });

    const transform = transformFromPointPair([0.4, 0.1], [0, 0]);
    const initialFrom = world.grid.worldPointForAnchor(arrow.from);
    const initialTo = world.grid.worldPointForAnchor(arrow.to);
    const expectedFrom = applyTransform(transform, initialFrom ?? [0, 0]);
    const expectedTo = applyTransform(transform, initialTo ?? [0, 0]);

    applyWorldCommand(world, { type: 'reanchor-world', transform });

    const actualFrom = world.grid.worldPointForAnchor(arrow.from);
    const actualTo = world.grid.worldPointForAnchor(arrow.to);
    expect(world.arrows[0]?.from).toEqual(arrow.from);
    expect(world.arrows[0]?.to).toEqual(arrow.to);
    expect(actualFrom?.[0]).toBeCloseTo(expectedFrom[0], 10);
    expect(actualFrom?.[1]).toBeCloseTo(expectedFrom[1], 10);
    expect(actualTo?.[0]).toBeCloseTo(expectedTo[0], 10);
    expect(actualTo?.[1]).toBeCloseTo(expectedTo[1], 10);
  });
});

describe('geodesic sampling', () => {
  it('pins the polyline to both endpoints', () => {
    const a = [0.2, -0.1] as const;
    const b = [-0.35, 0.4] as const;
    const points = sampleGeodesic(a, b, 16);

    expect(points).toHaveLength(17);
    expect(points[0]).toEqual([a[0], a[1]]);
    expect(points[points.length - 1]).toEqual([b[0], b[1]]);
  });

  it('keeps every sample inside the unit disk', () => {
    const points = sampleGeodesic([0.7, 0.1], [-0.1, 0.72], 32);
    for (const point of points) {
      expect(abs2(point)).toBeLessThan(1);
    }
  });

  it('bows toward the origin relative to the straight chord', () => {
    // In the Poincaré disk a geodesic is an arc orthogonal to the boundary, so a
    // chord not through the origin bends inward: its midpoint sits closer to the
    // centre than the Euclidean chord's midpoint.
    const a = [0.5, -0.4] as const;
    const b = [0.5, 0.4] as const;
    const points = sampleGeodesic(a, b, 32);
    const mid = points[16];
    const chordMidX = (a[0] + b[0]) / 2;

    expect(mid).toBeDefined();
    if (!mid) {
      return;
    }
    expect(mid[0]).toBeLessThan(chordMidX);
    expect(mid[1]).toBeCloseTo(0, 10);
  });

  it('falls back to a straight line through the origin', () => {
    const points = sampleGeodesic([0.4, 0.2], [-0.4, -0.2], 8);
    const mid = points[4];
    expect(mid?.[0]).toBeCloseTo(0, 10);
    expect(mid?.[1]).toBeCloseTo(0, 10);
  });
});
