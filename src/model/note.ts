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

export type ImageNoteContent = Readonly<{
  kind: 'image';
  // Content-hash key into the AssetStore; the image bytes live in IndexedDB, not
  // inline. The serialized world file inlines the bytes as a data URL instead
  // (see worldFile.ts), so this id never leaves the running session.
  assetId: string;
  alt: string;
  mimeType: string;
}>;

export type NoteContent = PlainTextNoteContent | CoordinateLinkNoteContent | ImageNoteContent;

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

export const noteDisplayText = (note: Note): string =>
  note.content.kind === 'image' ? note.content.alt : note.content.text;

export const noteColor = (note: Note): NoteColor => note.appearance.color;

export const noteCoordinateTarget = (note: Note): GridAnchor | null =>
  note.content.kind === 'coordinate-link' ? note.content.target : null;

export const noteIsTextEditable = (note: Note): boolean => note.content.kind !== 'image';
