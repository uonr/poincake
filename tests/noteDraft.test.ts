import { describe, expect, it } from 'vitest';
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
