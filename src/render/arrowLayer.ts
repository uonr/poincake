import type { DiskPoint } from '../geometry/disk';
import type { DiskTransform } from '../geometry/mobius';
import type { Arrow, ArrowHeadMode } from '../model/arrow';
import { arrowColor, arrowHeadMode, arrowLabel } from '../model/arrow';
import type { NoteColor } from '../model/note';
import { collapsedArrowDot, type GeodesicSample, projectArrowGeodesic } from './arrowGeometry';
import type { ProjectedPoint, Viewport } from './viewport';

const LINE_WIDTH = 2;
const SELECTED_LINE_WIDTH = 3;
const SELECTED_HALO_WIDTH = 8;
const SELECTED_HALO_ALPHA = 0.22;
const HEAD_LENGTH = 12;
const HEAD_HALF_ANGLE = 0.42;
const DOT_RADIUS = 3;
const DOT_OPACITY = 0.72;
const LABEL_TEXT_SCALE = 0.26;
const LABEL_FONT_SIZE = 16;
const LABEL_FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
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
  preview: ArrowDraft | null;
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
      const color = colorFor(arrowColor(arrow));
      const dot = collapsedArrowDot(rendered.from, rendered.to, view, viewport);
      if (dot) {
        this.drawDot(dot, color, arrow.id === options.selectedArrowId);
        continue;
      }

      const points = projectArrowGeodesic(rendered.from, rendered.to, view, viewport);
      this.strokeArrow(points, color, {
        alpha: 1,
        dashed: false,
        headMode: arrowHeadMode(arrow),
        selected: arrow.id === options.selectedArrowId,
      });
      const label = arrowLabel(arrow);
      const labelPoint = points[Math.floor(points.length / 2)];
      if (label && labelPoint) {
        this.drawLabel(labelPoint, label, color, options.labelHalo, viewport);
      }
    }

    if (draft) {
      this.drawTransientArrow(draft, view, viewport, colorFor(draft.color), {
        alpha: 0.65,
        dashed: true,
      });
    }

    if (options.preview) {
      this.drawTransientArrow(options.preview, view, viewport, colorFor(options.preview.color), {
        alpha: 0.38,
        dashed: false,
      });
    }
  }

  private drawTransientArrow(
    arrow: ArrowDraft,
    view: DiskTransform,
    viewport: Viewport,
    color: string,
    options: Readonly<{ alpha: number; dashed: boolean }>,
  ): void {
    const dot = collapsedArrowDot(arrow.from, arrow.to, view, viewport);
    if (dot) {
      this.drawDot(dot, color, false, options.alpha);
      return;
    }

    const points = projectArrowGeodesic(arrow.from, arrow.to, view, viewport);
    this.strokeArrow(points, color, {
      alpha: options.alpha,
      dashed: options.dashed,
      headMode: 'end',
      selected: false,
    });
  }

  private drawDot(at: ProjectedPoint, color: string, selected: boolean, alpha = DOT_OPACITY): void {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    if (selected) {
      ctx.globalAlpha = SELECTED_HALO_ALPHA;
      ctx.beginPath();
      ctx.arc(at.x, at.y, SELECTED_HALO_WIDTH / 2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(at.x, at.y, DOT_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  private strokeArrow(
    points: readonly GeodesicSample[],
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
    const baseWidth = options.selected ? SELECTED_LINE_WIDTH : LINE_WIDTH;

    if (options.dashed) {
      // A dash pattern can't survive being split into per-segment strokes (the
      // phase resets each segment), so transient dashed arrows keep a uniform width.
      ctx.globalAlpha = options.alpha;
      ctx.lineWidth = baseWidth;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < points.length; i += 1) {
        const point = points[i];
        if (point) {
          ctx.lineTo(point.x, point.y);
        }
      }
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      // A soft wider stroke under the selected arrow reads as a highlight without
      // a separate color, which would otherwise clash with the four-swatch palette.
      if (options.selected) {
        ctx.globalAlpha = SELECTED_HALO_ALPHA;
        this.strokeTapered(points, SELECTED_HALO_WIDTH);
      }
      ctx.globalAlpha = options.alpha;
      this.strokeTapered(points, baseWidth);
    }

    if (options.headMode === 'start' || options.headMode === 'both') {
      this.drawHead(points, 'start');
    }
    if (options.headMode === 'end' || options.headMode === 'both') {
      this.drawHead(points, 'end');
    }
    ctx.globalAlpha = 1;
  }

  // Canvas 2D can't vary lineWidth within a single stroke, so the polyline is
  // stroked one segment at a time with a width scaled by the local conformal
  // factor. The globally-set round line caps overlap at the joints, blending the
  // width steps into a smooth taper toward the disk edge.
  private strokeTapered(points: readonly GeodesicSample[], baseWidth: number): void {
    const ctx = this.ctx;
    for (let i = 0; i < points.length - 1; i += 1) {
      const a = points[i];
      const b = points[i + 1];
      if (!a || !b) {
        continue;
      }
      const width = baseWidth * ((a.scale + b.scale) / 2);
      if (width <= 0) {
        continue;
      }
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  private drawLabel(
    at: GeodesicSample,
    text: string,
    color: string,
    halo: string,
    viewport: Viewport,
  ): void {
    const labelScale = at.scale * viewport.visualScale;
    if (labelScale <= LABEL_TEXT_SCALE) {
      return;
    }

    const ctx = this.ctx;
    const fontSize = LABEL_FONT_SIZE * labelScale;
    const paddingX = LABEL_PADDING_X * labelScale;
    const paddingY = LABEL_PADDING_Y * labelScale;
    ctx.font = `500 ${fontSize}px ${LABEL_FONT_FAMILY}`;
    const width = ctx.measureText(text).width;
    const boxWidth = width + paddingX * 2;
    const boxHeight = fontSize + paddingY * 2;
    const left = at.x - boxWidth / 2;
    const top = at.y - boxHeight / 2;

    ctx.globalAlpha = 0.92;
    ctx.fillStyle = halo;
    roundedRect(ctx, left, top, boxWidth, boxHeight, LABEL_RADIUS * labelScale);
    ctx.fill();

    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    ctx.fillText(text, at.x, at.y + 0.5 * labelScale);
  }

  private drawHead(points: readonly GeodesicSample[], endpoint: 'start' | 'end'): void {
    const tip = endpoint === 'start' ? points[0] : points[points.length - 1];
    if (!tip) {
      return;
    }
    // The head shares the line's foreshortening so it stays proportional to the
    // local stroke width as the arrow approaches the rim.
    const headLength = HEAD_LENGTH * tip.scale;
    if (headLength < 1e-6) {
      return;
    }
    // Walk back along the polyline to a point a head-length away so the head
    // aligns with the arc's tangent rather than a single tiny final segment.
    let anchor: ProjectedPoint | undefined;
    const startIndex = endpoint === 'start' ? 1 : points.length - 2;
    const endIndex = endpoint === 'start' ? points.length : -1;
    const step = endpoint === 'start' ? 1 : -1;
    for (let i = startIndex; i !== endIndex; i += step) {
      const candidate = points[i];
      if (!candidate) {
        continue;
      }
      const dx = tip.x - candidate.x;
      const dy = tip.y - candidate.y;
      anchor = candidate;
      if (dx * dx + dy * dy >= headLength * headLength) {
        break;
      }
    }
    if (!anchor) {
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
      tip.x - headLength * (ux * Math.cos(HEAD_HALF_ANGLE) - uy * Math.sin(HEAD_HALF_ANGLE));
    const leftY =
      tip.y - headLength * (uy * Math.cos(HEAD_HALF_ANGLE) + ux * Math.sin(HEAD_HALF_ANGLE));
    const rightX =
      tip.x - headLength * (ux * Math.cos(HEAD_HALF_ANGLE) + uy * Math.sin(HEAD_HALF_ANGLE));
    const rightY =
      tip.y - headLength * (uy * Math.cos(HEAD_HALF_ANGLE) - ux * Math.sin(HEAD_HALF_ANGLE));

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
