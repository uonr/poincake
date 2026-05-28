export type Complex = readonly [number, number];

export const add = (a: Complex, b: Complex): Complex => [a[0] + b[0], a[1] + b[1]];

export const multiply = (a: Complex, b: Complex): Complex => [
  a[0] * b[0] - a[1] * b[1],
  a[0] * b[1] + a[1] * b[0],
];

export const divide = (a: Complex, b: Complex): Complex => {
  const denominator = b[0] * b[0] + b[1] * b[1];
  return [
    (a[0] * b[0] + a[1] * b[1]) / denominator,
    (a[1] * b[0] - a[0] * b[1]) / denominator,
  ];
};

export const conjugate = (a: Complex): Complex => [a[0], -a[1]];

export const abs2 = (a: Complex): number => a[0] * a[0] + a[1] * a[1];

export const abs = (a: Complex): number => Math.sqrt(abs2(a));

export const scale = (a: Complex, s: number): Complex => [a[0] * s, a[1] * s];

export const negate = (a: Complex): Complex => [-a[0], -a[1]];
