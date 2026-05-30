import type { DiskPoint } from '../geometry/disk';

export type Viewport = Readonly<{
  width: number;
  height: number;
  left: number;
  top: number;
  cx: number;
  cy: number;
  radius: number;
  zoom: number;
}>;

export type ProjectedPoint = Readonly<{
  x: number;
  y: number;
}>;

const FIT_DISK_MARGIN_PX = 8;

export const fitDiskZoom = (
  width: number,
  height: number,
  marginPx = FIT_DISK_MARGIN_PX,
): number => {
  const cx = width / 2;
  const cy = height / 2;
  const diagonalRadius = Math.sqrt(cx * cx + cy * cy);

  if (diagonalRadius <= 0) {
    return 1;
  }

  const fittedRadius = Math.max(1, Math.min(cx, cy) - marginPx);
  return fittedRadius / diagonalRadius;
};

export type StageRect = Readonly<{
  width: number;
  height: number;
  left: number;
  top: number;
}>;

export const createViewportFromRect = (rect: StageRect, zoom: number): Viewport => {
  const cx = rect.width / 2;
  const cy = rect.height / 2;

  return {
    width: rect.width,
    height: rect.height,
    left: rect.left,
    top: rect.top,
    cx,
    cy,
    radius: Math.sqrt(cx * cx + cy * cy) * zoom,
    zoom,
  };
};

export const createViewport = (stage: HTMLElement, zoom: number): Viewport =>
  createViewportFromRect(stage.getBoundingClientRect(), zoom);

export const projectDiskPoint = (z: DiskPoint, viewport: Viewport): ProjectedPoint => ({
  x: viewport.cx + z[0] * viewport.radius,
  y: viewport.cy + z[1] * viewport.radius,
});

export const screenToDisk = (clientX: number, clientY: number, viewport: Viewport): DiskPoint => [
  (clientX - viewport.left - viewport.cx) / viewport.radius,
  (clientY - viewport.top - viewport.cy) / viewport.radius,
];
