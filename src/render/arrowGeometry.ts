import { abs2 } from '../geometry/complex';
import type { DiskPoint } from '../geometry/disk';
import { sampleGeodesic } from '../geometry/hyperbolic';
import { applyTransform, type DiskTransform } from '../geometry/mobius';
import type { ArrowId } from '../model/arrow';
import { type ProjectedPoint, projectDiskPoint, type Viewport } from './viewport';

// Pure geometry behind the arrow overlay: projecting a world-frame geodesic to
// screen space, finding its midpoint, and hit-testing a screen point against the
// projected polyline. Kept free of canvas/DOM state so it is unit-testable and so
// ArrowLayer is left to do nothing but paint.

export const ARROW_SEGMENTS = 28;
export const ARROW_HIT_THRESHOLD = 8;
export const ARROW_DOT_SCALE = 0.26;
export const ARROW_DOT_ENDPOINT_DISTANCE = 16;

export type ArrowGeometry = Readonly<{
  id: ArrowId;
  from: DiskPoint;
  to: DiskPoint;
}>;

// The arrow's geodesic, transformed by the current view and projected to screen
// space as a polyline.
export const projectArrowGeodesic = (
  from: DiskPoint,
  to: DiskPoint,
  view: DiskTransform,
  viewport: Viewport,
  segments = ARROW_SEGMENTS,
): ProjectedPoint[] => {
  const a = applyTransform(view, from);
  const b = applyTransform(view, to);
  return sampleGeodesic(a, b, segments).map((point) => projectDiskPoint(point, viewport));
};

export const polylineMidpoint = (points: readonly ProjectedPoint[]): ProjectedPoint =>
  points[Math.floor(points.length / 2)] ?? points[0] ?? { x: 0, y: 0 };

// Projected midpoint of an arrow's geodesic, where its inspector should anchor.
export const arrowMidpoint = (
  from: DiskPoint,
  to: DiskPoint,
  view: DiskTransform,
  viewport: Viewport,
): ProjectedPoint => polylineMidpoint(projectArrowGeodesic(from, to, view, viewport));

export const collapsedArrowDot = (
  from: DiskPoint,
  to: DiskPoint,
  view: DiskTransform,
  viewport: Viewport,
): ProjectedPoint | null => {
  const a = applyTransform(view, from);
  const b = applyTransform(view, to);
  const scaleA = 1 - abs2(a);
  const scaleB = 1 - abs2(b);
  if (scaleA > ARROW_DOT_SCALE || scaleB > ARROW_DOT_SCALE) {
    return null;
  }

  const projectedA = projectDiskPoint(a, viewport);
  const projectedB = projectDiskPoint(b, viewport);
  const dx = projectedA.x - projectedB.x;
  const dy = projectedA.y - projectedB.y;
  if (dx * dx + dy * dy > ARROW_DOT_ENDPOINT_DISTANCE * ARROW_DOT_ENDPOINT_DISTANCE) {
    return null;
  }

  return {
    x: (projectedA.x + projectedB.x) / 2,
    y: (projectedA.y + projectedB.y) / 2,
  };
};

// The id of the topmost arrow whose projected geodesic passes within `threshold`
// pixels of the given viewport-space point, or null.
export const arrowHitTest = (
  arrows: readonly ArrowGeometry[],
  view: DiskTransform,
  viewport: Viewport,
  screenX: number,
  screenY: number,
  threshold = ARROW_HIT_THRESHOLD,
): ArrowId | null => {
  let best: ArrowId | null = null;
  let bestDistance2 = threshold * threshold;

  // Later arrows are drawn on top, so iterate in reverse to let the
  // topmost (last-painted) arrow win when distances are comparable.
  for (let ai = arrows.length - 1; ai >= 0; ai -= 1) {
    const arrow = arrows[ai];
    if (!arrow) {
      continue;
    }
    const dot = collapsedArrowDot(arrow.from, arrow.to, view, viewport);
    if (dot) {
      const dx = screenX - dot.x;
      const dy = screenY - dot.y;
      const distance2 = dx * dx + dy * dy;
      if (distance2 < bestDistance2) {
        bestDistance2 = distance2;
        best = arrow.id;
      }
      continue;
    }

    const points = projectArrowGeodesic(arrow.from, arrow.to, view, viewport);
    for (let i = 0; i < points.length - 1; i += 1) {
      const a = points[i];
      const b = points[i + 1];
      if (!a || !b) {
        continue;
      }
      const distance2 = distanceToSegment2(screenX, screenY, a, b);
      if (distance2 < bestDistance2) {
        bestDistance2 = distance2;
        best = arrow.id;
      }
    }
  }

  return best;
};

const distanceToSegment2 = (
  px: number,
  py: number,
  a: ProjectedPoint,
  b: ProjectedPoint,
): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 1e-12) {
    const ax = px - a.x;
    const ay = py - a.y;
    return ax * ax + ay * ay;
  }

  let t = ((px - a.x) * dx + (py - a.y) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  const ex = px - cx;
  const ey = py - cy;
  return ex * ex + ey * ey;
};
