import { abs2 } from './complex';
import type { DiskPoint } from './disk';

export type GeodesicCircle = Readonly<{
  center: DiskPoint;
  radius: number;
  radius2: number;
}>;

export const geodesicCircle = (a: DiskPoint, b: DiskPoint): GeodesicCircle | null => {
  const rhsA = (abs2(a) + 1) / 2;
  const rhsB = (abs2(b) + 1) / 2;
  const determinant = a[0] * b[1] - a[1] * b[0];

  if (Math.abs(determinant) < 1e-10) {
    return null;
  }

  const center: DiskPoint = [
    (rhsA * b[1] - a[1] * rhsB) / determinant,
    (a[0] * rhsB - rhsA * b[0]) / determinant,
  ];
  const radius2 = abs2(center) - 1;

  return {
    center,
    radius: Math.sqrt(Math.max(0, radius2)),
    radius2,
  };
};

export const reflectInGeodesic = (point: DiskPoint, a: DiskPoint, b: DiskPoint): DiskPoint => {
  const circle = geodesicCircle(a, b);
  if (!circle) {
    return reflectInDiameter(point, a, b);
  }

  const dx = point[0] - circle.center[0];
  const dy = point[1] - circle.center[1];
  const factor = circle.radius2 / (dx * dx + dy * dy);

  return [circle.center[0] + factor * dx, circle.center[1] + factor * dy];
};

// Sample the geodesic segment between two disk points as a polyline. In the
// Poincaré model the geodesic is the arc of the circle through a and b that is
// orthogonal to the unit circle (its center lies outside the disk, so the arc
// joining a and b is always the minor one); when a, b and the origin are
// collinear it degenerates to the straight diameter chord. Returns `segments+1`
// points, with the first exactly a and the last exactly b.
export const sampleGeodesic = (a: DiskPoint, b: DiskPoint, segments = 24): DiskPoint[] => {
  const steps = Math.max(1, Math.floor(segments));
  const circle = geodesicCircle(a, b);

  if (!circle) {
    const points: DiskPoint[] = [];
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      points.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
    return points;
  }

  const startAngle = Math.atan2(a[1] - circle.center[1], a[0] - circle.center[0]);
  const endAngle = Math.atan2(b[1] - circle.center[1], b[0] - circle.center[0]);
  const delta = normalizeAngle(endAngle - startAngle);

  const points: DiskPoint[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const angle = startAngle + (delta * i) / steps;
    points.push([
      circle.center[0] + circle.radius * Math.cos(angle),
      circle.center[1] + circle.radius * Math.sin(angle),
    ]);
  }
  // Pin the endpoints to the exact inputs so floating-point drift never detaches
  // an arrow from its grid points.
  points[0] = [a[0], a[1]];
  points[steps] = [b[0], b[1]];
  return points;
};

// Wrap an angle difference into (-PI, PI], selecting the minor arc.
const normalizeAngle = (angle: number): number => {
  let value = angle;
  while (value <= -Math.PI) {
    value += 2 * Math.PI;
  }
  while (value > Math.PI) {
    value -= 2 * Math.PI;
  }
  return value;
};

const reflectInDiameter = (point: DiskPoint, a: DiskPoint, b: DiskPoint): DiskPoint => {
  const direction = abs2(a) > 1e-12 ? a : b;
  const length = Math.sqrt(abs2(direction));
  const ux = direction[0] / length;
  const uy = direction[1] / length;
  const dot = point[0] * ux + point[1] * uy;

  return [2 * dot * ux - point[0], 2 * dot * uy - point[1]];
};
