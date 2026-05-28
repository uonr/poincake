import type { DiskPoint } from '../geometry/disk';

export type NoteColor = 'c1' | 'c2' | 'c3' | 'c4';

export type Note = {
  id: string;
  position: DiskPoint;
  text: string;
  color: NoteColor;
  createdAt: number;
  updatedAt: number;
};
