import { describe, expect, it } from 'vitest';
import { AnchoredGrid } from '../src/grid/anchoredGrid';
import { generateHyperbolicTiling } from '../src/grid/hyperbolicTiling';
import { WorldHistory } from '../src/model/history';
import type { Note } from '../src/model/note';
import { HyperbolicWorldState } from '../src/model/worldState';
import { anchorAt } from './support';

const createWorld = () => {
  const tiling = generateHyperbolicTiling({ maxRadius: 0.75, maxTiles: 80 });
  const grid = new AnchoredGrid(tiling);
  const anchor = anchorAt(tiling, 0);
  if (!anchor) {
    throw new Error('Test tiling did not generate any grid anchors.');
  }
  const note: Note = {
    id: 'note-1',
    anchor,
    content: {
      kind: 'plain-text',
      text: 'Before',
    },
    appearance: {
      color: 'c1',
    },
    createdAt: 1,
    updatedAt: 1,
  };

  return new HyperbolicWorldState([note], grid);
};

describe('world history', () => {
  it('tracks undo and redo availability while applying patches', () => {
    const world = createWorld();
    const history = new WorldHistory();

    expect(history.state).toEqual({ canUndo: false, canRedo: false });

    history.record({
      type: 'update-note',
      noteId: 'note-1',
      before: {
        content: {
          kind: 'plain-text',
          text: 'Before',
        },
        appearance: {
          color: 'c1',
        },
        updatedAt: 1,
      },
      after: {
        content: {
          kind: 'plain-text',
          text: 'After',
        },
        appearance: {
          color: 'c2',
        },
        updatedAt: 2,
      },
    });

    expect(history.state).toEqual({ canUndo: true, canRedo: false });

    expect(history.undo(world)).toBe(true);
    expect(world.notes[0]?.content.text).toBe('Before');
    expect(history.state).toEqual({ canUndo: false, canRedo: true });

    expect(history.redo(world)).toBe(true);
    expect(world.notes[0]?.content.text).toBe('After');
    expect(history.state).toEqual({ canUndo: true, canRedo: false });
  });

  it('clears redo history when a new patch is recorded', () => {
    const world = createWorld();
    const history = new WorldHistory();
    const note = world.notes[0];

    expect(note).toBeDefined();
    if (!note) {
      return;
    }

    history.record({
      type: 'delete-note',
      note,
    });
    history.undo(world);

    expect(history.state).toEqual({ canUndo: false, canRedo: true });

    history.record({
      type: 'move-note',
      noteId: 'note-1',
      before: {
        anchor: anchorAt(world.grid.tiling, 0) ?? note.anchor,
        updatedAt: 1,
      },
      after: {
        anchor: anchorAt(world.grid.tiling, 1) ?? note.anchor,
        updatedAt: 3,
      },
    });

    expect(history.state).toEqual({ canUndo: true, canRedo: false });
  });
});
