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

const reflectInDiameter = (point: DiskPoint, a: DiskPoint, b: DiskPoint): DiskPoint => {
  const direction = abs2(a) > 1e-12 ? a : b;
  const length = Math.sqrt(abs2(direction));
  const ux = direction[0] / length;
  const uy = direction[1] / length;
  const dot = point[0] * ux + point[1] * uy;

  return [2 * dot * ux - point[0], 2 * dot * uy - point[1]];
};
