import { abs2 } from '../geometry/complex';
import type { DiskPoint } from '../geometry/disk';
import { reflectInGeodesic } from '../geometry/hyperbolic';
import {
  applyTransform,
  composeTransforms,
  type DiskTransform,
  invertTransform,
  transformFromPointPair,
} from '../geometry/mobius';
import { type AbsoluteWalk, type GridAnchor, walkKey } from './tilingAddress';

// The scene tiling is locked to {p,q} = {3,7}: triangular faces, seven meeting at
// every vertex. These two constants are the only place that assumption lives.
export const TILE_P = 3;
export const TILE_Q = 7;

export type ResolvedTile = Readonly<{
  center: DiskPoint;
  vertices: readonly DiskPoint[];
}>;

const cot = (value: number): number => 1 / Math.tan(value);

// The {3,7} face centered at the origin, first vertex at angle pi/p. Pinned to the
// scene frame forever: every absolute walk is replayed starting from here.
const buildBaseTile = (): ResolvedTile => {
  const circumradius = Math.acosh(cot(Math.PI / TILE_P) * cot(Math.PI / TILE_Q));
  const diskRadius = Math.tanh(circumradius / 2);
  const angleOffset = Math.PI / TILE_P;

  return {
    center: [0, 0],
    vertices: Array.from({ length: TILE_P }, (_, index): DiskPoint => {
      const angle = angleOffset + (index * Math.PI * 2) / TILE_P;
      return [Math.cos(angle) * diskRadius, Math.sin(angle) * diskRadius];
    }),
  };
};

export const baseTile: ResolvedTile = buildBaseTile();

// Reflect a tile across its own edge `edgeIndex` (the geodesic through vertices
// edgeIndex and edgeIndex+1). Reflection fixes the two shared vertices, so the
// neighbour keeps the same per-vertex indexing — that invariant is what lets a
// walk's edge indices stay meaningful tile-to-tile.
export const reflectTile = (tile: ResolvedTile, edgeIndex: number): ResolvedTile => {
  const a = tile.vertices[edgeIndex];
  const b = tile.vertices[(edgeIndex + 1) % TILE_P];
  if (!a || !b) {
    throw new Error(`Tile edge index ${edgeIndex} is out of range.`);
  }

  return {
    center: reflectInGeodesic(tile.center, a, b),
    vertices: tile.vertices.map((vertex) => reflectInGeodesic(vertex, a, b)),
  };
};

// Replay a walk into a concrete tile. Memoized on the full walk key so per-frame
// anchor resolution is O(1) after first touch; deep walks are still exact because
// every step is a single geodesic reflection.
const resolvedTiles = new Map<string, ResolvedTile>([[walkKey([]), baseTile]]);

export const resolveTile = (walk: AbsoluteWalk): ResolvedTile => {
  const key = walkKey(walk);
  const cached = resolvedTiles.get(key);
  if (cached) {
    return cached;
  }

  let tile = baseTile;
  for (const edgeIndex of walk) {
    tile = reflectTile(tile, edgeIndex);
  }
  resolvedTiles.set(key, tile);
  return tile;
};

// Orientation-preserving tiling symmetry that maps the base tile onto `walk`'s
// tile while aligning vertex 0. This is the symbolic counterpart of the
// finite-builder reanchor transforms: persist the walk, derive the transform.
export const tileSymmetryTransformForWalk = (walk: AbsoluteWalk): DiskTransform => {
  const tile = resolveTile(walk);
  const firstVertex = tile.vertices[0];
  if (!firstVertex) {
    throw new Error('Cannot build a tile symmetry without vertex 0.');
  }

  const toCenter = transformFromPointPair([0, 0], tile.center);
  const aligned = applyTransform(invertTransform(toCenter), firstVertex);
  const angleOffset = Math.PI / TILE_P;
  const half = (Math.atan2(aligned[1], aligned[0]) - angleOffset) / 2;
  const rotation: DiskTransform = { a: [Math.cos(half), Math.sin(half)], b: [0, 0] };
  return composeTransforms(toCenter, rotation);
};

// Interior samples of the geodesic segment a->b, matching the tiling builder: it
// returns `subdivisions - 1` points, the k-th (1-indexed) at hyperbolic fraction
// k / subdivisions along the segment.
export const hyperbolicEdgeSamples = (
  a: DiskPoint,
  b: DiskPoint,
  subdivisions: number,
): DiskPoint[] => {
  const toOrigin = transformFromPointPair(a, [0, 0]);
  const bFromOrigin = applyTransform(toOrigin, b);
  const radius = Math.sqrt(abs2(bFromOrigin));

  if (radius < 1e-12) {
    return [];
  }

  const points: DiskPoint[] = [];
  const fromOrigin = invertTransform(toOrigin);
  const distance = Math.atanh(Math.min(radius, 0.999999999999));
  const ux = bFromOrigin[0] / radius;
  const uy = bFromOrigin[1] / radius;

  for (let segment = 1; segment < subdivisions; segment += 1) {
    const interpolatedRadius = Math.tanh((segment / subdivisions) * distance);
    points.push(applyTransform(fromOrigin, [ux * interpolatedRadius, uy * interpolatedRadius]));
  }

  return points;
};

// Derive the scene-frame disk point for an anchor purely from its combinatorial
// address. No chart, no session state — the same anchor always resolves to the
// same point, which is the whole point of the persistent coordinate system.
export const resolveAnchorScene = (anchor: GridAnchor): DiskPoint => {
  const tile = resolveTile(anchor.walk);
  switch (anchor.local.kind) {
    case 'center':
      return tile.center;
    case 'vertex': {
      const vertex = tile.vertices[anchor.local.index];
      if (!vertex) {
        throw new Error(`Vertex index ${anchor.local.index} is out of range.`);
      }
      return vertex;
    }
    case 'edge': {
      const a = tile.vertices[anchor.local.index];
      const b = tile.vertices[(anchor.local.index + 1) % TILE_P];
      if (!a || !b) {
        throw new Error(`Edge index ${anchor.local.index} is out of range.`);
      }
      const samples = hyperbolicEdgeSamples(a, b, anchor.local.subdivisions);
      const point = samples[anchor.local.subdivision - 1];
      if (!point) {
        throw new Error(
          `Edge subdivision ${anchor.local.subdivision}/${anchor.local.subdivisions} is out of range.`,
        );
      }
      return point;
    }
  }
};

// Hyperbolic distance in the Poincaré disk. Used for nearest-tile descent, where
// Euclidean distance is not monotone enough to be reliable near the boundary.
export const hyperbolicDistance = (z: DiskPoint, w: DiskPoint): number => {
  const dx = z[0] - w[0];
  const dy = z[1] - w[1];
  const denom = (1 - abs2(z)) * (1 - abs2(w));
  if (denom <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.acosh(1 + (2 * (dx * dx + dy * dy)) / denom);
};
