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
    this.homePoint = applyTransform(transform, this.homePoint);
    this.grid.reanchor(transform);

    return transientPoints.map((point) => (point ? applyTransform(transform, point) : null));
  }

  replaceContent(notes: readonly Note[], arrows: readonly Arrow[]): void {
    this.notes.length = 0;
    this.notes.push(...notes);
    this.arrows.length = 0;
    this.arrows.push(...arrows);
    this.homePoint = [0, 0];
  }
}
