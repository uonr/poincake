import type { DiskPoint } from '../geometry/disk';
import type { DiskTransform } from '../geometry/mobius';
import type { Arrow, ArrowHeadMode } from '../model/arrow';
import { arrowColor, arrowHeadMode, arrowLabel } from '../model/arrow';
import type { NoteColor } from '../model/note';
import { polylineMidpoint, projectArrowGeodesic } from './arrowGeometry';
import type { ProjectedPoint, Viewport } from './viewport';

const LINE_WIDTH = 2;
const SELECTED_LINE_WIDTH = 3;
const SELECTED_HALO_WIDTH = 8;
const SELECTED_HALO_ALPHA = 0.22;
const HEAD_LENGTH = 12;
const HEAD_HALF_ANGLE = 0.42;
const LABEL_FONT = '500 13px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
const LABEL_PADDING_X = 6;
const LABEL_PADDING_Y = 3;
const LABEL_RADIUS = 5;

export type ArrowDraft = Readonly<{
  from: DiskPoint;
  to: DiskPoint;
  color: NoteColor;
}>;

export type RenderedArrow = Readonly<{
  arrow: Arrow;
  from: DiskPoint;
  to: DiskPoint;
}>;

export type ArrowColorResolver = (color: NoteColor) => string;

export type ArrowDrawOptions = Readonly<{
  selectedArrowId: string | null;
  labelHalo: string;
}>;

// 2D overlay that strokes each arrow as a projected geodesic polyline (matching
// the hyperbolic grid lines) capped with an arrowhead at the `to` endpoint. Kept
// separate from the WebGL grid layer so the two never contend for one context.
export class ArrowLayer {
  private readonly ctx: CanvasRenderingContext2D;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('2D canvas context is not available for the arrow layer.');
    }
    this.ctx = ctx;
  }

  dispose(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  draw(
    arrows: readonly RenderedArrow[],
    view: DiskTransform,
    viewport: Viewport,
    colorFor: ArrowColorResolver,
    draft: ArrowDraft | null,
    options: ArrowDrawOptions,
  ): void {
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    const targetWidth = Math.round(viewport.width * dpr);
    const targetHeight = Math.round(viewport.height * dpr);
    if (this.canvas.width !== targetWidth || this.canvas.height !== targetHeight) {
      this.canvas.width = targetWidth;
      this.canvas.height = targetHeight;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, viewport.width, viewport.height);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const rendered of arrows) {
      const { arrow } = rendered;
      const points = projectArrowGeodesic(rendered.from, rendered.to, view, viewport);
      const color = colorFor(arrowColor(arrow));
      this.strokeArrow(points, color, {
        alpha: 1,
        dashed: false,
        headMode: arrowHeadMode(arrow),
        selected: arrow.id === options.selectedArrowId,
      });
      const label = arrowLabel(arrow);
      if (label) {
        this.drawLabel(polylineMidpoint(points), label, color, options.labelHalo);
      }
    }

    if (draft) {
      const points = projectArrowGeodesic(draft.from, draft.to, view, viewport);
      this.strokeArrow(points, colorFor(draft.color), {
        alpha: 0.65,
        dashed: true,
        headMode: 'end',
        selected: false,
      });
    }
  }

  private strokeArrow(
    points: readonly ProjectedPoint[],
    color: string,
    options: Readonly<{
      alpha: number;
      dashed: boolean;
      headMode: ArrowHeadMode;
      selected: boolean;
    }>,
  ): void {
    if (points.length < 2) {
      return;
    }
    const first = points[0];
    if (!first) {
      return;
    }

    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;

    const tracePath = (): void => {
      ctx.beginPath();
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < points.length; i += 1) {
        const point = points[i];
        if (point) {
          ctx.lineTo(point.x, point.y);
        }
      }
    };

    // A soft wider stroke under the selected arrow reads as a highlight without a
    // separate color, which would otherwise clash with the four-swatch palette.
    if (options.selected) {
      ctx.globalAlpha = SELECTED_HALO_ALPHA;
      ctx.lineWidth = SELECTED_HALO_WIDTH;
      tracePath();
      ctx.stroke();
    }

    ctx.globalAlpha = options.alpha;
    ctx.lineWidth = options.selected ? SELECTED_LINE_WIDTH : LINE_WIDTH;
    ctx.setLineDash(options.dashed ? [6, 5] : []);
    tracePath();
    ctx.stroke();
    ctx.setLineDash([]);

    if (options.headMode === 'start' || options.headMode === 'both') {
      this.drawHead(points, 'start');
    }
    if (options.headMode === 'end' || options.headMode === 'both') {
      this.drawHead(points, 'end');
    }
    ctx.globalAlpha = 1;
  }

  private drawLabel(at: ProjectedPoint, text: string, color: string, halo: string): void {
    const ctx = this.ctx;
    ctx.font = LABEL_FONT;
    const width = ctx.measureText(text).width;
    const boxWidth = width + LABEL_PADDING_X * 2;
    const boxHeight = 13 + LABEL_PADDING_Y * 2;
    const left = at.x - boxWidth / 2;
    const top = at.y - boxHeight / 2;

    ctx.globalAlpha = 0.92;
    ctx.fillStyle = halo;
    roundedRect(ctx, left, top, boxWidth, boxHeight, LABEL_RADIUS);
    ctx.fill();

    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    ctx.fillText(text, at.x, at.y + 0.5);
  }

  private drawHead(points: readonly ProjectedPoint[], endpoint: 'start' | 'end'): void {
    const tip = endpoint === 'start' ? points[0] : points[points.length - 1];
    // Walk back along the polyline to a point a head-length away so the head
    // aligns with the arc's tangent rather than a single tiny final segment.
    let anchor: ProjectedPoint | undefined;
    const startIndex = endpoint === 'start' ? 1 : points.length - 2;
    const endIndex = endpoint === 'start' ? points.length : -1;
    const step = endpoint === 'start' ? 1 : -1;
    for (let i = startIndex; i !== endIndex; i += step) {
      const candidate = points[i];
      if (!candidate || !tip) {
        continue;
      }
      const dx = tip.x - candidate.x;
      const dy = tip.y - candidate.y;
      anchor = candidate;
      if (dx * dx + dy * dy >= HEAD_LENGTH * HEAD_LENGTH) {
        break;
      }
    }
    if (!tip || !anchor) {
      return;
    }

    const dx = tip.x - anchor.x;
    const dy = tip.y - anchor.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-6) {
      return;
    }
    const ux = dx / length;
    const uy = dy / length;

    const leftX =
      tip.x - HEAD_LENGTH * (ux * Math.cos(HEAD_HALF_ANGLE) - uy * Math.sin(HEAD_HALF_ANGLE));
    const leftY =
      tip.y - HEAD_LENGTH * (uy * Math.cos(HEAD_HALF_ANGLE) + ux * Math.sin(HEAD_HALF_ANGLE));
    const rightX =
      tip.x - HEAD_LENGTH * (ux * Math.cos(HEAD_HALF_ANGLE) + uy * Math.sin(HEAD_HALF_ANGLE));
    const rightY =
      tip.y - HEAD_LENGTH * (uy * Math.cos(HEAD_HALF_ANGLE) - ux * Math.sin(HEAD_HALF_ANGLE));

    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(leftX, leftY);
    ctx.lineTo(rightX, rightY);
    ctx.closePath();
    ctx.fill();
  }
}

const roundedRect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void => {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
};
