import { describe, expect, it } from 'vitest';
import type { DiskPoint } from '../src/geometry/disk';
import { applyTransform, identityTransform, transformFromPointPair } from '../src/geometry/mobius';
import { AnchoredGrid } from '../src/grid/anchoredGrid';
import { generateHyperbolicTiling } from '../src/grid/hyperbolicTiling';
import type { Note } from '../src/model/note';
import { HyperbolicWorldState } from '../src/model/worldState';
import { projectDiskPoint, type Viewport } from '../src/render/viewport';

describe('hyperbolic world state', () => {
  it('reanchors all world-space state through one operation', () => {
    const tiling = generateHyperbolicTiling({ maxRadius: 0.85, maxTiles: 160 });
    const grid = new AnchoredGrid(tiling);
    const note: Note = {
      id: 'note-1',
      position: [0.1, -0.2],
      text: 'test',
      color: 'c1',
      createdAt: 1,
      updatedAt: 1,
    };
    const world = new HyperbolicWorldState([note], grid);
    const transform = transformFromPointPair([0.55, 0.15], [0, 0]);
    const transientPoint: DiskPoint = [0.2, 0.1];
    const expectedNotePosition = applyTransform(transform, note.position);
    const expectedHomePosition = applyTransform(transform, world.home);
    const expectedTransientPoint = applyTransform(transform, transientPoint);
    const gridPoint = tiling.coarseGridPoints[0];

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

    const [reanchoredTransientPoint] = world.reanchor(transform, [transientPoint]);
    const projectedGridPoint = projectDiskPoint(expectedGridPoint, viewport);
    const snapped = world.grid.snapScreenPoint(
      projectedGridPoint.x,
      projectedGridPoint.y,
      identityTransform,
      viewport,
    );

    expect(note.position[0]).toBeCloseTo(expectedNotePosition[0], 10);
    expect(note.position[1]).toBeCloseTo(expectedNotePosition[1], 10);
    expect(world.home[0]).toBeCloseTo(expectedHomePosition[0], 10);
    expect(world.home[1]).toBeCloseTo(expectedHomePosition[1], 10);
    expect(reanchoredTransientPoint?.[0]).toBeCloseTo(expectedTransientPoint[0], 10);
    expect(reanchoredTransientPoint?.[1]).toBeCloseTo(expectedTransientPoint[1], 10);
    expect(snapped?.point[0]).toBeCloseTo(expectedGridPoint[0], 10);
    expect(snapped?.point[1]).toBeCloseTo(expectedGridPoint[1], 10);
  });
});
