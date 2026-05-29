import { abs2 } from '../geometry/complex';
import { applyTransform, type DiskTransform } from '../geometry/mobius';
import type { AnchoredGrid } from '../grid/anchoredGrid';
import type { GridPoint } from '../grid/hyperbolicTiling';
import { projectDiskPoint, type Viewport } from './viewport';

const GRID_DRAW_RADIUS2 = 0.94 * 0.94;
const GRID_ALPHA = 0.62;
const GRID_MIN_SIZE = 0.9;
const GRID_SIZE_FACTOR = 1.85;

export class GridRenderer {
  private readonly context: CanvasRenderingContext2D;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas 2D context is not available.');
    }
    this.context = context;
  }

  draw(
    grid: AnchoredGrid,
    view: DiskTransform,
    viewport: Viewport,
    color: string,
  ): void {
    const dpr = window.devicePixelRatio || 1;
    const targetWidth = Math.round(viewport.width * dpr);
    const targetHeight = Math.round(viewport.height * dpr);

    if (this.canvas.width !== targetWidth || this.canvas.height !== targetHeight) {
      this.canvas.width = targetWidth;
      this.canvas.height = targetHeight;
    }

    this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.context.clearRect(0, 0, viewport.width, viewport.height);
    const visible = grid.visiblePoints(view, Math.sqrt(GRID_DRAW_RADIUS2));
    this.drawPoints(
      visible.points,
      visible.transform,
      viewport,
      color,
      GRID_ALPHA,
      1,
      GRID_DRAW_RADIUS2,
    );
  }

  private drawPoints(
    gridPoints: readonly GridPoint[],
    view: DiskTransform,
    viewport: Viewport,
    color: string,
    alpha: number,
    sizeMultiplier: number,
    maxRadius2: number,
  ): void {
    this.context.fillStyle = color;
    this.context.globalAlpha = alpha;
    this.context.beginPath();

    for (const gridPoint of gridPoints) {
      const transformed = applyTransform(view, gridPoint.point);
      const radius2 = abs2(transformed);
      if (radius2 > maxRadius2) {
        continue;
      }

      const projected = projectDiskPoint(transformed, viewport);
      if (
        projected.x < -2 ||
        projected.x > viewport.width + 2 ||
        projected.y < -2 ||
        projected.y > viewport.height + 2
      ) {
        continue;
      }

      const size = Math.max(GRID_MIN_SIZE, (1 - radius2) * GRID_SIZE_FACTOR) * sizeMultiplier;
      this.context.moveTo(projected.x + size, projected.y);
      this.context.arc(projected.x, projected.y, size, 0, Math.PI * 2);
    }

    this.context.fill();
    this.context.globalAlpha = 1;
  }
}
