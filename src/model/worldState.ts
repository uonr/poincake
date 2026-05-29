import type { DiskPoint } from '../geometry/disk';
import { applyTransform, type DiskTransform } from '../geometry/mobius';
import type { AnchoredGrid } from '../grid/anchoredGrid';
import type { Note } from './note';

export class HyperbolicWorldState {
  private homePoint: DiskPoint = [0, 0];

  constructor(
    readonly notes: Note[],
    readonly grid: AnchoredGrid,
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

    this.homePoint = applyTransform(transform, this.homePoint);
    this.grid.reanchor(transform);

    return transientPoints.map((point) => (point ? applyTransform(transform, point) : null));
  }
}
