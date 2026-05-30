import { describe, expect, it } from 'vitest';
import { identityTransform } from '../src/geometry/mobius';
import type { Arrow } from '../src/model/arrow';
import { arrowHitTest, arrowMidpoint, projectArrowGeodesic } from '../src/render/arrowGeometry';
import type { Viewport } from '../src/render/viewport';

const viewport: Viewport = {
  width: 800,
  height: 600,
  left: 0,
  top: 0,
  cx: 400,
  cy: 300,
  radius: 500,
  zoom: 1,
};

const arrow: Arrow = {
  id: 'arrow-0',
  // A diameter through the origin projects to a horizontal screen segment at y=300.
  from: [0.2, 0],
  to: [-0.2, 0],
  label: '',
  appearance: { color: 'c1' },
  createdAt: 1,
  updatedAt: 1,
};

describe('arrow geometry', () => {
  it('projects endpoints to the expected screen coordinates', () => {
    const points = projectArrowGeodesic(arrow.from, arrow.to, identityTransform, viewport);
    expect(points[0]).toEqual({ x: 500, y: 300 });
    expect(points[points.length - 1]).toEqual({ x: 300, y: 300 });
  });

  it('reports the projected midpoint at the geodesic centre', () => {
    const mid = arrowMidpoint(arrow.from, arrow.to, identityTransform, viewport);
    expect(mid.x).toBeCloseTo(400, 6);
    expect(mid.y).toBeCloseTo(300, 6);
  });

  it('hits a point lying on the projected line', () => {
    expect(arrowHitTest([arrow], identityTransform, viewport, 400, 300)).toBe('arrow-0');
    expect(arrowHitTest([arrow], identityTransform, viewport, 400, 304)).toBe('arrow-0');
  });

  it('misses a point beyond the hit threshold', () => {
    expect(arrowHitTest([arrow], identityTransform, viewport, 400, 350)).toBeNull();
    // Beyond the segment ends, too.
    expect(arrowHitTest([arrow], identityTransform, viewport, 520, 300)).toBeNull();
  });
});
