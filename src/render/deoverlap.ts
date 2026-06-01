import { abs2 } from '../geometry/complex';
import type { DiskPoint } from '../geometry/disk';
import {
  applyTransform,
  composeTransforms,
  type DiskTransform,
  rotationTransform,
} from '../geometry/mobius';
import { projectDiskPoint, type Viewport } from './viewport';

// A node's measured on-disk footprint at scale 1, in screen pixels. width/height
// are the element's intrinsic size (before the per-note scale is applied), as
// reported by the DOM; the searcher rescales them per candidate view.
export type DeoverlapNode = Readonly<{
  point: DiskPoint;
  width: number;
  height: number;
}>;

type ScreenRect = Readonly<{
  left: number;
  top: number;
  right: number;
  bottom: number;
  // Centrality of the label, 1 at the disk center and falling toward 0 at the
  // rim. Overlaps among central labels matter more (the user is reading there);
  // edge labels are small and crowded, so their overlaps are largely harmless.
  weight: number;
}>;

// Mirrors NoteLayer.render: text is only painted when its scale clears this
// threshold; below it the note collapses to a (small, non-colliding) dot, so it
// does not participate in label overlap.
const SCALE_TEXT = 0.26;
const PROJECTION_RADIUS = 0.9995;
// How sharply overlap cost falls off toward the rim. The raw centrality is
// (1 - radius²); raising it to this power concentrates the search on separating
// labels near the center and all but ignores edge overlaps.
const CENTRALITY_FALLOFF = 2;

// Project a node to a screen-space rectangle under `view`, or null when it would
// not render as full-size text (off-screen, or collapsed to a dot).
const nodeRect = (
  node: DeoverlapNode,
  view: DiskTransform,
  viewport: Viewport,
): ScreenRect | null => {
  const transformed = applyTransform(view, node.point);
  const radius2 = abs2(transformed);
  const scale = (1 - radius2) * viewport.visualScale;
  if (scale <= SCALE_TEXT) {
    return null;
  }

  const clamped = clampForProjection(transformed);
  const projected = projectDiskPoint(clamped, viewport);
  const halfW = (node.width * scale) / 2;
  const halfH = (node.height * scale) / 2;
  const rect: ScreenRect = {
    left: projected.x - halfW,
    top: projected.y - halfH,
    right: projected.x + halfW,
    bottom: projected.y + halfH,
    weight: (1 - radius2) ** CENTRALITY_FALLOFF,
  };

  // Drop nodes whose box lies fully outside the viewport; they cannot overlap
  // anything the user sees and would otherwise skew the score.
  if (
    rect.right < 0 ||
    rect.left > viewport.width ||
    rect.bottom < 0 ||
    rect.top > viewport.height
  ) {
    return null;
  }
  return rect;
};

const clampForProjection = (point: DiskPoint): DiskPoint => {
  const radius2 = abs2(point);
  if (radius2 <= PROJECTION_RADIUS * PROJECTION_RADIUS) {
    return point;
  }
  const radius = Math.sqrt(radius2);
  if (radius < 1e-12) {
    return point;
  }
  const factor = PROJECTION_RADIUS / radius;
  return [point[0] * factor, point[1] * factor];
};

// Weighted pairwise overlap cost among the full-size text labels visible under
// `view`. Each overlapping pair contributes its intersection area scaled by the
// more central of the two labels, so overlaps near the center dominate the score
// and edge overlaps barely register. Zero means no label overlaps another.
export const overlapScore = (
  nodes: readonly DeoverlapNode[],
  view: DiskTransform,
  viewport: Viewport,
): number => {
  const rects: ScreenRect[] = [];
  for (const node of nodes) {
    const rect = nodeRect(node, view, viewport);
    if (rect) {
      rects.push(rect);
    }
  }

  let total = 0;
  for (let i = 0; i < rects.length; i += 1) {
    const a = rects[i] as ScreenRect;
    for (let j = i + 1; j < rects.length; j += 1) {
      const b = rects[j] as ScreenRect;
      const dx = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      if (dx <= 0) {
        continue;
      }
      const dy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (dy <= 0) {
        continue;
      }
      // Weight by the more central label: an overlap is as costly as its most
      // central participant cares about it.
      total += dx * dy * Math.max(a.weight, b.weight);
    }
  }
  return total;
};

export type BestRotation = Readonly<{
  // Rotation about the disk center, in radians, to compose onto the current view.
  angle: number;
  score: number;
}>;

export type FindBestRotationOptions = Readonly<{
  // Number of angles to probe across the considered range.
  samples?: number;
  // Largest rotation (radians, magnitude) ever returned. A big spin is more
  // disorienting than the overlap it fixes, so candidates beyond this are not
  // even considered.
  maxAngle?: number;
  // Minimum fraction of the current overlap a rotation must remove to be worth
  // taking. Below this the gain does not justify moving, so we stay put.
  minImprovement?: number;
}>;

// Fold an angle into (-PI, PI] so its magnitude is the short way around.
const signedAngle = (angle: number): number => {
  const wrapped = ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return wrapped > Math.PI ? wrapped - 2 * Math.PI : wrapped;
};

// Scan rotations of the whole disk about its center and return the angle (and its
// score) that minimizes label overlap. `angle` is relative to the current view:
// 0 means "stay put". The search is cheap—`samples` candidates, each an O(n²)
// rect sweep over the handful of visible labels—so it is safe to run on rest.
//
// The returned angle is capped to ±`maxAngle` and is only non-zero when the spin
// removes at least `minImprovement` of the current overlap; otherwise we keep
// the view where it is rather than making a large or barely-helpful move.
export const findBestRotation = (
  nodes: readonly DeoverlapNode[],
  view: DiskTransform,
  viewport: Viewport,
  options: FindBestRotationOptions = {},
): BestRotation => {
  const { samples = 24, maxAngle = Math.PI / 4, minImprovement = 0.25 } = options;

  const baseScore = overlapScore(nodes, view, viewport);
  const stay: BestRotation = { angle: 0, score: baseScore };
  if (baseScore === 0) {
    return stay;
  }

  let best = stay;
  // Probe at the same angular resolution as a full-circle sweep, but only over
  // angles whose short-way magnitude is within the cap.
  const step = (2 * Math.PI) / samples;
  for (let raw = step; raw < 2 * Math.PI; raw += step) {
    const angle = signedAngle(raw);
    if (Math.abs(angle) > maxAngle + 1e-9) {
      continue;
    }
    const candidate = composeTransforms(rotationTransform(angle), view);
    const score = overlapScore(nodes, candidate, viewport);
    // Strict improvement only, and on a tie keep the smaller rotation already held.
    if (score < best.score || (score === best.score && Math.abs(angle) < Math.abs(best.angle))) {
      best = { angle, score };
    }
  }

  // Reject a move that does not clear enough of the overlap to be worth it.
  if (baseScore - best.score < minImprovement * baseScore) {
    return stay;
  }
  return best;
};
