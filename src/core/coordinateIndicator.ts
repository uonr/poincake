import { type GridAnchor, localAnchorKey, walkKey } from '../grid/tilingAddress';
import type { ArrowId } from '../model/arrow';
import type { NoteId } from '../model/note';

export type CoordinateTargetSource = 'selected' | 'hovered';

export type NoteCoordinateTarget = Readonly<{
  kind: 'note';
  source: CoordinateTargetSource;
  noteId: NoteId;
  anchor: GridAnchor;
}>;

export type ArrowCoordinateTarget = Readonly<{
  kind: 'arrow';
  source: CoordinateTargetSource;
  arrowId: ArrowId;
  from: GridAnchor;
  to: GridAnchor;
}>;

export type CoordinateTarget = NoteCoordinateTarget | ArrowCoordinateTarget;

const compactChartId = (chartId: string): string => chartId.replace(/^chart-/, '');

export const formatGridAnchor = (anchor: GridAnchor): string =>
  `${compactChartId(anchor.chartId)};${walkKey(anchor.walk)};${localAnchorKey(anchor.local)}`;

export const formatCoordinateTarget = (target: CoordinateTarget): string => {
  switch (target.kind) {
    case 'note':
      return formatGridAnchor(target.anchor);
    case 'arrow':
      return `from(${formatGridAnchor(target.from)}) -> to(${formatGridAnchor(target.to)})`;
  }
};

export const coordinateTargetTitle = (target: CoordinateTarget): string => {
  const source = target.source === 'selected' ? 'Selected' : 'Hovered';
  return `${source} ${target.kind}`;
};
