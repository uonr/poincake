// Normal-form / point-location for the {3,7} scene tiling: parse any scene point
// into the unique canonical anchor of its grid feature (the inverse of
// resolveAnchorScene). This is where the order-7 vertex relation and shared-edge
// relation are resolved, giving identity comparison a sound basis.
//
// Precision envelope: built on float64 reflection replay, so the fold is exact to
// ~1e-10 within roughly 17 reflections of the origin and degrades exponentially
// beyond (each near-boundary reflection amplifies error ~7x). Placed anchors with
// shallow walks always resolve exactly regardless of how far the view has panned;
// only *new* snaps made astronomically far out lose precision, and past
// MAX_DESCENT_STEPS the fold gives up so callers can fail safe. Lifting this bound
// would require exact arithmetic over Z[2cos(pi/7)] — a deliberate future seam.
import type { DiskPoint } from '../geometry/disk';
import {
  baseTile,
  hyperbolicDistance,
  hyperbolicEdgeSamples,
  reflectTile,
  resolveTile,
  TILE_P,
  TILE_Q,
} from './tileWalk';
import {
  type AbsoluteWalk,
  compareWalks,
  type EdgeIndex,
  edgeIndex,
  type GridAnchor,
  gridAnchor,
} from './tilingAddress';

// A nudge below which two centers count as equidistant from the descent target,
// so the descent stops deterministically instead of chattering on rounding noise.
const DESCENT_EPSILON = 1e-12;

// Past this graph depth the target sits so close to the disk boundary that
// float64 reflection replay can no longer place its tile reliably, and greedy
// descent would otherwise ramble along the boundary. Hitting it means the request
// is outside the precision envelope; callers fail safe rather than crash.
const MAX_DESCENT_STEPS = 256;

// Exactly TILE_Q faces meet at a {3,7} vertex, so its fan visits at most that many
// tiles. Near the disk boundary, float drift can make a fan neighbour's canonical
// walk land on a tile that is not actually incident, and the fan then wanders off
// the vertex, growing the frontier without bound — each step paying a full descent,
// which reads as a hard freeze. Past this cap the point is outside the precision
// envelope: throw so callers (snap) fail safe instead of hanging. The small margin
// tolerates a stray drift step without rejecting legitimate in-envelope vertices.
const MAX_VERTEX_FAN = TILE_Q + 2;

const CENTER_PRECISION = 1e8;
const centerKey = (center: DiskPoint): string =>
  `${Math.round(center[0] * CENTER_PRECISION)},${Math.round(center[1] * CENTER_PRECISION)}`;

// Greedy nearest-centre descent from the root tile toward `target`. Each {3,7}
// face is the Dirichlet cell of its centre, so stepping to the strictly-closer
// neighbour centre cannot get stuck in a local minimum: it converges on the tile
// whose cell contains `target`. The recorded edge sequence is that tile's walk.
const descendToTile = (target: DiskPoint): AbsoluteWalk => {
  let tile = baseTile;
  const walk: EdgeIndex[] = [];

  for (let step = 0; step < MAX_DESCENT_STEPS; step += 1) {
    let bestEdge = -1;
    let bestDistance = hyperbolicDistance(tile.center, target);

    for (let edge = 0; edge < TILE_P; edge += 1) {
      const neighbour = reflectTile(tile, edge);
      const distance = hyperbolicDistance(neighbour.center, target);
      if (distance < bestDistance - DESCENT_EPSILON) {
        bestDistance = distance;
        bestEdge = edge;
      }
    }

    if (bestEdge < 0) {
      return walk;
    }
    tile = reflectTile(tile, bestEdge);
    walk.push(edgeIndex(bestEdge));
  }

  throw new Error('Tile descent failed to converge inside the precision envelope.');
};

// The canonical walk of a tile depends only on the tile, never on the exact point
// that located it: always descend to the tile's own centre. Memoized by centre so
// shared vertices and edges (touched by many tiles) stay cheap during a build.
const canonicalWalkByCenter = new Map<string, AbsoluteWalk>([[centerKey([0, 0]), []]]);

const canonicalWalkOfTileCenter = (center: DiskPoint): AbsoluteWalk => {
  const key = centerKey(center);
  const cached = canonicalWalkByCenter.get(key);
  if (cached) {
    return cached;
  }
  const walk = descendToTile(center);
  canonicalWalkByCenter.set(key, walk);
  return walk;
};

export const locateTileWalk = (target: DiskPoint): AbsoluteWalk =>
  canonicalWalkOfTileCenter(resolveTile(descendToTile(target)).center);

const dist2 = (z: DiskPoint, w: DiskPoint): number => {
  const dx = z[0] - w[0];
  const dy = z[1] - w[1];
  return dx * dx + dy * dy;
};

// The canonical tile is known to carry the vertex, so take the nearest local
// vertex rather than a fixed tolerance: the indexing survives the float drift of
// deep reflection replay near the boundary, which an absolute epsilon would not.
const matchingVertexIndex = (walk: AbsoluteWalk, vertex: DiskPoint): number => {
  const tile = resolveTile(walk);
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < TILE_P; i += 1) {
    const candidate = tile.vertices[i];
    if (!candidate) {
      continue;
    }
    const distance = dist2(candidate, vertex);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }
  return bestIndex;
};

// Locate the shared edge inside a tile addressed by a (possibly relabelled)
// canonical walk. Different walks to the same tile can permute its local vertex
// numbering, so the edge index and even the subdivision direction must be matched
// by geometry rather than assumed preserved.
const matchingEdge = (
  walk: AbsoluteWalk,
  a: DiskPoint,
  b: DiskPoint,
  subdivision: number,
  subdivisions: number,
): { index: number; subdivision: number } => {
  const tile = resolveTile(walk);
  let bestIndex = 0;
  let bestReversed = false;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < TILE_P; i += 1) {
    const pa = tile.vertices[i];
    const pb = tile.vertices[(i + 1) % TILE_P];
    if (!pa || !pb) {
      continue;
    }
    const forward = dist2(pa, a) + dist2(pb, b);
    const reverse = dist2(pa, b) + dist2(pb, a);
    if (forward < bestDistance) {
      bestDistance = forward;
      bestIndex = i;
      bestReversed = false;
    }
    if (reverse < bestDistance) {
      bestDistance = reverse;
      bestIndex = i;
      bestReversed = true;
    }
  }
  // Reverse winding: sample k counted from a is sample (subdivisions - k) from b.
  return { index: bestIndex, subdivision: bestReversed ? subdivisions - subdivision : subdivision };
};

// The (up to q) tiles meeting at a vertex form a fan: reflecting across either of
// the vertex's two incident edges keeps the vertex at the same local index, so we
// can walk the whole fan and pick the shortlex-minimal tile as the canonical home
// of that vertex. This is where the {3,7} order-7 vertex relation is resolved —
// the relation that free path reduction alone cannot see.
const canonicalizeVertex = (locatedWalk: AbsoluteWalk, index: number): GridAnchor => {
  const vertex = resolveTile(locatedWalk).vertices[index];
  if (!vertex) {
    throw new Error(`Vertex index ${index} is out of range.`);
  }

  const startWalk = canonicalWalkOfTileCenter(resolveTile(locatedWalk).center);
  const seen = new Set<string>([centerKey(resolveTile(startWalk).center)]);
  const frontier: AbsoluteWalk[] = [startWalk];
  let best = startWalk;

  // Fan around the vertex; `seen` bounds the frontier to the q incident tiles.
  for (let scan = 0; scan < frontier.length; scan += 1) {
    const current = frontier[scan];
    if (!current) {
      continue;
    }
    const localIndex = matchingVertexIndex(current, vertex);
    const incidentEdges = [localIndex, (localIndex + TILE_P - 1) % TILE_P];
    for (const edge of incidentEdges) {
      const neighbourCenter = reflectTile(resolveTile(current), edge).center;
      const key = centerKey(neighbourCenter);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      if (seen.size > MAX_VERTEX_FAN) {
        throw new Error('Vertex fan exceeded its order; point is outside the precision envelope.');
      }
      const neighbourWalk = canonicalWalkOfTileCenter(neighbourCenter);
      frontier.push(neighbourWalk);
      if (compareWalks(neighbourWalk, best) < 0) {
        best = neighbourWalk;
      }
    }
  }

  return gridAnchor(best, { kind: 'vertex', index: matchingVertexIndex(best, vertex) });
};

// An edge is shared by exactly two tiles, related by the reflection across it.
// The reflection fixes both endpoints and preserves their local indices, so the
// shared geodesic is edge `index` in the neighbour as well, traversed in the same
// direction — the subdivision label transfers unchanged. We keep the
// shortlex-minimal of the two tiles.
const canonicalizeEdge = (
  locatedWalk: AbsoluteWalk,
  index: number,
  subdivision: number,
  subdivisions: number,
): GridAnchor => {
  const located = resolveTile(locatedWalk);
  const a = located.vertices[index];
  const b = located.vertices[(index + 1) % TILE_P];
  if (!a || !b) {
    throw new Error(`Edge index ${index} is out of range.`);
  }

  const here = canonicalWalkOfTileCenter(located.center);
  const there = canonicalWalkOfTileCenter(reflectTile(located, index).center);

  const walk = compareWalks(there, here) < 0 ? there : here;
  const matched = matchingEdge(walk, a, b, subdivision, subdivisions);
  return gridAnchor(walk, {
    kind: 'edge',
    index: matched.index,
    subdivision: matched.subdivision,
    subdivisions,
  });
};

// Parse any scene-frame point into the unique canonical anchor for its grid
// feature. This is the normal form: the same physical point always yields the
// same anchor regardless of how (or in which reanchor chart) it was produced.
export const canonicalizeFromScene = (point: DiskPoint, subdivisions: number): GridAnchor => {
  const locatedWalk = descendToTile(point);
  const tile = resolveTile(locatedWalk);

  let bestDistance = dist2(point, tile.center);
  let best: GridAnchor = gridAnchor(canonicalWalkOfTileCenter(tile.center), { kind: 'center' });

  for (let i = 0; i < TILE_P; i += 1) {
    const vertex = tile.vertices[i];
    if (!vertex) {
      continue;
    }
    const distance = dist2(point, vertex);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = canonicalizeVertex(locatedWalk, i);
    }
  }

  for (let i = 0; i < TILE_P; i += 1) {
    const a = tile.vertices[i];
    const b = tile.vertices[(i + 1) % TILE_P];
    if (!a || !b) {
      continue;
    }
    const samples = hyperbolicEdgeSamples(a, b, subdivisions);
    for (let s = 0; s < samples.length; s += 1) {
      const sample = samples[s];
      if (!sample) {
        continue;
      }
      const distance = dist2(point, sample);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = canonicalizeEdge(locatedWalk, i, s + 1, subdivisions);
      }
    }
  }

  return best;
};
