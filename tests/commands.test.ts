import { describe, expect, it } from 'vitest';
import { applyTransform, identityTransform, transformFromPointPair } from '../src/geometry/mobius';
import { AnchoredGrid } from '../src/grid/anchoredGrid';
import { generateHyperbolicTiling } from '../src/grid/hyperbolicTiling';
import { applyWorldCommand, applyWorldPatch } from '../src/model/commands';
import type { Note } from '../src/model/note';
import { HyperbolicWorldState } from '../src/model/worldState';
import { projectDiskPoint, type Viewport } from '../src/render/viewport';
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

describe('world commands', () => {
  it('creates notes and produces a reversible patch', () => {
    const world = createWorld();
    const anchor = anchorAt(world.grid.tiling, 1);
    if (!anchor) {
      throw new Error('Test tiling did not generate a second grid anchor.');
    }
    const note: Note = {
      id: 'note-2',
      anchor,
      content: {
        kind: 'plain-text',
        text: 'Created',
      },
      appearance: {
        color: 'c2',
      },
      createdAt: 5,
      updatedAt: 5,
    };

    const result = applyWorldCommand(world, {
      type: 'create-note',
      note,
    });

    expect(world.notes.map((candidate) => candidate.id)).toEqual(['note-1', 'note-2']);
    expect(result.patch).toEqual({
      type: 'create-note',
      note,
    });

    if (!result.patch) {
      return;
    }

    applyWorldPatch(world, result.patch, 'backward');
    expect(world.notes.map((candidate) => candidate.id)).toEqual(['note-1']);

    applyWorldPatch(world, result.patch, 'forward');
    expect(world.notes.map((candidate) => candidate.id)).toEqual(['note-1', 'note-2']);
  });

  it('updates note content and appearance through one command', () => {
    const world = createWorld();

    const result = applyWorldCommand(world, {
      type: 'update-note',
      noteId: 'note-1',
      content: {
        kind: 'plain-text',
        text: 'After',
      },
      appearance: {
        color: 'c3',
      },
      updatedAt: 2,
    });

    expect(world.notes[0]?.content.text).toBe('After');
    expect(world.notes[0]?.appearance.color).toBe('c3');
    expect(world.notes[0]?.updatedAt).toBe(2);
    expect(result.patch).toEqual({
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
          color: 'c3',
        },
        updatedAt: 2,
      },
    });
  });

  it('moves and deletes notes without exposing mutation details to callers', () => {
    const world = createWorld();
    const anchor = anchorAt(world.grid.tiling, 1);
    if (!anchor) {
      throw new Error('Test tiling did not generate a second grid anchor.');
    }

    applyWorldCommand(world, {
      type: 'move-note',
      noteId: 'note-1',
      anchor,
      updatedAt: 3,
    });

    expect(world.notes[0]?.anchor).toEqual(anchor);
    expect(world.notes[0]?.updatedAt).toBe(3);

    applyWorldCommand(world, {
      type: 'delete-note',
      noteId: 'note-1',
    });

    expect(world.notes).toEqual([]);
  });

  it('does not produce patches for missing notes', () => {
    const world = createWorld();
    const originalAnchor = world.notes[0]?.anchor;
    const anchor = anchorAt(world.grid.tiling, 1);
    if (!anchor) {
      throw new Error('Test tiling did not generate a second grid anchor.');
    }

    const result = applyWorldCommand(world, {
      type: 'move-note',
      noteId: 'missing-note',
      anchor,
      updatedAt: 3,
    });

    expect(result.patch).toBeUndefined();
    expect(world.notes[0]?.anchor).toEqual(originalAnchor);
  });

  it('applies command patches forward and backward without whole-world snapshots', () => {
    const world = createWorld();
    const updateResult = applyWorldCommand(world, {
      type: 'update-note',
      noteId: 'note-1',
      content: {
        kind: 'plain-text',
        text: 'After',
      },
      appearance: {
        color: 'c4',
      },
      updatedAt: 4,
    });

    expect(updateResult.patch).toBeDefined();
    if (!updateResult.patch) {
      return;
    }

    applyWorldPatch(world, updateResult.patch, 'backward');
    expect(world.notes[0]?.content.text).toBe('Before');
    expect(world.notes[0]?.appearance.color).toBe('c1');
    expect(world.notes[0]?.updatedAt).toBe(1);

    applyWorldPatch(world, updateResult.patch, 'forward');
    expect(world.notes[0]?.content.text).toBe('After');
    expect(world.notes[0]?.appearance.color).toBe('c4');
    expect(world.notes[0]?.updatedAt).toBe(4);
  });

  it('restores created and deleted notes from patches', () => {
    const world = createWorld();
    const deleteResult = applyWorldCommand(world, {
      type: 'delete-note',
      noteId: 'note-1',
    });

    expect(world.notes).toEqual([]);
    expect(deleteResult.patch).toBeDefined();
    if (!deleteResult.patch) {
      return;
    }

    applyWorldPatch(world, deleteResult.patch, 'backward');
    expect(world.notes[0]?.id).toBe('note-1');

    applyWorldPatch(world, deleteResult.patch, 'forward');
    expect(world.notes).toEqual([]);
  });

  it('reanchors world state and transient points together', () => {
    const world = createWorld();
    const transientPoint = [0.2, -0.1] as const;
    const transform = transformFromPointPair([0.4, 0.1], [0, 0]);
    const noteAnchor = world.notes[0]?.anchor;
    const notePosition = noteAnchor ? world.grid.worldPointForAnchor(noteAnchor) : null;
    const expectedNotePosition = applyTransform(transform, notePosition ?? [0, 0]);
    const expectedHomePosition = applyTransform(transform, world.home);
    const expectedTransientPoint = applyTransform(transform, transientPoint);
    const gridPoint = world.grid.tiling.coarseGridPoints[0];

    expect(gridPoint).toBeDefined();

    if (!gridPoint) {
      return;
    }

    const expectedGridPoint = applyTransform(transform, gridPoint.point);
    const viewport: Viewport = {
      width: 800,
      height: 600,
      left: 0,
      top: 0,
      cx: 400,
      cy: 300,
      radius: 500,
      zoom: 1,
    };

    const result = applyWorldCommand(world, {
      type: 'reanchor-world',
      transform,
      transientPoints: [transientPoint],
    });
    const projectedGridPoint = projectDiskPoint(expectedGridPoint, viewport);
    const snapped = world.grid.snapScreenPoint(
      projectedGridPoint.x,
      projectedGridPoint.y,
      identityTransform,
      viewport,
    );

    const actualNotePosition = noteAnchor ? world.grid.worldPointForAnchor(noteAnchor) : null;
    expect(world.notes[0]?.anchor).toEqual(noteAnchor);
    expect(actualNotePosition?.[0]).toBeCloseTo(expectedNotePosition[0], 10);
    expect(actualNotePosition?.[1]).toBeCloseTo(expectedNotePosition[1], 10);
    expect(world.home[0]).toBeCloseTo(expectedHomePosition[0], 10);
    expect(world.home[1]).toBeCloseTo(expectedHomePosition[1], 10);
    expect(result.transientPoints?.[0]?.[0]).toBeCloseTo(expectedTransientPoint[0], 10);
    expect(result.transientPoints?.[0]?.[1]).toBeCloseTo(expectedTransientPoint[1], 10);
    expect(result.patch).toBeUndefined();
    expect(snapped?.point[0]).toBeCloseTo(expectedGridPoint[0], 10);
    expect(snapped?.point[1]).toBeCloseTo(expectedGridPoint[1], 10);
  });
});
