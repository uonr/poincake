import { abs2, type Complex } from '../geometry/complex';
import type { DiskPoint } from '../geometry/disk';
import { reflectInGeodesic } from '../geometry/hyperbolic';
import {
  applyTransform,
  composeTransforms,
  type DiskTransform,
  invertTransform,
  transformFromPointPair,
} from '../geometry/mobius';
import { GridPointSpatialIndex } from './spatialIndex';

export type HyperbolicTilingOptions = Readonly<{
  p: number;
  q: number;
  maxRadius: number;
  maxTiles: number;
  includeTileCenters: boolean;
  edgeSubdivisions: number;
}>;

export type GridId = Readonly<{ xi: number; yi: number }>;

export type GridPointLayer = 'coarse';

export type GridPoint = Readonly<{
  id: GridId;
  layer: GridPointLayer;
  point: DiskPoint;
}>;

const GRID_PRECISION = 1e8;

export const gridIdToDiskPoint = (id: GridId): DiskPoint => [
  id.xi / GRID_PRECISION,
  id.yi / GRID_PRECISION,
];

export const diskPointToGridId = (point: DiskPoint): GridId => ({
  xi: Math.round(point[0] * GRID_PRECISION),
  yi: Math.round(point[1] * GRID_PRECISION),
});

const gridIdKey = (id: GridId): string => `${id.xi},${id.yi}`;

// A tiling symmetry that maps the central base tile onto another tile: `transform`
// is an orientation-preserving Möbius isometry with `transform([0, 0]) === center`.
// Because the {p,q} face is itself reflection-symmetric, every tile center is the
// image of the origin under such an isometry, so these double as the lattice of
// points we can re-anchor onto without changing the visible tiling.
export type AnchorSymmetry = Readonly<{
  center: DiskPoint;
  transform: DiskTransform;
}>;

export type HyperbolicTiling = Readonly<{
  coarseGridPoints: readonly GridPoint[];
  coarseGridIndex: GridPointSpatialIndex;
  anchorSymmetries: readonly AnchorSymmetry[];
}>;

// Only tiles within this radius are kept as re-anchor targets. The view-center is
// snapped back below ~0.7 on every reanchor, so symmetries near the disk edge are
// never the closest candidate and would only bloat the nearest-symmetry scan.
const ANCHOR_MAX_RADIUS2 = 0.9 * 0.9;

type GridTile = Readonly<{
  id: string;
  center: DiskPoint;
  vertices: readonly DiskPoint[];
}>;

type TilingConfig = HyperbolicTilingOptions;

const DEFAULT_TILING: HyperbolicTilingOptions = {
  p: 3,
  q: 7,
  maxRadius: 0.99985,
  maxTiles: 28000,
  includeTileCenters: true,
  edgeSubdivisions: 4,
};

export const generateHyperbolicTiling = (
  options: Partial<HyperbolicTilingOptions> = {},
): HyperbolicTiling => {
  const config = { ...DEFAULT_TILING, ...options };
  validateTiling(config.p, config.q);
  validateSubdivisions(config.edgeSubdivisions);

  const { points, anchorSymmetries } = buildTiling(config);
  const coarse = [...points.values()];

  return {
    coarseGridPoints: coarse,
    coarseGridIndex: new GridPointSpatialIndex(coarse),
    anchorSymmetries,
  };
};

const buildTiling = (
  config: TilingConfig,
): { points: Map<string, GridPoint>; anchorSymmetries: AnchorSymmetry[] } => {
  const maxRadius2 = config.maxRadius * config.maxRadius;
  const angleOffset = Math.PI / config.p;
  const baseTile = createCenteredTile(config.p, config.q);
  const queue: GridTile[] = [baseTile];
  const seenTiles = new Set([baseTile.id]);
  const coarseGridPoints = new Map<string, GridPoint>();
  const anchorSymmetries: AnchorSymmetry[] = [];
  let acceptedTileCount = 0;

  for (let cursor = 0; cursor < queue.length && acceptedTileCount < config.maxTiles; cursor += 1) {
    const tile = queue[cursor];
    if (!tile) {
      continue;
    }

    if (abs2(tile.center) <= maxRadius2) {
      acceptedTileCount += 1;
      collectTile(tile, coarseGridPoints, config);

      const firstVertex = tile.vertices[0];
      if (firstVertex && abs2(tile.center) <= ANCHOR_MAX_RADIUS2) {
        anchorSymmetries.push({
          center: tile.center,
          transform: tileSymmetryTransform(tile.center, firstVertex, angleOffset),
        });
      }
    }

    for (let i = 0; i < config.p; i += 1) {
      const a = tile.vertices[i];
      const b = tile.vertices[(i + 1) % config.p];
      if (!a || !b) {
        continue;
      }

      const reflectedCenter = reflectInGeodesic(tile.center, a, b);
      if (abs2(reflectedCenter) > maxRadius2) {
        continue;
      }

      const key = tileKey(reflectedCenter);
      if (seenTiles.has(key)) {
        continue;
      }

      seenTiles.add(key);
      queue.push({
        id: key,
        center: reflectedCenter,
        vertices: tile.vertices.map((vertex) => reflectInGeodesic(vertex, a, b)),
      });
    }
  }

  return { points: coarseGridPoints, anchorSymmetries };
};

// Build the orientation-preserving isometry that maps the base tile (centered at
// the origin, first vertex at `angleOffset`) onto a tile at `center` whose first
// vertex is `firstVertex`. It is the translation 0 -> center pre-composed with the
// rotation about the origin that aligns the first vertices, so it lands exactly on
// a tiling symmetry rather than an arbitrary translation (which would rotate the
// lattice and make the dots visibly jump on reanchor).
const tileSymmetryTransform = (
  center: DiskPoint,
  firstVertex: DiskPoint,
  angleOffset: number,
): DiskTransform => {
  const toCenter = transformFromPointPair([0, 0], center);
  const aligned = applyTransform(invertTransform(toCenter), firstVertex);
  const half = (Math.atan2(aligned[1], aligned[0]) - angleOffset) / 2;
  const rotation: DiskTransform = { a: [Math.cos(half), Math.sin(half)], b: [0, 0] };
  return composeTransforms(toCenter, rotation);
};

// Nearest re-anchor target to `point`, i.e. the tiling symmetry g minimizing
// |g([0, 0]) - point|. Composing gridToWorld with it pulls the view-center back
// toward the origin without disturbing the rendered tiling.
export const nearestAnchorSymmetry = (
  symmetries: readonly AnchorSymmetry[],
  point: DiskPoint,
): AnchorSymmetry | null => {
  let best: AnchorSymmetry | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const symmetry of symmetries) {
    const dx = symmetry.center[0] - point[0];
    const dy = symmetry.center[1] - point[1];
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = symmetry;
    }
  }
  return best;
};

const createCenteredTile = (p: number, q: number): GridTile => {
  const circumradius = Math.acosh(cot(Math.PI / p) * cot(Math.PI / q));
  const diskRadius = Math.tanh(circumradius / 2);
  const angleOffset = Math.PI / p;

  return {
    id: tileKey([0, 0]),
    center: [0, 0],
    vertices: Array.from({ length: p }, (_, index): DiskPoint => {
      const angle = angleOffset + (index * Math.PI * 2) / p;
      return [Math.cos(angle) * diskRadius, Math.sin(angle) * diskRadius];
    }),
  };
};

const collectTile = (
  tile: GridTile,
  coarseGridPoints: Map<string, GridPoint>,
  config: TilingConfig,
): void => {
  if (config.includeTileCenters) {
    addCoarseGridPoint(tile.center, coarseGridPoints, config);
  }

  for (const vertex of tile.vertices) {
    addCoarseGridPoint(vertex, coarseGridPoints, config);
  }

  for (let i = 0; i < config.p; i += 1) {
    const a = tile.vertices[i];
    const b = tile.vertices[(i + 1) % config.p];
    if (
      !a ||
      !b ||
      abs2(a) > config.maxRadius * config.maxRadius ||
      abs2(b) > config.maxRadius * config.maxRadius
    ) {
      continue;
    }

    for (const point of hyperbolicInterpolateSegments(a, b, config.edgeSubdivisions)) {
      addCoarseGridPoint(point, coarseGridPoints, config);
    }
  }
};

const addCoarseGridPoint = (
  point: DiskPoint,
  coarseGridPoints: Map<string, GridPoint>,
  config: TilingConfig,
): void => {
  const gridPoint = createGridPoint(point, config);
  if (gridPoint && !coarseGridPoints.has(gridIdKey(gridPoint.id))) {
    coarseGridPoints.set(gridIdKey(gridPoint.id), gridPoint);
  }
};

const createGridPoint = (point: DiskPoint, config: TilingConfig): GridPoint | null => {
  if (abs2(point) > config.maxRadius * config.maxRadius) {
    return null;
  }

  return {
    id: { xi: Math.round(point[0] * GRID_PRECISION), yi: Math.round(point[1] * GRID_PRECISION) },
    layer: 'coarse',
    point: [point[0], point[1]],
  };
};

const hyperbolicInterpolateSegments = (
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
    const interpolatedFromOrigin: DiskPoint = [ux * interpolatedRadius, uy * interpolatedRadius];

    points.push(applyTransform(fromOrigin, interpolatedFromOrigin));
  }

  return points;
};

const tileKey = (point: Complex): string =>
  `${Math.round(point[0] * GRID_PRECISION)},${Math.round(point[1] * GRID_PRECISION)}`;

const cot = (value: number): number => 1 / Math.tan(value);

const validateTiling = (p: number, q: number): void => {
  if (!Number.isInteger(p) || !Number.isInteger(q) || p < 3 || q < 3) {
    throw new Error('Hyperbolic tiling requires integer p and q values of at least 3.');
  }

  if ((p - 2) * (q - 2) <= 4) {
    throw new Error(`{${p},${q}} is not a hyperbolic tiling.`);
  }
};

const validateSubdivisions = (edgeSubdivisions: number): void => {
  if (!Number.isInteger(edgeSubdivisions) || edgeSubdivisions < 1) {
    throw new Error('Grid edge subdivisions must be a positive integer.');
  }
};
