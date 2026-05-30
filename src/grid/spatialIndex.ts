import { abs2 } from '../geometry/complex';
import type { DiskPoint } from '../geometry/disk';
import type { GridPoint } from './hyperbolicTiling';

const DEFAULT_CELL_SIZE = 0.08;

export class DiskSpatialIndex<T> {
  private readonly buckets = new Map<string, T[]>();

  constructor(
    items: readonly T[],
    private readonly pointOf: (item: T) => DiskPoint,
    private readonly cellSize = DEFAULT_CELL_SIZE,
  ) {
    for (const item of items) {
      const key = this.cellKey(this.pointOf(item));
      const bucket = this.buckets.get(key);
      if (bucket) {
        bucket.push(item);
      } else {
        this.buckets.set(key, [item]);
      }
    }
  }

  queryDisk(center: DiskPoint, radius: number): readonly T[] {
    const minX = Math.floor((center[0] - radius) / this.cellSize);
    const maxX = Math.floor((center[0] + radius) / this.cellSize);
    const minY = Math.floor((center[1] - radius) / this.cellSize);
    const maxY = Math.floor((center[1] + radius) / this.cellSize);
    const radius2 = radius * radius;
    const result: T[] = [];

    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        const bucket = this.buckets.get(`${x},${y}`);
        if (!bucket) {
          continue;
        }

        for (const item of bucket) {
          const point = this.pointOf(item);
          const dx = point[0] - center[0];
          const dy = point[1] - center[1];
          if (dx * dx + dy * dy <= radius2) {
            result.push(item);
          }
        }
      }
    }

    return result;
  }

  private cellKey(point: DiskPoint): string {
    return `${Math.floor(point[0] / this.cellSize)},${Math.floor(point[1] / this.cellSize)}`;
  }
}

export class GridPointSpatialIndex extends DiskSpatialIndex<GridPoint> {
  constructor(points: readonly GridPoint[], cellSize = DEFAULT_CELL_SIZE) {
    super(points, (point) => point.point, cellSize);
  }
}

export const viewDiskWorldBounds = (
  viewCenter: DiskPoint,
  viewRadius: number,
): { center: DiskPoint; radius: number } => {
  const centerRadius2 = abs2(viewCenter);
  const viewRadius2 = viewRadius * viewRadius;
  const denominator = 1 - viewRadius2 * centerRadius2;

  if (denominator <= 1e-9) {
    return {
      center: [0, 0],
      radius: 1,
    };
  }

  const centerScale = (1 - viewRadius2) / denominator;
  return {
    center: [viewCenter[0] * centerScale, viewCenter[1] * centerScale],
    radius: ((1 - centerRadius2) * viewRadius) / denominator,
  };
};
