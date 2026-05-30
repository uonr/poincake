import { abs2 } from '../geometry/complex';
import type { DiskPoint } from '../geometry/disk';
import { applyTransform, type DiskTransform } from '../geometry/mobius';
import type { Arrow } from '../model/arrow';

export const arrowNavigationTarget = (
  arrow: Arrow,
  from: DiskPoint,
  to: DiskPoint,
  view: DiskTransform,
): DiskPoint | null => {
  switch (arrow.appearance.headMode) {
    case 'none':
      return null;
    case 'start':
      return from;
    case 'end':
      return to;
    case 'both':
      return fartherEndpoint(from, to, view);
  }
};

const fartherEndpoint = (from: DiskPoint, to: DiskPoint, view: DiskTransform): DiskPoint => {
  const viewFrom = applyTransform(view, from);
  const viewTo = applyTransform(view, to);
  return abs2(viewFrom) > abs2(viewTo) ? from : to;
};
