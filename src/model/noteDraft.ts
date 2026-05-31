import { parseGridAnchorCoordinate } from '../core/coordinateIndicator';
import type { NoteAppearance, NoteColor, NoteContent } from './note';

export type NoteDraft = Readonly<{
  text: string;
  color: NoteColor;
}>;

export type ParsedNoteDraft = Readonly<{
  content: NoteContent;
  appearance: NoteAppearance;
}>;

export type ParseResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; reason: string }>;

export const NOTE_COLORS: readonly NoteColor[] = ['c1', 'c2', 'c3', 'c4'];

export const parseNoteDraft = (draft: NoteDraft): ParseResult<ParsedNoteDraft> => {
  if (!NOTE_COLORS.includes(draft.color)) {
    return { ok: false, reason: `Unknown note color: ${draft.color}` };
  }

  const text = draft.text.trim();
  if (text.length === 0) {
    return { ok: false, reason: 'Note text cannot be empty.' };
  }

  return {
    ok: true,
    value: {
      content: parseNoteContent(text),
      appearance: {
        color: draft.color,
      },
    },
  };
};

export const parseNoteContent = (text: string): NoteContent => {
  const target = parseGridAnchorCoordinate(text);
  if (target) {
    return {
      kind: 'coordinate-link',
      text,
      target,
    };
  }

  return {
    kind: 'plain-text',
    text,
  };
};
