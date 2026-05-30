import { describe, expect, it } from 'vitest';
import {
  formatCoordinateTarget,
  formatGridAnchor,
  parseGridAnchorCoordinate,
} from '../src/core/coordinateIndicator';
import { edgeIndex, gridAnchor } from '../src/grid/tilingAddress';

describe('coordinate indicator formatting', () => {
  it('formats a grid anchor as a stable copy string', () => {
    const anchor = gridAnchor([edgeIndex(0), edgeIndex(1)], {
      kind: 'edge',
      index: 2,
      subdivision: 1,
      subdivisions: 3,
    });

    expect(formatGridAnchor(anchor)).toBe('root;0.1;edge:2:1/3');
  });

  it('formats arrow endpoints in order', () => {
    const from = gridAnchor([], { kind: 'center' });
    const to = gridAnchor([edgeIndex(2)], { kind: 'vertex', index: 4 }, 'chart-2');

    expect(
      formatCoordinateTarget({
        kind: 'arrow',
        source: 'selected',
        arrowId: 'arrow-0',
        from,
        to,
      }),
    ).toBe('from(root;root;center) -> to(2;2;vertex:4)');
  });

  it('parses copied single-anchor coordinates back into grid anchors', () => {
    expect(parseGridAnchorCoordinate('root;0.1;edge:2:1/3')).toEqual(
      gridAnchor([edgeIndex(0), edgeIndex(1)], {
        kind: 'edge',
        index: 2,
        subdivision: 1,
        subdivisions: 3,
      }),
    );
    expect(parseGridAnchorCoordinate('2;2;vertex:4')).toEqual(
      gridAnchor([edgeIndex(2)], { kind: 'vertex', index: 4 }, 'chart-2'),
    );
  });

  it('rejects arrow endpoint strings and malformed anchors', () => {
    expect(parseGridAnchorCoordinate('from(root;root;center) -> to(2;2;vertex:4)')).toBeNull();
    expect(parseGridAnchorCoordinate('root;3;center')).toBeNull();
    expect(parseGridAnchorCoordinate('root;root;edge:0:2/2')).toBeNull();
  });
});
