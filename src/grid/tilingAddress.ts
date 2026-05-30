// A grid identity is a combinatorial address inside a chart, never a Poincaré-disk
// coordinate. `walk` is a path of local edge reflections from the chart's root
// tile; `local` picks a point inside that addressed tile. The chart id makes the
// address relative: newly placed notes stay shallow in the current chart instead
// of being forced back through an ever-deeper root-scene fold.
export type EdgeIndex = 0 | 1 | 2;

export type AbsoluteWalk = readonly EdgeIndex[];

declare const reducedWalkBrand: unique symbol;
export type ReducedWalk = AbsoluteWalk & Readonly<{ [reducedWalkBrand]: true }>;

export type ChartId = string;

export const ROOT_CHART_ID: ChartId = 'root';

export type LocalAnchor =
  | Readonly<{ kind: 'center' }>
  | Readonly<{ kind: 'vertex'; index: number }>
  | Readonly<{ kind: 'edge'; index: number; subdivision: number; subdivisions: number }>;

export type GridAnchor = Readonly<{
  chartId: ChartId;
  walk: ReducedWalk;
  local: LocalAnchor;
}>;

export const rootWalk: ReducedWalk = [] as unknown as ReducedWalk;

export const edgeIndex = (value: number): EdgeIndex => {
  if (value !== 0 && value !== 1 && value !== 2) {
    throw new Error(`Edge index must be 0, 1, or 2; got ${value}.`);
  }
  return value;
};

const alternating = (a: EdgeIndex, b: EdgeIndex, length: number): EdgeIndex[] =>
  Array.from({ length }, (_, index) => (index % 2 === 0 ? a : b));

const compareRawWalks = (a: readonly EdgeIndex[], b: readonly EdgeIndex[]): number => {
  if (a.length !== b.length) {
    return a.length - b.length;
  }
  for (let i = 0; i < a.length; i += 1) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    if (ai !== bi) {
      return ai - bi;
    }
  }
  return 0;
};

// Bounded Coxeter reduction for the local {3,7} reflection labels. The relators
// verified against resolveTile are R_i^2=e and (R_i R_j)^7=e. This is intentionally
// a local reducer, not a claim of a complete global automatic structure yet.
export const reduceWalk = (walk: AbsoluteWalk): ReducedWalk => {
  let current = [...walk];
  let changed = true;

  while (changed) {
    changed = false;

    const withoutBacktracks: EdgeIndex[] = [];
    for (const edge of current) {
      if (withoutBacktracks[withoutBacktracks.length - 1] === edge) {
        withoutBacktracks.pop();
        changed = true;
      } else {
        withoutBacktracks.push(edge);
      }
    }
    current = withoutBacktracks;

    for (let start = 0; start < current.length; start += 1) {
      const a = current[start];
      const b = current[start + 1];
      if (a === undefined || b === undefined || a === b) {
        continue;
      }

      let length = 2;
      while (start + length < current.length) {
        const expected = length % 2 === 0 ? a : b;
        if (current[start + length] !== expected) {
          break;
        }
        length += 1;
      }

      if (length < 7) {
        continue;
      }

      const replaceLength = Math.min(length, 14);
      const complement = alternating(b, a, 14 - replaceLength);
      const candidate = [
        ...current.slice(0, start),
        ...complement,
        ...current.slice(start + replaceLength),
      ];
      const originalSegment = current.slice(start, start + replaceLength);
      const replacementWins =
        complement.length < originalSegment.length ||
        (complement.length === originalSegment.length &&
          compareRawWalks(complement, originalSegment) < 0);

      if (replacementWins) {
        current = candidate;
        changed = true;
        break;
      }
    }
  }

  return current as unknown as ReducedWalk;
};

export const gridAnchor = (
  walk: AbsoluteWalk,
  local: LocalAnchor,
  chartId: ChartId = ROOT_CHART_ID,
): GridAnchor => ({
  chartId,
  walk: reduceWalk(walk),
  local,
});

export const anchorInChart = (anchor: GridAnchor, chartId: ChartId): GridAnchor => ({
  ...anchor,
  chartId,
});

export const walkKey = (walk: AbsoluteWalk): string =>
  walk.length === 0 ? 'root' : walk.join('.');

export const localAnchorKey = (local: LocalAnchor): string => {
  switch (local.kind) {
    case 'center':
      return 'center';
    case 'vertex':
      return `vertex:${local.index}`;
    case 'edge':
      return `edge:${local.index}:${local.subdivision}/${local.subdivisions}`;
  }
};

export const gridAnchorKey = (anchor: GridAnchor): string =>
  `${anchor.chartId}:${walkKey(anchor.walk)}::${localAnchorKey(anchor.local)}`;

// Sound only because every stored walk is the canonical (shortlex-minimal) walk
// for its tile — see canonicalizeFromScene in tileCanonical.ts. Without that
// normalization two walks for the same tile would compare unequal.
export const gridAnchorsEqual = (a: GridAnchor, b: GridAnchor): boolean =>
  gridAnchorKey(a) === gridAnchorKey(b);

// Shortlex order over walks: fewer reflections first, ties broken lexically on
// the edge indices. This is the total order that picks a canonical representative
// among the tiles sharing a vertex or edge.
export const compareWalks = (a: AbsoluteWalk, b: AbsoluteWalk): number => {
  return compareRawWalks(a, b);
};

export const cloneAnchor = (anchor: GridAnchor): GridAnchor => ({
  chartId: anchor.chartId,
  walk: reduceWalk(anchor.walk),
  local: { ...anchor.local },
});
