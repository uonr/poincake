import type { DiskPoint } from '../geometry/disk';
import type { DiskTransform } from '../geometry/mobius';
import { cloneAnchor, type GridAnchor } from '../grid/tilingAddress';
import type { Arrow, ArrowAppearance, ArrowId } from './arrow';
import type { Note, NoteAppearance, NoteContent, NoteId } from './note';
import type { HyperbolicWorldState } from './worldState';

export type WorldCommand =
  | Readonly<{ type: 'create-note'; note: Note }>
  | Readonly<{
      type: 'update-note';
      noteId: NoteId;
      content: NoteContent;
      appearance: NoteAppearance;
      updatedAt: number;
    }>
  | Readonly<{ type: 'delete-note'; noteId: NoteId }>
  | Readonly<{ type: 'move-note'; noteId: NoteId; anchor: GridAnchor; updatedAt: number }>
  | Readonly<{ type: 'create-arrow'; arrow: Arrow }>
  | Readonly<{
      type: 'update-arrow';
      arrowId: ArrowId;
      label: string;
      appearance: ArrowAppearance;
      updatedAt: number;
    }>
  | Readonly<{ type: 'delete-arrow'; arrowId: ArrowId }>
  | Readonly<{
      type: 'reanchor-world';
      transform: DiskTransform;
      transientPoints?: readonly (DiskPoint | null)[];
    }>;

export type NoteUpdateSnapshot = Readonly<{
  content: NoteContent;
  appearance: NoteAppearance;
  updatedAt: number;
}>;

export type NoteMoveSnapshot = Readonly<{
  anchor: GridAnchor;
  updatedAt: number;
}>;

export type ArrowUpdateSnapshot = Readonly<{
  label: string;
  appearance: ArrowAppearance;
  updatedAt: number;
}>;

export type WorldPatch =
  | Readonly<{ type: 'create-note'; note: Note }>
  | Readonly<{ type: 'delete-note'; note: Note }>
  | Readonly<{
      type: 'update-note';
      noteId: NoteId;
      before: NoteUpdateSnapshot;
      after: NoteUpdateSnapshot;
    }>
  | Readonly<{
      type: 'move-note';
      noteId: NoteId;
      before: NoteMoveSnapshot;
      after: NoteMoveSnapshot;
    }>
  | Readonly<{ type: 'create-arrow'; arrow: Arrow }>
  | Readonly<{
      type: 'update-arrow';
      arrowId: ArrowId;
      before: ArrowUpdateSnapshot;
      after: ArrowUpdateSnapshot;
    }>
  | Readonly<{ type: 'delete-arrow'; arrow: Arrow }>;

export type WorldCommandResult = Readonly<{
  patch?: WorldPatch;
  note?: Note;
  transientPoints?: readonly (DiskPoint | null)[];
}>;

export const applyWorldCommand = (
  world: HyperbolicWorldState,
  command: WorldCommand,
): WorldCommandResult => {
  switch (command.type) {
    case 'create-note': {
      world.notes.push(command.note);
      return {
        note: command.note,
        patch: {
          type: 'create-note',
          note: cloneNote(command.note),
        },
      };
    }

    case 'update-note': {
      const note = world.notes.find((candidate) => candidate.id === command.noteId);
      if (!note) {
        return {};
      }

      const before: NoteUpdateSnapshot = {
        content: note.content,
        appearance: note.appearance,
        updatedAt: note.updatedAt,
      };
      const after: NoteUpdateSnapshot = {
        content: command.content,
        appearance: command.appearance,
        updatedAt: command.updatedAt,
      };

      note.content = command.content;
      note.appearance = command.appearance;
      note.updatedAt = command.updatedAt;
      return {
        note,
        patch: {
          type: 'update-note',
          noteId: note.id,
          before,
          after,
        },
      };
    }

    case 'delete-note': {
      const index = world.notes.findIndex((candidate) => candidate.id === command.noteId);
      if (index >= 0) {
        const [note] = world.notes.splice(index, 1);
        if (note) {
          return {
            patch: {
              type: 'delete-note',
              note: cloneNote(note),
            },
          };
        }
      }
      return {};
    }

    case 'move-note': {
      const note = world.notes.find((candidate) => candidate.id === command.noteId);
      if (!note) {
        return {};
      }

      const before: NoteMoveSnapshot = {
        anchor: note.anchor,
        updatedAt: note.updatedAt,
      };
      const after: NoteMoveSnapshot = {
        anchor: command.anchor,
        updatedAt: command.updatedAt,
      };

      note.anchor = command.anchor;
      note.updatedAt = command.updatedAt;
      return {
        note,
        patch: {
          type: 'move-note',
          noteId: note.id,
          before,
          after,
        },
      };
    }

    case 'create-arrow': {
      world.arrows.push(command.arrow);
      return {
        patch: {
          type: 'create-arrow',
          arrow: cloneArrow(command.arrow),
        },
      };
    }

    case 'update-arrow': {
      const arrow = world.arrows.find((candidate) => candidate.id === command.arrowId);
      if (!arrow) {
        return {};
      }

      const before: ArrowUpdateSnapshot = {
        label: arrow.label,
        appearance: arrow.appearance,
        updatedAt: arrow.updatedAt,
      };
      const after: ArrowUpdateSnapshot = {
        label: command.label,
        appearance: command.appearance,
        updatedAt: command.updatedAt,
      };

      arrow.label = command.label;
      arrow.appearance = command.appearance;
      arrow.updatedAt = command.updatedAt;
      return {
        patch: {
          type: 'update-arrow',
          arrowId: arrow.id,
          before,
          after,
        },
      };
    }

    case 'delete-arrow': {
      const index = world.arrows.findIndex((candidate) => candidate.id === command.arrowId);
      if (index >= 0) {
        const [arrow] = world.arrows.splice(index, 1);
        if (arrow) {
          return {
            patch: {
              type: 'delete-arrow',
              arrow: cloneArrow(arrow),
            },
          };
        }
      }
      return {};
    }

    case 'reanchor-world': {
      return {
        transientPoints: world.reanchor(command.transform, command.transientPoints ?? []),
      };
    }
  }
};

export const applyWorldPatch = (
  world: HyperbolicWorldState,
  patch: WorldPatch,
  direction: 'forward' | 'backward',
): void => {
  switch (patch.type) {
    case 'create-note': {
      if (direction === 'forward') {
        world.notes.push(cloneNote(patch.note));
      } else {
        deleteNote(world, patch.note.id);
      }
      return;
    }

    case 'delete-note': {
      if (direction === 'forward') {
        deleteNote(world, patch.note.id);
      } else {
        world.notes.push(cloneNote(patch.note));
      }
      return;
    }

    case 'update-note': {
      const note = world.notes.find((candidate) => candidate.id === patch.noteId);
      if (!note) {
        return;
      }

      const snapshot = direction === 'forward' ? patch.after : patch.before;
      note.content = snapshot.content;
      note.appearance = snapshot.appearance;
      note.updatedAt = snapshot.updatedAt;
      return;
    }

    case 'move-note': {
      const note = world.notes.find((candidate) => candidate.id === patch.noteId);
      if (!note) {
        return;
      }

      const snapshot = direction === 'forward' ? patch.after : patch.before;
      note.anchor = snapshot.anchor;
      note.updatedAt = snapshot.updatedAt;
      return;
    }

    case 'create-arrow': {
      if (direction === 'forward') {
        world.arrows.push(cloneArrow(patch.arrow));
      } else {
        deleteArrow(world, patch.arrow.id);
      }
      return;
    }

    case 'update-arrow': {
      const arrow = world.arrows.find((candidate) => candidate.id === patch.arrowId);
      if (!arrow) {
        return;
      }

      const snapshot = direction === 'forward' ? patch.after : patch.before;
      arrow.label = snapshot.label;
      arrow.appearance = snapshot.appearance;
      arrow.updatedAt = snapshot.updatedAt;
      return;
    }

    case 'delete-arrow': {
      if (direction === 'forward') {
        deleteArrow(world, patch.arrow.id);
      } else {
        world.arrows.push(cloneArrow(patch.arrow));
      }
      return;
    }
  }
};

const deleteNote = (world: HyperbolicWorldState, noteId: NoteId): void => {
  const index = world.notes.findIndex((candidate) => candidate.id === noteId);
  if (index >= 0) {
    world.notes.splice(index, 1);
  }
};

const deleteArrow = (world: HyperbolicWorldState, arrowId: ArrowId): void => {
  const index = world.arrows.findIndex((candidate) => candidate.id === arrowId);
  if (index >= 0) {
    world.arrows.splice(index, 1);
  }
};

const cloneNote = (note: Note): Note => ({
  ...note,
  anchor: cloneAnchor(note.anchor),
  content: cloneNoteContent(note.content),
  appearance: { ...note.appearance },
});

const cloneNoteContent = (content: NoteContent): NoteContent => {
  if (content.kind === 'coordinate-link') {
    return {
      ...content,
      target: cloneAnchor(content.target),
    };
  }

  return { ...content };
};

const cloneArrow = (arrow: Arrow): Arrow => ({
  ...arrow,
  from: cloneAnchor(arrow.from),
  to: cloneAnchor(arrow.to),
  appearance: { ...arrow.appearance },
});
