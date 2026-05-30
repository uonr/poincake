import { describe, expect, it } from 'vitest';
import { resolveTile, TILE_P, TILE_Q } from '../src/grid/tileWalk';
import { type AbsoluteWalk, edgeIndex, reduceWalk } from '../src/grid/tilingAddress';

const alternating = (a: number, b: number, length: number): AbsoluteWalk =>
  Array.from({ length }, (_, index) => edgeIndex(index % 2 === 0 ? a : b));

const expectSameResolvedTile = (a: AbsoluteWalk, b: AbsoluteWalk): void => {
  const ta = resolveTile(a);
  const tb = resolveTile(b);
  expect(ta.center[0]).toBeCloseTo(tb.center[0], 10);
  expect(ta.center[1]).toBeCloseTo(tb.center[1], 10);
  for (let i = 0; i < TILE_P; i += 1) {
    expect(ta.vertices[i]?.[0]).toBeCloseTo(tb.vertices[i]?.[0] ?? 0, 10);
    expect(ta.vertices[i]?.[1]).toBeCloseTo(tb.vertices[i]?.[1] ?? 0, 10);
  }
};

describe('walk reduction', () => {
  it('matches the local {3,7} relators used by resolveTile', () => {
    for (let i = 0; i < TILE_P; i += 1) {
      expectSameResolvedTile([edgeIndex(i), edgeIndex(i)], []);
      expect(reduceWalk([edgeIndex(i), edgeIndex(i)])).toEqual([]);
    }

    for (let i = 0; i < TILE_P; i += 1) {
      for (let j = 0; j < TILE_P; j += 1) {
        if (i === j) {
          continue;
        }
        const aroundVertex = alternating(i, j, TILE_Q * 2);
        expectSameResolvedTile(aroundVertex, []);
        expect(reduceWalk(aroundVertex)).toEqual([]);
      }
    }
  });

  it('uses the shorter side of an order-7 vertex loop', () => {
    expect(reduceWalk(alternating(0, 1, 8))).toEqual(alternating(1, 0, 6));
    expect(reduceWalk(alternating(2, 1, 13))).toEqual([edgeIndex(1)]);
  });
});
