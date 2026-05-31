import { describe, expect, it } from 'vitest';
import { formatGridAnchor } from '../src/core/coordinateIndicator';
import { gridAnchor } from '../src/grid/tilingAddress';
import type { NoteDraft } from '../src/model/noteDraft';
import { parseNoteDraft } from '../src/model/noteDraft';

describe('note draft parsing', () => {
  it('normalizes surrounding whitespace before committing to the note model', () => {
    const parsed = parseNoteDraft({ text: '  a note  ', color: 'c2' });

    expect(parsed).toEqual({
      ok: true,
      value: {
        content: {
          kind: 'plain-text',
          text: 'a note',
        },
        appearance: {
          color: 'c2',
        },
      },
    });
  });

  it('rejects empty committed notes before they enter the note model', () => {
    const parsed = parseNoteDraft({ text: '   ', color: 'c1' });

    expect(parsed).toEqual({
      ok: false,
      reason: 'Note text cannot be empty.',
    });
  });

  it('parses coordinate text into a coordinate link content variant', () => {
    const anchor = gridAnchor([], { kind: 'center' });
    const text = formatGridAnchor(anchor);

    const parsed = parseNoteDraft({ text, color: 'c1' });

    expect(parsed).toEqual({
      ok: true,
      value: {
        content: {
          kind: 'coordinate-link',
          text,
          target: anchor,
        },
        appearance: {
          color: 'c1',
        },
      },
    });
  });

  it('rejects unparsed color input before it enters the note model', () => {
    const draft = {
      text: 'a note',
      color: 'not-a-note-color',
    } as unknown as NoteDraft;

    const parsed = parseNoteDraft(draft);

    expect(parsed).toEqual({
      ok: false,
      reason: 'Unknown note color: not-a-note-color',
    });
  });
});
