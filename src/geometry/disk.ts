import { abs, abs2, type Complex, scale } from './complex';

export type DiskPoint = Complex;

export const DISK_EDGE_EPSILON = 0.998;

export const clampDisk = (z: DiskPoint, maxRadius2 = 0.93): DiskPoint => {
  if (abs2(z) <= maxRadius2) {
    return z;
  }

  return scale(z, Math.sqrt(maxRadius2) / abs(z));
};
