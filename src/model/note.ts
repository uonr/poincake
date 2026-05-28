import type { GridId } from '../grid/hyperbolicTiling';

export type NoteColor = 'c1' | 'c2' | 'c3' | 'c4';

export type Note = {
  id: string;
  position: GridId;
  text: string;
  color: NoteColor;
  createdAt: number;
  updatedAt: number;
};
