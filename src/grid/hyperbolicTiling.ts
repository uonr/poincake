import { abs2, type Complex } from '../geometry/complex';
import type { DiskPoint } from '../geometry/disk';
import { reflectInGeodesic } from '../geometry/hyperbolic';
import type { DiskTransform } from '../geometry/mobius';
import { GridPointSpatialIndex } from './spatialIndex';
import { hyperbolicEdgeSamples, TILE_P, TILE_Q, tileSymmetryTransformForWalk } from './tileWalk';
import { edgeIndex, type GridAnchor, gridAnchor, type ReducedWalk } from './tilingAddress';

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

// Grid points carry their chart-local identity directly. Snapping can then bind
// that local identity to the current chart without reverse-parsing a near-boundary
// floating-point scene coordinate.
export type GridPoint = Readonly<{
  id: GridId;
  layer: GridPointLayer;
  point: DiskPoint;
  anchor: GridAnchor;
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

export const gridIdKey = (id: GridId): string => `${id.xi},${id.yi}`;

// A tiling symmetry that maps the central base tile onto another tile: `transform`
// is an orientation-preserving Möbius isometry with `transform([0, 0]) === center`.
// Because the {p,q} face is itself reflection-symmetric, every tile center is the
// image of the origin under such an isometry, so these double as the lattice of
// points we can re-anchor onto without changing the visible tiling.
export type AnchorSymmetry = Readonly<{
  center: DiskPoint;
  walk: ReducedWalk;
  transform: DiskTransform;
}>;

export type HyperbolicTiling = Readonly<{
  coarseGridPoints: readonly GridPoint[];
  coarseGridIndex: GridPointSpatialIndex;
  anchorSymmetries: readonly AnchorSymmetry[];
  // Needed to re-canonicalize a snapped scene point into a grid anchor; the edge
  // subdivision count is part of an edge anchor's identity.
  edgeSubdivisions: number;
}>;

// Only tiles within this radius are kept as re-anchor targets. The view-center is
// snapped back below ~0.7 on every reanchor, so symmetries near the disk edge are
// never the closest candidate and would only bloat the nearest-symmetry scan.
const ANCHOR_MAX_RADIUS2 = 0.9 * 0.9;

type GridTile = Readonly<{
  id: string;
  walk: ReducedWalk;
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
  edgeSubdivisions: 6,
};

export const generateHyperbolicTiling = (
  options: Partial<HyperbolicTilingOptions> = {},
): HyperbolicTiling => {
  const config = { ...DEFAULT_TILING, ...options };
  validateTiling(config.p, config.q);
  validateMaxRadius(config.maxRadius);
  validateMaxTiles(config.maxTiles);
  validateSubdivisions(config.edgeSubdivisions);

  const { points, anchorSymmetries } = buildTiling(config);
  const coarse = [...points.values()];

  return {
    coarseGridPoints: coarse,
    coarseGridIndex: new GridPointSpatialIndex(coarse),
    anchorSymmetries,
    edgeSubdivisions: config.edgeSubdivisions,
  };
};

const buildTiling = (
  config: TilingConfig,
): {
  points: Map<string, GridPoint>;
  anchorSymmetries: AnchorSymmetry[];
} => {
  const maxRadius2 = config.maxRadius * config.maxRadius;
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
          walk: tile.walk,
          transform: tileSymmetryTransformForWalk(tile.walk),
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
        walk: gridAnchor([...tile.walk, edgeIndex(i)], { kind: 'center' }).walk,
        center: reflectedCenter,
        vertices: tile.vertices.map((vertex) => reflectInGeodesic(vertex, a, b)),
      });
    }
  }

  return { points: coarseGridPoints, anchorSymmetries };
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
    walk: gridAnchor([], { kind: 'center' }).walk,
    center: [0, 0],
    vertices: Array.from({ length: p }, (_, index): DiskPoint => {
      const angle = angleOffset + (index * Math.PI * 2) / p;
      return [Math.cos(angle) * diskRadius, Math.sin(angle) * diskRadius];
    }),
  };
};

// Emit the renderable grid points for a tile. Shared vertices and edges are
// deduplicated by their quantized id, so each physical point lands in the buffer
// once regardless of which tile emitted it first.
const collectTile = (
  tile: GridTile,
  coarseGridPoints: Map<string, GridPoint>,
  config: TilingConfig,
): void => {
  if (config.includeTileCenters) {
    addCoarseGridPoint(
      tile.center,
      gridAnchor(tile.walk, { kind: 'center' }),
      coarseGridPoints,
      config,
    );
  }

  for (let i = 0; i < tile.vertices.length; i += 1) {
    const vertex = tile.vertices[i];
    if (vertex) {
      addCoarseGridPoint(
        vertex,
        gridAnchor(tile.walk, { kind: 'vertex', index: i }),
        coarseGridPoints,
        config,
      );
    }
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

    const samples = hyperbolicEdgeSamples(a, b, config.edgeSubdivisions);
    for (let subdivision = 1; subdivision < config.edgeSubdivisions; subdivision += 1) {
      const point = samples[subdivision - 1];
      if (!point) {
        continue;
      }
      addCoarseGridPoint(
        point,
        gridAnchor(tile.walk, {
          kind: 'edge',
          index: i,
          subdivision,
          subdivisions: config.edgeSubdivisions,
        }),
        coarseGridPoints,
        config,
      );
    }
  }
};

const addCoarseGridPoint = (
  point: DiskPoint,
  anchor: GridAnchor,
  coarseGridPoints: Map<string, GridPoint>,
  config: TilingConfig,
): void => {
  const gridPoint = createGridPoint(point, anchor, config);
  if (!gridPoint) {
    return;
  }

  const pointKey = gridIdKey(gridPoint.id);
  if (!coarseGridPoints.has(pointKey)) {
    coarseGridPoints.set(pointKey, gridPoint);
  }
};

const createGridPoint = (
  point: DiskPoint,
  anchor: GridAnchor,
  config: TilingConfig,
): GridPoint | null => {
  if (abs2(point) > config.maxRadius * config.maxRadius) {
    return null;
  }

  return {
    id: { xi: Math.round(point[0] * GRID_PRECISION), yi: Math.round(point[1] * GRID_PRECISION) },
    layer: 'coarse',
    point: [point[0], point[1]],
    anchor,
  };
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

  // The persistent coordinate system (tileWalk/tileCanonical) is specialized to
  // the {3,7} tiling. Reject anything else rather than build a tiling whose
  // anchors the resolver would silently mislabel.
  if (p !== TILE_P || q !== TILE_Q) {
    throw new Error(`The coordinate system is locked to {${TILE_P},${TILE_Q}}, got {${p},${q}}.`);
  }
};

const validateSubdivisions = (edgeSubdivisions: number): void => {
  if (!Number.isInteger(edgeSubdivisions) || edgeSubdivisions < 1) {
    throw new Error('Grid edge subdivisions must be a positive integer.');
  }
};

const validateMaxRadius = (maxRadius: number): void => {
  if (!Number.isFinite(maxRadius) || maxRadius <= 0 || maxRadius >= 1) {
    throw new Error('Tiling maxRadius must be finite and inside the unit disk.');
  }
};

const validateMaxTiles = (maxTiles: number): void => {
  if (!Number.isInteger(maxTiles) || maxTiles < 1) {
    throw new Error('Tiling maxTiles must be a positive integer.');
  }
};
