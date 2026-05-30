import type { NoteColor, NoteId } from '../model/note';

export type SelectedNoteSummary = Readonly<{
  id: NoteId;
  text: string;
  color: NoteColor;
}>;

export type SelectionState = Readonly<{
  selectedNoteId: NoteId | null;
  hoveredNoteId: NoteId | null;
  editingNoteId: NoteId | null;
  draggingNoteId: NoteId | null;
  selectedNote: SelectedNoteSummary | null;
}>;

export const emptySelectionState: SelectionState = {
  selectedNoteId: null,
  hoveredNoteId: null,
  editingNoteId: null,
  draggingNoteId: null,
  selectedNote: null,
};
