import type { DiskPoint } from '../geometry/disk';
import type { NoteId } from '../model/note';
import type { NoteDraft } from '../model/noteDraft';

export type ScreenPoint = Readonly<{
  x: number;
  y: number;
}>;

export type EditingSession = Readonly<{
  noteId: NoteId;
  anchor: DiskPoint;
  draft: NoteDraft;
  screenPosition: ScreenPoint;
}>;
