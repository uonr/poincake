import type { ArrowId } from '../model/arrow';
import type { NoteColor } from '../model/note';
import type { ScreenPoint } from './editingSession';

// The currently selected arrow plus where its inspector should float on screen
// (the projected midpoint of its geodesic, recomputed as the view changes).
export type ArrowSelection = Readonly<{
  arrowId: ArrowId;
  label: string;
  color: NoteColor;
  screenPosition: ScreenPoint;
}>;
