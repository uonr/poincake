import { abs2 } from '../geometry/complex';
import type { DiskPoint } from '../geometry/disk';
import { applyTransform, type DiskTransform } from '../geometry/mobius';
import { type Note, type NoteContent, noteColor } from '../model/note';
import { parseExternalLink } from '../model/noteLink';
import { projectDiskPoint, type Viewport } from './viewport';

const SCALE_TEXT = 0.26;
const DOT_MERGE_CELL = 8;
const DOT_OPACITY = 0.72;
const EDGE_MARKER_OPACITY = 0.58;
const PROJECTION_RADIUS = 0.9995;

export type RenderedNote = Readonly<{
  note: Note;
  point: DiskPoint;
}>;

// Resolves an image note's assetId to a usable object URL, or null while the
// asset is still loading from storage.
export type AssetUrlResolver = (assetId: string) => string | null;

export class NoteLayer {
  private readonly elements = new Map<string, HTMLDivElement>();
  private readonly container: HTMLDivElement;

  constructor(stage: HTMLElement) {
    // Own a dedicated layer element instead of appending notes onto the shared
    // #stage, so dispose() removes them as a unit and a note appended by a late
    // async callback lands in a detached subtree rather than on the live stage.
    this.container = document.createElement('div');
    this.container.className = 'note-layer';
    stage.appendChild(this.container);
  }

  dispose(): void {
    this.container.remove();
    this.elements.clear();
  }

  sync(notes: readonly Note[], resolveAssetUrl: AssetUrlResolver): void {
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
        this.container.appendChild(element);
        this.elements.set(note.id, element);
      }

      const color = noteColor(note);
      if (!element.classList.contains(color)) {
        element.classList.remove('c1', 'c2', 'c3', 'c4');
        element.classList.add(color);
      }

      if (!element.classList.contains('editing')) {
        renderNoteContent(element, note.content, resolveAssetUrl);
      }
    }
  }

  render(
    notes: readonly RenderedNote[],
    view: DiskTransform,
    viewport: Viewport,
    editingNoteId: string | null,
    selectedNoteId: string | null = null,
  ): void {
    const occupiedDotCells = new Set<string>();

    for (const rendered of notes) {
      const { note, point } = rendered;
      const element = this.requireElement(note.id);

      if (note.id === editingNoteId) {
        element.style.display = 'none';
        continue;
      }

      element.dataset.noteSelected = note.id === selectedNoteId ? 'true' : 'false';
      const transformed = applyTransform(view, point);
      const radius2 = abs2(transformed);
      const hyperbolicScale = 1 - radius2;
      const scale = hyperbolicScale * viewport.visualScale;
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
          element.style.opacity = String(Math.min(1, hyperbolicScale * 3));
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

const renderNoteContent = (
  element: HTMLDivElement,
  content: NoteContent,
  resolveAssetUrl: AssetUrlResolver,
): void => {
  if (content.kind === 'image') {
    element.dataset.noteContentKind = 'image';
    delete element.dataset.noteLink;
    element.title = content.alt;
    // null while the asset is still loading; a later sync fills in the src.
    const url = resolveAssetUrl(content.assetId);
    if (element.firstElementChild instanceof HTMLImageElement) {
      if (url && element.firstElementChild.src !== url) {
        element.firstElementChild.src = url;
      }
      element.firstElementChild.alt = content.alt;
      return;
    }

    element.textContent = '';
    const image = document.createElement('img');
    image.className = 'note-image';
    image.alt = content.alt;
    const applyAverageColor = (): void => {
      const color = averageImageColor(image);
      if (color) {
        element.style.setProperty('--dot-color', color);
      }
    };
    image.addEventListener('load', applyAverageColor);
    if (url) {
      image.src = url;
      if (image.complete) {
        applyAverageColor();
      }
    }
    element.appendChild(image);
    return;
  }

  const text = content.text;
  const isCoordinate = content.kind === 'coordinate-link';
  element.dataset.noteContentKind = isCoordinate ? 'coordinate' : 'text';
  if (isCoordinate) {
    delete element.dataset.noteLink;
  } else if (parseExternalLink(text)) {
    element.dataset.noteLink = 'external';
  } else {
    delete element.dataset.noteLink;
  }
  element.title = isCoordinate ? text.trim() : '';

  if (isCoordinate) {
    if (element.firstElementChild?.classList.contains('note-coordinate-icon')) {
      return;
    }

    element.textContent = '';
    element.insertAdjacentHTML('afterbegin', LAND_PLOT_ICON);
    return;
  }

  if (element.textContent !== text) {
    element.textContent = text;
  }
};

const averageImageColor = (image: HTMLImageElement): string | null => {
  if (image.naturalWidth === 0 || image.naturalHeight === 0) {
    return null;
  }

  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    return null;
  }

  try {
    // Downscaling to a single pixel lets the browser average the image for us.
    context.drawImage(image, 0, 0, 1, 1);
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
    return `rgb(${r}, ${g}, ${b})`;
  } catch {
    return null;
  }
};

const LAND_PLOT_ICON = `<svg class="note-coordinate-icon" aria-label="Coordinate" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 8 6-3-6-3v10"/><path d="m8 11.99-5.5 3.14a1 1 0 0 0 0 1.74l8.5 4.86a2 2 0 0 0 2 0l8.5-4.86a1 1 0 0 0 0-1.74L16 12"/><path d="m6.49 12.85 11.02 6.3"/><path d="M17.51 12.85 6.5 19.15"/></svg>`;
