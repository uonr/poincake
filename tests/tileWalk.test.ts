import { describe, expect, it } from 'vitest';
import { abs2 } from '../src/geometry/complex';
import {
  baseTile,
  hyperbolicDistance,
  reflectTile,
  resolveAnchorScene,
  resolveTile,
  TILE_P,
} from '../src/grid/tileWalk';
import { edgeIndex, gridAnchor } from '../src/grid/tilingAddress';

describe('tile walk replay', () => {
  it('resolves the root walk to the centered base tile', () => {
    const tile = resolveTile([]);
    expect(tile.center).toEqual([0, 0]);
    expect(tile.vertices).toHaveLength(TILE_P);
  });

  it('treats an edge reflection as an involution', () => {
    for (let edge = 0; edge < TILE_P; edge += 1) {
      const there = reflectTile(baseTile, edge);
      const back = reflectTile(there, edge);
      expect(back.center[0]).toBeCloseTo(baseTile.center[0], 12);
      expect(back.center[1]).toBeCloseTo(baseTile.center[1], 12);
      // A walk that immediately backtracks resolves to the root tile.
      const round = resolveTile([edgeIndex(edge), edgeIndex(edge)]);
      expect(round.center[0]).toBeCloseTo(0, 12);
      expect(round.center[1]).toBeCloseTo(0, 12);
    }
  });

  it('matches manual reflection for a multi-step walk', () => {
    const walk = [0, 1, 2, 0] as const;
    let manual = baseTile;
    for (const edge of walk) {
      manual = reflectTile(manual, edge);
    }
    const replayed = resolveTile(walk);
    expect(replayed.center[0]).toBeCloseTo(manual.center[0], 12);
    expect(replayed.center[1]).toBeCloseTo(manual.center[1], 12);
  });

  it('keeps reflected tiles inside the disk and away from the origin', () => {
    const neighbour = resolveTile([0]);
    expect(abs2(neighbour.center)).toBeGreaterThan(0);
    expect(abs2(neighbour.center)).toBeLessThan(1);
  });

  it('resolves local anchors of the root tile', () => {
    const center = resolveAnchorScene(gridAnchor([], { kind: 'center' }));
    expect(center).toEqual([0, 0]);

    for (let i = 0; i < TILE_P; i += 1) {
      const vertex = resolveAnchorScene(gridAnchor([], { kind: 'vertex', index: i }));
      expect(vertex).toEqual(baseTile.vertices[i]);
    }

    const edge = resolveAnchorScene(
      gridAnchor([], { kind: 'edge', index: 0, subdivision: 1, subdivisions: 2 }),
    );
    expect(abs2(edge)).toBeLessThan(1);
  });

  it('computes a symmetric, positive hyperbolic distance', () => {
    const v = baseTile.vertices[0];
    expect(v).toBeDefined();
    if (!v) {
      return;
    }
    const d = hyperbolicDistance([0, 0], v);
    expect(d).toBeGreaterThan(0);
    expect(hyperbolicDistance(v, [0, 0])).toBeCloseTo(d, 12);
    expect(hyperbolicDistance(v, v)).toBeCloseTo(0, 12);
  });
});
