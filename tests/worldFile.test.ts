import { describe, expect, it } from 'vitest';
import { formatGridAnchor } from '../src/core/coordinateIndicator';
import { AnchoredGrid } from '../src/grid/anchoredGrid';
import { generateHyperbolicTiling } from '../src/grid/hyperbolicTiling';
import { ROOT_CHART_ID } from '../src/grid/tilingAddress';
import type { Arrow } from '../src/model/arrow';
import type { Note } from '../src/model/note';
import { parseWorldFileText, stringifyWorldFile, WORLD_FILE_VERSION } from '../src/model/worldFile';
import { HyperbolicWorldState } from '../src/model/worldState';
import { anchorAt } from './support';

const createWorld = () => {
  const tiling = generateHyperbolicTiling({ maxRadius: 0.75, maxTiles: 80 });
  const grid = new AnchoredGrid(tiling);
  const firstAnchor = anchorAt(tiling, 0);
  const secondAnchor = anchorAt(tiling, 1);
  if (!firstAnchor || !secondAnchor) {
    throw new Error('Test tiling did not generate enough grid anchors.');
  }

  const note: Note = {
    id: 'note-4',
    anchor: firstAnchor,
    content: {
      kind: 'plain-text',
      text: 'Exported note',
    },
    appearance: {
      color: 'c2',
    },
    createdAt: 1,
    updatedAt: 2,
  };
  const coordinateNote: Note = {
    id: 'note-coordinate',
    anchor: secondAnchor,
    content: {
      kind: 'coordinate-link',
      text: formatGridAnchor(firstAnchor),
      target: firstAnchor,
    },
    appearance: {
      color: 'c4',
    },
    createdAt: 2,
    updatedAt: 3,
  };
  const arrow: Arrow = {
    id: 'arrow-2',
    from: firstAnchor,
    to: secondAnchor,
    label: 'Link',
    appearance: {
      color: 'c3',
      headMode: 'both',
    },
    createdAt: 3,
    updatedAt: 4,
  };

  return new HyperbolicWorldState([note, coordinateNote], grid, [arrow]);
};

describe('world file import/export', () => {
  it('round-trips notes, arrows, charts, and the file version', () => {
    const parsed = parseWorldFileText(stringifyWorldFile(createWorld()));

    expect(parsed.notes[0]?.content.text).toBe('Exported note');
    expect(parsed.notes[1]?.content).toMatchObject({
      kind: 'coordinate-link',
      target: parsed.notes[0]?.anchor,
    });
    expect(parsed.arrows[0]?.label).toBe('Link');
    expect(parsed.charts.map((chart) => chart.id)).toContain(ROOT_CHART_ID);
  });

  it('parses walks into reduced addresses before they enter the model', () => {
    const parsed = parseWorldFileText(
      JSON.stringify({
        format: 'poincake-world',
        version: WORLD_FILE_VERSION,
        exportedAt: '2026-05-31T00:00:00.000Z',
        content: {
          notes: [
            {
              id: 'note-1',
              anchor: {
                chartId: ROOT_CHART_ID,
                walk: [0, 0],
                local: { kind: 'center' },
              },
              content: { kind: 'plain-text', text: 'Reduced' },
              appearance: { color: 'c1' },
              createdAt: 1,
              updatedAt: 1,
            },
          ],
          arrows: [],
          charts: [{ id: ROOT_CHART_ID, parentId: null, transition: [] }],
        },
      }),
    );

    expect(parsed.notes[0]?.anchor.walk).toEqual([]);
  });

  it('rejects unsupported versions and duplicate ids', () => {
    const file = JSON.parse(stringifyWorldFile(createWorld()));

    expect(() => parseWorldFileText(JSON.stringify({ ...file, version: 999 }))).toThrow();

    file.content.notes.push({ ...file.content.notes[0] });
    expect(() => parseWorldFileText(JSON.stringify(file))).toThrow(/Duplicate note id/);
  });
});
