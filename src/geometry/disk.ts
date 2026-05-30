import { abs, abs2, type Complex, scale } from './complex';

export type DiskPoint = Complex;

export const DISK_EDGE_EPSILON = 0.998;

export const assertInsideUnitDisk = (point: DiskPoint, label = 'Disk point'): void => {
  if (!Number.isFinite(point[0]) || !Number.isFinite(point[1]) || abs2(point) >= 1) {
    throw new Error(`${label} must be finite and inside the unit disk.`);
  }
};

export const clampDisk = (z: DiskPoint, maxRadius2 = 0.93): DiskPoint => {
  if (abs2(z) <= maxRadius2) {
    return z;
  }

  return scale(z, Math.sqrt(maxRadius2) / abs(z));
};

// Force a point to be finite and strictly inside the unit disk, so it is always a
// legal argument for the Möbius constructors. Only truly-invalid points are
// touched (non-finite, or rounded to |z| >= 1 by deep reflection replay) — valid
// points arbitrarily close to the boundary pass through unchanged, since
// transformFromPointPair floors 1 - |z|^2 and never throws on them.
export const clampInsideDisk = (z: DiskPoint, boundaryRadius = 0.999_999): DiskPoint => {
  if (!Number.isFinite(z[0]) || !Number.isFinite(z[1])) {
    return [0, 0];
  }
  const r2 = abs2(z);
  if (r2 < 1) {
    return z;
  }
  return scale(z, boundaryRadius / Math.sqrt(r2));
};
