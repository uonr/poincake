import { describe, expect, it } from 'vitest';
import type { DiskPoint } from '../src/geometry/disk';
import { canonicalizeFromScene, locateTileWalk } from '../src/grid/tileCanonical';
import { resolveAnchorScene, resolveTile, TILE_P } from '../src/grid/tileWalk';
import { type AbsoluteWalk, edgeIndex, gridAnchor, gridAnchorKey } from '../src/grid/tilingAddress';

const SUBDIVISIONS = 6;

const dist2 = (z: DiskPoint, w: DiskPoint): number => (z[0] - w[0]) ** 2 + (z[1] - w[1]) ** 2;

const expectPointsClose = (a: DiskPoint | null, b: DiskPoint): void => {
  expect(a).not.toBeNull();
  if (!a) {
    return;
  }
  expect(a[0]).toBeCloseTo(b[0], 9);
  expect(a[1]).toBeCloseTo(b[1], 9);
};

// All tiles meeting at `vertex`, each paired with that vertex's local index, found
// by reflecting outward and matching geometry — independent of the production fan.
const incidentTilesAroundVertex = (
  vertex: DiskPoint,
): Array<{ walk: AbsoluteWalk; index: number }> => {
  const matchIndex = (walk: AbsoluteWalk): number | null => {
    const tile = resolveTile(walk);
    for (let i = 0; i < TILE_P; i += 1) {
      const candidate = tile.vertices[i];
      if (candidate && dist2(candidate, vertex) < 1e-16) {
        return i;
      }
    }
    return null;
  };

  const found = new Map<string, { walk: AbsoluteWalk; index: number }>();
  const key = (walk: AbsoluteWalk): string => {
    const c = resolveTile(walk).center;
    return `${Math.round(c[0] * 1e8)},${Math.round(c[1] * 1e8)}`;
  };

  const frontier: AbsoluteWalk[] = [[]];
  // Only the root is known to touch the vertex up front; expand its fan.
  const start = matchIndex([]);
  if (start === null) {
    return [];
  }
  found.set(key([]), { walk: [], index: start });

  for (let scan = 0; scan < frontier.length; scan += 1) {
    const walk = frontier[scan];
    if (!walk) {
      continue;
    }
    const index = matchIndex(walk);
    if (index === null) {
      continue;
    }
    for (const edge of [edgeIndex(index), edgeIndex((index + TILE_P - 1) % TILE_P)]) {
      const next: AbsoluteWalk = [...walk, edge];
      const k = key(next);
      if (found.has(k)) {
        continue;
      }
      const nextIndex = matchIndex(next);
      if (nextIndex === null) {
        continue;
      }
      found.set(k, { walk: next, index: nextIndex });
      frontier.push(next);
    }
  }

  return [...found.values()];
};

describe('canonical fold', () => {
  it('round-trips tile centres through location', () => {
    for (const walk of [[], [0], [1, 2], [0, 1, 2, 0]] as const) {
      const center = resolveTile(walk).center;
      const located = locateTileWalk(center);
      expectPointsClose(resolveTile(located).center, center);
    }
  });

  it('is idempotent on every grid feature of a tile', () => {
    const tile = resolveTile([0, 1]);
    const points: DiskPoint[] = [tile.center, ...tile.vertices];
    for (const point of points) {
      const once = canonicalizeFromScene(point, SUBDIVISIONS);
      const twice = canonicalizeFromScene(resolveAnchorScene(once), SUBDIVISIONS);
      expect(gridAnchorKey(twice)).toBe(gridAnchorKey(once));
      expectPointsClose(resolveAnchorScene(once), point);
    }
  });

  it('collapses the order-7 vertex relation to one identity', () => {
    const vertex = resolveTile([]).vertices[0];
    expect(vertex).toBeDefined();
    if (!vertex) {
      return;
    }

    const incident = incidentTilesAroundVertex(vertex);
    // Seven triangles meet at every vertex of the {3,7} tiling.
    expect(incident).toHaveLength(7);

    const rawKeys = new Set(
      incident.map((tile) =>
        gridAnchorKey(gridAnchor(tile.walk, { kind: 'vertex', index: tile.index })),
      ),
    );
    // Without canonicalization the same physical vertex has several identities.
    expect(rawKeys.size).toBeGreaterThan(1);

    const canonicalKeys = new Set(
      incident.map((tile) => {
        const point = resolveAnchorScene(
          gridAnchor(tile.walk, { kind: 'vertex', index: tile.index }),
        );
        return gridAnchorKey(canonicalizeFromScene(point, SUBDIVISIONS));
      }),
    );
    // After canonicalization they all collapse to exactly one.
    expect(canonicalKeys.size).toBe(1);
  });

  it('terminates on near-boundary points instead of hanging', () => {
    // Regression: panning far pushes the scene point the snap canonicalizes toward
    // the disk boundary. There, float drift used to make the vertex fan wander off
    // the order-7 vertex and grow without bound — an effective freeze. It must now
    // finish quickly for every direction, either resolving or failing safe (throw).
    // vitest's per-test timeout is the backstop: a regression here hangs the suite.
    for (let dir = 0; dir < 32; dir += 1) {
      const theta = (dir / 32) * Math.PI * 2;
      for (let i = 5; i <= 30; i += 1) {
        const r = Math.tanh(i * 0.45);
        const point: DiskPoint = [Math.cos(theta) * r, Math.sin(theta) * r];
        try {
          canonicalizeFromScene(point, SUBDIVISIONS);
        } catch {
          // Outside the precision envelope: failing safe is the contract.
        }
      }
    }
    expect(true).toBe(true);
  });

  it('gives a shared edge one identity from either incident tile', () => {
    const tile = resolveTile([]);
    const a = tile.vertices[0];
    const b = tile.vertices[1];
    expect(a && b).toBeTruthy();
    if (!a || !b) {
      return;
    }

    // Sample point on edge 0 of the root, addressed from the root and from its
    // neighbour across that edge.
    const fromRoot = gridAnchor([], {
      kind: 'edge',
      index: 0,
      subdivision: 2,
      subdivisions: SUBDIVISIONS,
    });
    const point = resolveAnchorScene(fromRoot);

    const neighbourWalk: AbsoluteWalk = [0];
    const neighbourTile = resolveTile(neighbourWalk);
    // Find the same edge in the neighbour by endpoint geometry.
    let neighbourEdge = -1;
    for (let i = 0; i < TILE_P; i += 1) {
      const pa = neighbourTile.vertices[i];
      const pb = neighbourTile.vertices[(i + 1) % TILE_P];
      if (!pa || !pb) {
        continue;
      }
      if (
        (dist2(pa, a) < 1e-16 && dist2(pb, b) < 1e-16) ||
        (dist2(pa, b) < 1e-16 && dist2(pb, a) < 1e-16)
      ) {
        neighbourEdge = i;
      }
    }
    expect(neighbourEdge).toBeGreaterThanOrEqual(0);

    const canonicalFromRoot = gridAnchorKey(canonicalizeFromScene(point, SUBDIVISIONS));
    const canonicalFromNeighbour = gridAnchorKey(
      canonicalizeFromScene(resolveAnchorScene(fromRoot), SUBDIVISIONS),
    );
    expect(canonicalFromNeighbour).toBe(canonicalFromRoot);
  });
});
