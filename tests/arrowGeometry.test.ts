import { describe, expect, it } from 'vitest';
import { identityTransform } from '../src/geometry/mobius';
import {
  type ArrowGeometry,
  arrowHitTest,
  arrowMidpoint,
  collapsedArrowDot,
  projectArrowGeodesic,
} from '../src/render/arrowGeometry';
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

const arrow: ArrowGeometry = {
  id: 'arrow-0',
  // A diameter through the origin projects to a horizontal screen segment at y=300.
  from: [0.2, 0],
  to: [-0.2, 0],
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

  it('collapses nearby far-boundary endpoints into a dot', () => {
    const dot = collapsedArrowDot([0.98, 0], [0.981, 0.01], identityTransform, viewport);

    expect(dot?.x).toBeCloseTo(890.25, 2);
    expect(dot?.y).toBeCloseTo(302.5, 2);
    expect(
      arrowHitTest(
        [{ id: 'arrow-dot', from: [0.98, 0], to: [0.981, 0.01] }],
        identityTransform,
        viewport,
        dot?.x ?? 0,
        dot?.y ?? 0,
      ),
    ).toBe('arrow-dot');
  });

  it('keeps far endpoints as an arrow when their projections are separated', () => {
    expect(collapsedArrowDot([0.98, 0], [0.6, 0.7], identityTransform, viewport)).toBeNull();
  });
});
