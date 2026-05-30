import { describe, expect, it } from 'vitest';
import { parseExternalLink } from '../src/model/noteLink';

describe('note links', () => {
  it('parses an entire http or https note as an external link', () => {
    expect(parseExternalLink(' https://example.com/path?q=1 ')).toEqual({
      href: 'https://example.com/path?q=1',
    });
    expect(parseExternalLink('http://example.com')).toEqual({
      href: 'http://example.com/',
    });
  });

  it('rejects partial links, relative URLs, and non-web schemes', () => {
    expect(parseExternalLink('see https://example.com')).toBeNull();
    expect(parseExternalLink('example.com')).toBeNull();
    expect(parseExternalLink('/local')).toBeNull();
    expect(parseExternalLink('javascript:alert(1)')).toBeNull();
  });
});
