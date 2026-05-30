import type { GridAnchor } from '../grid/tilingAddress';
import type { NoteColor } from './note';

export type ArrowId = string;

export type ArrowHeadMode = 'none' | 'start' | 'end' | 'both';

export type ArrowAppearance = Readonly<{
  color: NoteColor;
  headMode: ArrowHeadMode;
}>;

// Arrows persist the combinatorial anchors they connect; Poincare disk coordinates
// are only a chart-dependent rendering detail.
export type Arrow = {
  id: ArrowId;
  from: GridAnchor;
  to: GridAnchor;
  label: string;
  appearance: ArrowAppearance;
  createdAt: number;
  updatedAt: number;
};

export const arrowColor = (arrow: Arrow): NoteColor => arrow.appearance.color;

export const arrowLabel = (arrow: Arrow): string => arrow.label;

export const arrowHeadMode = (arrow: Arrow): ArrowHeadMode => arrow.appearance.headMode;
