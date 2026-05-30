import type { DiskPoint } from '../geometry/disk';
import type { NoteColor } from './note';

export type ArrowId = string;

export type ArrowAppearance = Readonly<{
  color: NoteColor;
}>;

// An arrow is anchored to two world-frame grid points; like a note's position,
// both endpoints are carried through reanchoring Möbius transforms.
export type Arrow = {
  id: ArrowId;
  from: DiskPoint;
  to: DiskPoint;
  label: string;
  appearance: ArrowAppearance;
  createdAt: number;
  updatedAt: number;
};

export const arrowColor = (arrow: Arrow): NoteColor => arrow.appearance.color;

export const arrowLabel = (arrow: Arrow): string => arrow.label;
