import { abs2 } from '../geometry/complex';
import { clampDisk, type DiskPoint } from '../geometry/disk';
import {
  applyTransform,
  identityTransform,
  invertTransform,
  transformFromPointPair,
  type DiskTransform,
} from '../geometry/mobius';
import type { AnchoredGrid } from '../grid/anchoredGrid';
import type { Note } from '../model/note';
import { HyperbolicWorldState } from '../model/worldState';
import { GridRenderer } from '../render/gridRenderer';
import { NoteLayer } from '../render/noteLayer';
import { createViewport, projectDiskPoint, screenToDisk } from '../render/viewport';

type InteractionMode = 'pan' | 'edit' | 'move';
type PointerMode = 'idle' | 'editing' | 'pending-pan' | 'pan' | 'pending-item' | 'item-drag' | 'pan-from-item';

export type HyperbolicCanvasControllerOptions = Readonly<{
  stage: HTMLElement;
  canvas: HTMLCanvasElement;
  notes: Note[];
  grid: AnchoredGrid;
  zoomInput: HTMLInputElement;
  zoomValueElement: HTMLElement;
  resetButton: HTMLButtonElement;
}>;

export class HyperbolicCanvasController {
  private readonly gridRenderer: GridRenderer;
  private readonly noteLayer: NoteLayer;
  private readonly world: HyperbolicWorldState;
  private interactionMode: InteractionMode = 'pan';
  private zoom = 1;
  private view: DiskTransform = identityTransform;
  private pointerMode: PointerMode = 'idle';
  private dragStartPoint: DiskPoint | null = null;
  private downPosition: DiskPoint | null = null;
  private didMove = false;
  private dragNoteId: string | null = null;
  private editingNoteId: string | null = null;
  private nextNoteId: number;
  private flying = false;
  private rafId: number | null = null;

  constructor(private readonly options: HyperbolicCanvasControllerOptions) {
    this.gridRenderer = new GridRenderer(options.canvas);
    this.noteLayer = new NoteLayer(options.stage);
    this.world = new HyperbolicWorldState(options.notes, options.grid);
    this.nextNoteId = options.notes.length;
  }

  start(): void {
    this.noteLayer.sync(this.world.notes);
    this.bindPointerEvents();
    this.bindControls();
    this.bindResize();
    this.initZoom();
    requestAnimationFrame(() => this.render());
  }

  private initZoom(): void {
    const zoom = this.fitZoom();
    this.zoom = zoom;
    this.options.zoomInput.min = String(zoom);
    this.options.zoomInput.value = String(zoom);
    this.options.zoomValueElement.textContent = `${zoom.toFixed(1)}×`;
  }

  private fitZoom(): number {
    const rect = this.options.stage.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    return Math.min(cx, cy) / Math.sqrt(cx * cx + cy * cy);
  }

  private bindPointerEvents(): void {
    this.options.stage.addEventListener('pointerdown', (event) => this.onPointerDown(event));
    this.options.stage.addEventListener('pointermove', (event) => this.onPointerMove(event));
    this.options.stage.addEventListener('pointerup', () => this.endPointer());
    this.options.stage.addEventListener('pointercancel', () => this.endPointer());
    this.options.stage.addEventListener('pointerleave', () => {
      this.options.stage.classList.remove('near-snap');
    });

    document.addEventListener('keydown', (event) => {
      if (this.pointerMode === 'editing' && (event.key === 'Enter' || event.key === 'Escape')) {
        event.preventDefault();
        this.endEdit();
      }
    });
  }

  private bindControls(): void {
    const modeButtons = this.options.stage.querySelectorAll<HTMLButtonElement>('.mode-buttons button');
    modeButtons.forEach((button) => {
      button.addEventListener('click', () => {
        if (this.editingNoteId) {
          this.endEdit();
        }

        const mode = button.dataset.mode;
        if (!isInteractionMode(mode)) {
          return;
        }

        this.interactionMode = mode;
        modeButtons.forEach((candidate) => candidate.classList.toggle('active', candidate === button));
        this.options.stage.classList.remove('mode-pan', 'mode-edit', 'mode-move', 'near-snap');
        this.options.stage.classList.add(`mode-${this.interactionMode}`);
      });
    });

    this.options.zoomInput.addEventListener('input', () => {
      this.zoom = Number.parseFloat(this.options.zoomInput.value);
      this.options.zoomValueElement.textContent = `${this.zoom.toFixed(1)}×`;
      this.requestRender();
    });

    this.options.resetButton.addEventListener('click', () => {
      if (this.editingNoteId) {
        this.endEdit();
      }
      this.flyTo(this.world.home);
    });
  }

  private bindResize(): void {
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => this.requestRender()).observe(this.options.stage);
    }
    window.addEventListener('resize', () => this.requestRender());
  }

  private onPointerDown(event: PointerEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('.mode-buttons, .zoom-control')) {
      return;
    }

    if (this.pointerMode === 'editing') {
      const targetNoteId = this.noteLayer.getNoteIdFromEventTarget(event.target);
      if (targetNoteId === this.editingNoteId) {
        return;
      }
      this.endEdit();
      event.preventDefault();
      return;
    }

    if (this.flying) {
      return;
    }

    const viewport = createViewport(this.options.stage, this.zoom);
    const noteId = this.noteLayer.getNoteIdFromEventTarget(event.target);
    this.downPosition = [event.clientX, event.clientY];
    this.didMove = false;
    const z = clampDisk(screenToDisk(event.clientX, event.clientY, viewport));
    this.dragStartPoint = applyTransform(invertTransform(this.view), z);

    if (noteId) {
      this.pointerMode = 'pending-item';
      this.dragNoteId = noteId;
    } else {
      this.pointerMode = 'pending-pan';
    }

    this.options.stage.setPointerCapture(event.pointerId);
    this.options.stage.classList.add('dragging');
    this.options.stage.classList.remove('near-snap');
  }

  private onPointerMove(event: PointerEvent): void {
    if (this.pointerMode === 'idle') {
      if (this.interactionMode === 'edit') {
        this.updateSnapCursor(event.clientX, event.clientY);
      }
      return;
    }
    if (this.pointerMode === 'editing' || this.flying) {
      return;
    }

    if (!this.downPosition || !this.dragStartPoint) {
      return;
    }

    if (!this.didMove) {
      const dx = event.clientX - this.downPosition[0];
      const dy = event.clientY - this.downPosition[1];
      if (dx * dx + dy * dy > 16) {
        this.didMove = true;
      } else {
        return;
      }
    }

    if (this.pointerMode === 'pending-pan' || this.pointerMode === 'pan') {
      this.pointerMode = 'pan';
      this.panToPointer(event);
    } else if (
      this.pointerMode === 'pending-item' ||
      this.pointerMode === 'item-drag' ||
      this.pointerMode === 'pan-from-item'
    ) {
      if (this.interactionMode === 'move') {
        this.dragItemToPointer(event);
      } else {
        this.pointerMode = 'pan-from-item';
        this.panToPointer(event);
      }
    }

    this.requestRender();
  }

  private panToPointer(event: PointerEvent): void {
    if (!this.dragStartPoint) {
      return;
    }

    const viewport = createViewport(this.options.stage, this.zoom);
    const z = clampDisk(screenToDisk(event.clientX, event.clientY, viewport));
    this.view = transformFromPointPair(this.dragStartPoint, z);
    this.reanchorIfNeeded();
  }

  private reanchorIfNeeded(): void {
    const viewCenter = applyTransform(invertTransform(this.view), [0, 0]);
    if (abs2(viewCenter) < 0.49) {
      return;
    }

    const [dragStartPoint = null] = this.world.reanchor(this.view, [this.dragStartPoint]);
    this.dragStartPoint = dragStartPoint;
    this.view = identityTransform;
  }

  private dragItemToPointer(event: PointerEvent): void {
    if (!this.dragNoteId) {
      return;
    }

    if (this.pointerMode !== 'item-drag') {
      this.pointerMode = 'item-drag';
      this.options.stage.classList.add('item-drag');
    }

    const viewport = createViewport(this.options.stage, this.zoom);
    const snappedGridPoint = this.world.grid.snapScreenPoint(
      event.clientX,
      event.clientY,
      this.view,
      viewport,
    );
    const note = this.world.notes.find((candidate) => candidate.id === this.dragNoteId);

    if (snappedGridPoint && note) {
      note.position = snappedGridPoint.point;
      note.updatedAt = Date.now();
    }
  }

  private endPointer(): void {
    if (this.pointerMode === 'idle' || this.pointerMode === 'editing' || this.flying) {
      return;
    }

    this.options.stage.classList.remove('dragging', 'item-drag');

    if (!this.didMove) {
      if (this.pointerMode === 'pending-pan' && this.dragStartPoint) {
        if (this.interactionMode === 'edit' && this.downPosition) {
          const viewport = createViewport(this.options.stage, this.zoom);
          const snapped = this.world.grid.snapScreenPoint(
            this.downPosition[0],
            this.downPosition[1],
            this.view,
            viewport,
          );
          if (snapped) {
            const existing = this.world.notes.find(
              (n) => diskPointsAlmostEqual(n.position, snapped.point),
            );
            const target = existing ?? this.createNote(snapped.point);
            this.startEdit(target);
            this.dragStartPoint = null;
            return;
          }
        }
        this.flyTo(this.dragStartPoint);
      } else if (this.pointerMode === 'pending-item' && this.dragNoteId) {
        const note = this.world.notes.find((candidate) => candidate.id === this.dragNoteId);
        if (note) {
          if (this.interactionMode === 'edit') {
            this.startEdit(note);
            this.dragStartPoint = null;
            this.dragNoteId = null;
            return;
          }
          this.flyTo(note.position);
        }
      }
    }

    this.pointerMode = 'idle';
    this.dragStartPoint = null;
    this.dragNoteId = null;
    this.requestRender();
  }

  private startEdit(note: Note): void {
    this.pointerMode = 'editing';
    this.editingNoteId = note.id;
    this.flyTo(note.position, 380, () => {
      const element = this.noteLayer.getElement(note.id);
      if (!element) {
        return;
      }

      element.contentEditable = 'plaintext-only';
      element.classList.remove('as-dot', 'as-pill-h', 'as-pill-v');
      element.classList.add('editing');
      this.render();
      element.focus();

      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
  }

  private endEdit(): void {
    if (!this.editingNoteId) {
      return;
    }

    const note = this.world.notes.find((candidate) => candidate.id === this.editingNoteId);
    const element = this.noteLayer.getElement(this.editingNoteId);
    if (element && note) {
      const nextText = element.textContent?.trim() || '·';
      note.text = nextText;
      note.updatedAt = Date.now();
      element.textContent = nextText;
      element.contentEditable = 'false';
      element.classList.remove('editing');
      element.blur();
    }

    this.editingNoteId = null;
    this.pointerMode = 'idle';
    this.requestRender();
  }

  private updateSnapCursor(clientX: number, clientY: number): void {
    const viewport = createViewport(this.options.stage, this.zoom);
    const snapped = this.world.grid.snapScreenPoint(clientX, clientY, this.view, viewport);
    let near = false;
    if (snapped) {
      const projected = projectDiskPoint(applyTransform(this.view, snapped.point), viewport);
      const dx = clientX - viewport.left - projected.x;
      const dy = clientY - viewport.top - projected.y;
      near = dx * dx + dy * dy < 24 * 24;
    }
    this.options.stage.classList.toggle('near-snap', near);
  }

  private createNote(position: DiskPoint): Note {
    const now = Date.now();
    const note: Note = {
      id: `note-${this.nextNoteId++}`,
      position,
      text: '',
      color: 'c1',
      createdAt: now,
      updatedAt: now,
    };
    this.world.notes.push(note);
    this.noteLayer.sync(this.world.notes);
    return note;
  }

  private flyTo(target: DiskPoint, ms = 450, onDone?: () => void): void {
    if (this.flying) {
      return;
    }

    const startView = this.view;
    const startPosition = applyTransform(startView, target);
    const startTime = performance.now();
    this.flying = true;

    const step = (): void => {
      const t = Math.min(1, (performance.now() - startTime) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      const position: DiskPoint = [startPosition[0] * (1 - eased), startPosition[1] * (1 - eased)];
      this.view = transformFromPointPair(target, position);
      this.render();

      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        this.flying = false;
        this.reanchorIfNeeded();
        this.render();
        onDone?.();
      }
    };

    requestAnimationFrame(step);
  }

  private requestRender(): void {
    if (this.rafId !== null) {
      return;
    }

    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.render();
    });
  }

  private render(): void {
    const viewport = createViewport(this.options.stage, this.zoom);
    const gridColor = getComputedStyle(this.options.stage).getPropertyValue('--grid').trim() || '#888';

    this.gridRenderer.draw(this.world.grid.tiling, this.view, viewport, gridColor);
    this.noteLayer.render(this.world.notes, this.view, viewport, this.editingNoteId);
  }
}

const isInteractionMode = (value: string | undefined): value is InteractionMode =>
  value === 'pan' || value === 'edit' || value === 'move';

const diskPointsAlmostEqual = (a: DiskPoint, b: DiskPoint): boolean => {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy < 1e-18;
};
