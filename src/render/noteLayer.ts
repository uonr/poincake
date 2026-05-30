import { abs2 } from '../geometry/complex';
import type { DiskPoint } from '../geometry/disk';
import { applyTransform, type DiskTransform } from '../geometry/mobius';
import { type Note, noteColor, noteDisplayText } from '../model/note';
import { projectDiskPoint, type Viewport } from './viewport';

const SCALE_TEXT = 0.26;
const DOT_MERGE_CELL = 8;
const DOT_OPACITY = 0.72;
const EDGE_MARKER_OPACITY = 0.58;
const PROJECTION_RADIUS = 0.9995;

export class NoteLayer {
  private readonly elements = new Map<string, HTMLDivElement>();

  constructor(private readonly stage: HTMLElement) {}

  dispose(): void {
    for (const element of this.elements.values()) {
      element.remove();
    }

    this.elements.clear();
  }

  sync(notes: readonly Note[]): void {
    const liveIds = new Set(notes.map((note) => note.id));

    for (const [id, element] of this.elements) {
      if (!liveIds.has(id)) {
        element.remove();
        this.elements.delete(id);
      }
    }

    for (const note of notes) {
      let element = this.elements.get(note.id);
      if (!element) {
        element = document.createElement('div');
        element.className = `item ${noteColor(note)}`;
        element.dataset.noteId = note.id;
        element.dataset.testid = 'note';
        this.stage.appendChild(element);
        this.elements.set(note.id, element);
      }

      const color = noteColor(note);
      if (!element.classList.contains(color)) {
        element.classList.remove('c1', 'c2', 'c3', 'c4');
        element.classList.add(color);
      }

      const text = noteDisplayText(note);
      if (element.textContent !== text && !element.classList.contains('editing')) {
        element.textContent = text;
      }
    }
  }

  render(
    notes: readonly Note[],
    view: DiskTransform,
    viewport: Viewport,
    editingNoteId: string | null,
    selectedNoteId: string | null = null,
  ): void {
    const occupiedDotCells = new Set<string>();

    for (const note of notes) {
      const element = this.requireElement(note.id);

      if (note.id === editingNoteId) {
        element.style.display = 'none';
        continue;
      }

      element.dataset.noteSelected = note.id === selectedNoteId ? 'true' : 'false';
      const transformed = applyTransform(view, note.position);
      const radius2 = abs2(transformed);
      const scale = 1 - radius2;
      const projected = projectDiskPoint(clampForProjection(transformed), viewport);
      const inRect =
        projected.x >= 0 &&
        projected.x <= viewport.width &&
        projected.y >= 0 &&
        projected.y <= viewport.height;

      if (inRect) {
        if (scale > SCALE_TEXT) {
          element.classList.remove('as-dot', 'as-pill-h', 'as-pill-v');
          element.dataset.noteRender = 'text';
          element.style.transform = `translate(${projected.x}px, ${projected.y}px) translate(-50%, -50%) scale(${scale})`;
          element.style.opacity = String(Math.min(1, scale * 3));
        } else {
          const dotCell = mergedDotCell(projected.x, projected.y);
          if (occupiedDotCells.has(dotCell)) {
            element.style.display = 'none';
            continue;
          }

          occupiedDotCells.add(dotCell);
          element.classList.add('as-dot');
          element.classList.remove('as-pill-h', 'as-pill-v');
          element.dataset.noteRender = 'dot';
          element.style.transform = `translate(${projected.x}px, ${projected.y}px) translate(-50%, -50%)`;
          element.style.opacity = String(DOT_OPACITY);
        }
      } else {
        this.renderEdgeMarker(element, projected.x, projected.y, viewport);
      }

      element.style.display = '';
    }
  }

  getNoteIdFromEventTarget(target: EventTarget | null): string | null {
    if (!(target instanceof Element)) {
      return null;
    }

    return target.closest<HTMLElement>('[data-testid="note"]')?.dataset.noteId ?? null;
  }

  getElement(noteId: string): HTMLDivElement | null {
    return this.elements.get(noteId) ?? null;
  }

  private requireElement(noteId: string): HTMLDivElement {
    const element = this.elements.get(noteId);
    if (!element) {
      throw new Error(`Missing element for note ${noteId}.`);
    }
    return element;
  }

  private renderEdgeMarker(
    element: HTMLDivElement,
    screenX: number,
    screenY: number,
    viewport: Viewport,
  ): void {
    const margin = 10;
    const dx = screenX - viewport.cx;
    const dy = screenY - viewport.cy;
    const tx = Math.abs(dx) < 1e-9 ? Infinity : (viewport.cx - margin) / Math.abs(dx);
    const ty = Math.abs(dy) < 1e-9 ? Infinity : (viewport.cy - margin) / Math.abs(dy);
    const t = Math.min(tx, ty);
    const edgeX = viewport.cx + t * dx;
    const edgeY = viewport.cy + t * dy;

    element.classList.remove('as-dot');
    element.dataset.noteRender = 'edge';
    if (ty < tx) {
      element.classList.add('as-pill-h');
      element.classList.remove('as-pill-v');
    } else {
      element.classList.add('as-pill-v');
      element.classList.remove('as-pill-h');
    }

    element.style.transform = `translate(${edgeX}px, ${edgeY}px) translate(-50%, -50%)`;
    element.style.opacity = String(EDGE_MARKER_OPACITY);
  }
}

const clampForProjection = (point: DiskPoint): DiskPoint => {
  const radius2 = abs2(point);
  if (radius2 <= PROJECTION_RADIUS * PROJECTION_RADIUS) {
    return point;
  }

  const radius = Math.sqrt(radius2);
  if (radius < 1e-12) {
    return point;
  }

  const factor = PROJECTION_RADIUS / radius;
  return [point[0] * factor, point[1] * factor];
};

const mergedDotCell = (x: number, y: number): string =>
  `${Math.round(x / DOT_MERGE_CELL)},${Math.round(y / DOT_MERGE_CELL)}`;
