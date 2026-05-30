import type { DiskPoint } from '../geometry/disk';
import { applyTransform, type DiskTransform } from '../geometry/mobius';
import type { AnchoredGrid } from '../grid/anchoredGrid';
import type { Arrow } from './arrow';
import type { Note } from './note';

export class HyperbolicWorldState {
  private homePoint: DiskPoint = [0, 0];

  constructor(
    readonly notes: Note[],
    readonly grid: AnchoredGrid,
    readonly arrows: Arrow[] = [],
  ) {}

  get home(): DiskPoint {
    return this.homePoint;
  }

  reanchor(
    transform: DiskTransform,
    transientPoints: readonly (DiskPoint | null)[] = [],
  ): (DiskPoint | null)[] {
    for (const note of this.notes) {
      note.position = applyTransform(transform, note.position);
    }

    for (const arrow of this.arrows) {
      arrow.from = applyTransform(transform, arrow.from);
      arrow.to = applyTransform(transform, arrow.to);
    }

    this.homePoint = applyTransform(transform, this.homePoint);
    this.grid.reanchor(transform);

    return transientPoints.map((point) => (point ? applyTransform(transform, point) : null));
  }
}
