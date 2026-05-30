import { abs2, add, type Complex, conjugate, divide, multiply, negate, scale } from './complex';
import type { DiskPoint } from './disk';

export type DiskTransform = Readonly<{
  a: Complex;
  b: Complex;
}>;

export const identityTransform: DiskTransform = {
  a: [1, 0],
  b: [0, 0],
};

export const applyTransform = (transform: DiskTransform, z: DiskPoint): DiskPoint => {
  const numerator = add(multiply(transform.a, z), transform.b);
  const denominator = add(multiply(conjugate(transform.b), z), conjugate(transform.a));
  return divide(numerator, denominator);
};

export const composeTransforms = (first: DiskTransform, second: DiskTransform): DiskTransform => ({
  a: add(multiply(first.a, second.a), multiply(first.b, conjugate(second.b))),
  b: add(multiply(first.a, second.b), multiply(first.b, conjugate(second.a))),
});

export const invertTransform = (transform: DiskTransform): DiskTransform => ({
  a: conjugate(transform.a),
  b: negate(transform.b),
});

export const transformFromPointPair = (p: DiskPoint, q: DiskPoint): DiskTransform => {
  const pScale = 1 / Math.sqrt(Math.max(1e-12, 1 - abs2(p)));
  const translateP: DiskTransform = {
    a: [pScale, 0],
    b: scale(negate(p), pScale),
  };

  const qScale = 1 / Math.sqrt(Math.max(1e-12, 1 - abs2(q)));
  const translateQ: DiskTransform = {
    a: [qScale, 0],
    b: scale(q, qScale),
  };

  return composeTransforms(translateQ, translateP);
};
