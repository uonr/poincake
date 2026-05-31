import { describe, expect, it } from 'vitest';
import { arrowNavigationTarget } from '../src/core/arrowNavigation';
import type { DiskPoint } from '../src/geometry/disk';
import { identityTransform } from '../src/geometry/mobius';
import { gridAnchor } from '../src/grid/tilingAddress';
import type { Arrow, ArrowHeadMode } from '../src/model/arrow';

const arrowWithHeadMode = (headMode: ArrowHeadMode): Arrow => ({
  id: 'arrow-0',
  from: gridAnchor([], { kind: 'center' }),
  to: gridAnchor([0], { kind: 'center' }),
  label: '',
  appearance: {
    color: 'c1',
    headMode,
  },
  createdAt: 1,
  updatedAt: 1,
});

describe('arrow navigation target', () => {
  const from: DiskPoint = [0.2, 0];
  const to: DiskPoint = [0.55, 0];

  it('does nothing for arrows without endpoint heads', () => {
    expect(
      arrowNavigationTarget(arrowWithHeadMode('none'), from, to, identityTransform),
    ).toBeNull();
  });

  it('uses the farther endpoint regardless of which end is headed', () => {
    expect(arrowNavigationTarget(arrowWithHeadMode('start'), from, to, identityTransform)).toBe(to);
    expect(arrowNavigationTarget(arrowWithHeadMode('end'), from, to, identityTransform)).toBe(to);
    expect(arrowNavigationTarget(arrowWithHeadMode('both'), from, to, identityTransform)).toBe(to);
  });
});
