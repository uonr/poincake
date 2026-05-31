import type { GridAnchor } from '../grid/tilingAddress';

export type NoteColor = 'c1' | 'c2' | 'c3' | 'c4';
export type NoteId = string;

export type PlainTextNoteContent = Readonly<{
  kind: 'plain-text';
  text: string;
}>;

export type CoordinateLinkNoteContent = Readonly<{
  kind: 'coordinate-link';
  text: string;
  target: GridAnchor;
}>;

export type NoteContent = PlainTextNoteContent | CoordinateLinkNoteContent;

export type NoteAppearance = Readonly<{
  color: NoteColor;
}>;

export type Note = {
  id: NoteId;
  anchor: GridAnchor;
  content: NoteContent;
  appearance: NoteAppearance;
  createdAt: number;
  updatedAt: number;
};

export const noteDisplayText = (note: Note): string => note.content.text;

export const noteColor = (note: Note): NoteColor => note.appearance.color;

export const noteCoordinateTarget = (note: Note): GridAnchor | null =>
  note.content.kind === 'coordinate-link' ? note.content.target : null;
