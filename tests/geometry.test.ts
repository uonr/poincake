import { describe, expect, it } from 'vitest';
import { abs2 } from '../src/geometry/complex';
import {
  applyTransform,
  identityTransform,
  invertTransform,
  transformFromPointPair,
} from '../src/geometry/mobius';

describe('disk transforms', () => {
  it('leaves a point unchanged with the identity transform', () => {
    expect(applyTransform(identityTransform, [0.2, -0.3])).toEqual([0.2, -0.3]);
  });

  it('moves p to q for transformFromPointPair', () => {
    const p = [0.2, -0.1] as const;
    const q = [-0.15, 0.25] as const;
    const result = applyTransform(transformFromPointPair(p, q), p);

    expect(result[0]).toBeCloseTo(q[0], 10);
    expect(result[1]).toBeCloseTo(q[1], 10);
    expect(abs2(result)).toBeLessThan(1);
  });

  it('round trips through the inverse transform', () => {
    const transform = transformFromPointPair([0.35, 0.1], [-0.2, 0.15]);
    const point = [0.1, 0.2] as const;
    const moved = applyTransform(transform, point);
    const restored = applyTransform(invertTransform(transform), moved);

    expect(restored[0]).toBeCloseTo(point[0], 10);
    expect(restored[1]).toBeCloseTo(point[1], 10);
  });
});
