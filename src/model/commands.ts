import type { DiskPoint } from '../geometry/disk';
import type { DiskTransform } from '../geometry/mobius';
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
  | Readonly<{ type: 'move-note'; noteId: NoteId; position: DiskPoint; updatedAt: number }>
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
  position: DiskPoint;
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
    }>;

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
        position: note.position,
        updatedAt: note.updatedAt,
      };
      const after: NoteMoveSnapshot = {
        position: command.position,
        updatedAt: command.updatedAt,
      };

      note.position = command.position;
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
      note.position = snapshot.position;
      note.updatedAt = snapshot.updatedAt;
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

const cloneNote = (note: Note): Note => ({
  ...note,
  position: [...note.position],
  content: { ...note.content },
  appearance: { ...note.appearance },
});
