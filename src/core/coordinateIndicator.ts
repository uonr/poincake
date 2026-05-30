import {
  type EdgeIndex,
  edgeIndex,
  type GridAnchor,
  gridAnchor,
  type LocalAnchor,
  localAnchorKey,
  ROOT_CHART_ID,
  walkKey,
} from '../grid/tilingAddress';
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

export const parseGridAnchorCoordinate = (text: string): GridAnchor | null => {
  const [chartPart, walkPart, localPart, extraPart] = text.trim().split(';');
  if (!chartPart || !walkPart || !localPart || extraPart !== undefined) {
    return null;
  }

  const walk =
    walkPart === 'root'
      ? []
      : walkPart.split('.').map((part) => {
          const value = Number(part);
          return Number.isInteger(value) && (value === 0 || value === 1 || value === 2)
            ? edgeIndex(value)
            : null;
        });
  if (walk.some((edge) => edge === null)) {
    return null;
  }

  const local = parseLocalAnchor(localPart);
  if (!local) {
    return null;
  }

  return gridAnchor(
    walk.filter((edge): edge is EdgeIndex => edge !== null),
    local,
    expandChartId(chartPart),
  );
};

const expandChartId = (chartId: string): string =>
  chartId === ROOT_CHART_ID || chartId.startsWith('chart-') ? chartId : `chart-${chartId}`;

const parseLocalAnchor = (text: string): LocalAnchor | null => {
  if (text === 'center') {
    return { kind: 'center' };
  }

  const vertex = /^vertex:(\d+)$/.exec(text);
  if (vertex?.[1]) {
    return { kind: 'vertex', index: Number(vertex[1]) };
  }

  const edge = /^edge:(\d+):(\d+)\/(\d+)$/.exec(text);
  if (!edge?.[1] || !edge[2] || !edge[3]) {
    return null;
  }

  const index = Number(edge[1]);
  const subdivision = Number(edge[2]);
  const subdivisions = Number(edge[3]);
  if (index < 0 || index > 2 || subdivision <= 0 || subdivision >= subdivisions) {
    return null;
  }

  return {
    kind: 'edge',
    index,
    subdivision,
    subdivisions,
  };
};
