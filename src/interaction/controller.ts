import type { ArrowSelection } from '../core/arrowSelection';
import type { EditingSession } from '../core/editingSession';
import type { SelectionState } from '../core/selectionState';
import { abs2 } from '../geometry/complex';
import { clampDisk, type DiskPoint } from '../geometry/disk';
import {
  applyTransform,
  type DiskTransform,
  identityTransform,
  invertTransform,
  transformFromPointPair,
} from '../geometry/mobius';
import type { AnchoredGrid } from '../grid/anchoredGrid';
import type { Arrow } from '../model/arrow';
import { applyWorldCommand, type NoteMoveSnapshot, type WorldCommand } from '../model/commands';
import { type HistoryState, WorldHistory } from '../model/history';
import { type Note, type NoteColor, noteColor, noteDisplayText } from '../model/note';
import { type NoteDraft, type ParsedNoteDraft, parseNoteDraft } from '../model/noteDraft';
import { HyperbolicWorldState } from '../model/worldState';
import { arrowHitTest, arrowMidpoint } from '../render/arrowGeometry';
import { type ArrowDraft, ArrowLayer } from '../render/arrowLayer';
import { GridRenderer } from '../render/gridRenderer';
import { NoteLayer } from '../render/noteLayer';
import {
  createViewportFromRect,
  fitDiskZoom,
  projectDiskPoint,
  type StageRect,
  screenToDisk,
  type Viewport,
} from '../render/viewport';

export type InteractionMode = 'pan' | 'edit' | 'move' | 'arrow';
type PointerMode =
  | 'idle'
  | 'editing'
  | 'pending-pan'
  | 'pan'
  | 'pending-item'
  | 'item-drag'
  | 'pan-from-item'
  | 'arrow-draw';

const ARROW_DEFAULT_COLOR: NoteColor = 'c1';

export type HyperbolicCanvasControllerOptions = Readonly<{
  stage: HTMLElement;
  canvas: HTMLCanvasElement;
  arrowCanvas: HTMLCanvasElement;
  notes: Note[];
  grid: AnchoredGrid;
  initialMode?: InteractionMode;
  onEditingSessionChange?: (session: EditingSession | null) => void;
  onSelectionChange?: (selection: SelectionState) => void;
  onArrowSelectionChange?: (selection: ArrowSelection | null) => void;
  onZoomStateChange?: (state: ZoomState) => void;
  onHistoryStateChange?: (state: HistoryState) => void;
}>;

export type ZoomState = Readonly<{
  zoom: number;
  minZoom: number;
}>;

export class HyperbolicCanvasController {
  private readonly gridRenderer: GridRenderer;
  private readonly noteLayer: NoteLayer;
  private readonly arrowLayer: ArrowLayer;
  private readonly world: HyperbolicWorldState;
  private readonly history = new WorldHistory();
  private interactionMode: InteractionMode;
  private zoom = 1;
  private minZoom = 0.5;
  private view: DiskTransform = identityTransform;
  private pointerMode: PointerMode = 'idle';
  private dragStartPoint: DiskPoint | null = null;
  private downPosition: DiskPoint | null = null;
  private didMove = false;
  private dragNoteId: string | null = null;
  private selectedNoteId: string | null = null;
  private hoveredNoteId: string | null = null;
  private draggingNoteId: string | null = null;
  private dragMoveBefore: NoteMoveSnapshot | null = null;
  private editingNoteId: string | null = null;
  private editingVisible = false;
  private pendingNoteId: string | null = null;
  private nextNoteId: number;
  private nextArrowId = 0;
  private arrowFrom: DiskPoint | null = null;
  private draftArrowTo: DiskPoint | null = null;
  private pendingArrowHitId: string | null = null;
  private selectedArrowId: string | null = null;
  private flying = false;
  private rafId: number | null = null;
  private started = false;
  // Cached layout/style; see refreshViewMetrics.
  private stageRect: StageRect | null = null;
  private gridColor = '#888';
  private surfaceColor = '#ffffff';
  private arrowColors: Record<NoteColor, string> = {
    c1: '#3157a3',
    c2: '#0b6b4f',
    c3: '#9a4d00',
    c4: '#8a3a5b',
  };
  private readonly disposers: (() => void)[] = [];

  constructor(private readonly options: HyperbolicCanvasControllerOptions) {
    this.gridRenderer = new GridRenderer(options.canvas);
    this.noteLayer = new NoteLayer(options.stage);
    this.arrowLayer = new ArrowLayer(options.arrowCanvas);
    this.world = new HyperbolicWorldState(options.notes, options.grid);
    this.interactionMode = options.initialMode ?? 'pan';
    this.nextNoteId = options.notes.length;
  }

  start(): void {
    if (this.started) {
      return;
    }

    this.started = true;
    this.refreshViewMetrics();
    this.noteLayer.sync(this.world.notes);
    this.bindPointerEvents();
    this.bindResize();
    this.initZoom();
    this.emitSelection();
    this.emitHistoryState();
    this.requestRender();
  }

  dispose(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    while (this.disposers.length > 0) {
      this.disposers.pop()?.();
    }

    this.noteLayer.dispose();
    this.arrowLayer.dispose();
    this.gridRenderer.dispose();
    this.options.stage.classList.remove('dragging', 'item-drag', 'near-snap');
    this.options.onEditingSessionChange?.(null);
    this.options.onArrowSelectionChange?.(null);
    this.emitSelection();
    this.started = false;
  }

  commitEditingDraft(draft: NoteDraft): void {
    if (!this.editingNoteId) {
      return;
    }

    const isPending = this.editingNoteId === this.pendingNoteId;

    const parsed = parseNoteDraft(draft);
    if (!parsed.ok) {
      if (isPending) {
        this.discardPendingNote();
        this.finishEditingSession();
      }
      return;
    }

    if (isPending) {
      this.commitPendingNote(parsed.value);
    } else {
      this.applyCommand({
        type: 'update-note',
        noteId: this.editingNoteId,
        content: parsed.value.content,
        appearance: parsed.value.appearance,
        updatedAt: Date.now(),
      });
    }
    this.finishEditingSession();
  }

  cancelEditing(): void {
    if (!this.editingNoteId) {
      return;
    }

    if (this.editingNoteId === this.pendingNoteId) {
      this.discardPendingNote();
    }
    this.finishEditingSession();
  }

  deleteEditingNote(): void {
    if (!this.editingNoteId) {
      return;
    }

    if (this.editingNoteId === this.pendingNoteId) {
      this.discardPendingNote();
      this.finishEditingSession();
      return;
    }

    this.applyCommand({
      type: 'delete-note',
      noteId: this.editingNoteId,
    });
    this.selectedNoteId = null;

    this.finishEditingSession();
  }

  editSelectedNote(): void {
    const note = this.selectedNote();
    if (!note) {
      return;
    }

    this.startEdit(note);
  }

  centerSelectedNote(): void {
    const note = this.selectedNote();
    if (!note) {
      return;
    }

    this.flyTo(note.position);
  }

  deleteSelectedNote(): void {
    if (!this.selectedNoteId) {
      return;
    }

    this.applyCommand({
      type: 'delete-note',
      noteId: this.selectedNoteId,
    });
    this.selectedNoteId = null;
    this.emitSelection();
    this.requestRender();
  }

  setSelectedNoteColor(color: NoteColor): void {
    const note = this.selectedNote();
    if (!note) {
      return;
    }

    this.applyCommand({
      type: 'update-note',
      noteId: note.id,
      content: note.content,
      appearance: {
        color,
      },
      updatedAt: Date.now(),
    });
    this.emitSelection();
    this.requestRender();
  }

  undo(): void {
    if (this.editingNoteId) {
      this.cancelEditing();
    }

    if (!this.history.undo(this.world)) {
      return;
    }

    this.afterHistoryChange();
  }

  redo(): void {
    if (this.editingNoteId) {
      this.cancelEditing();
    }

    if (!this.history.redo(this.world)) {
      return;
    }

    this.afterHistoryChange();
  }

  setInteractionMode(mode: InteractionMode): void {
    if (this.editingNoteId) {
      this.cancelEditing();
    }

    this.cancelArrowGesture();
    this.clearArrowSelection();
    this.interactionMode = mode;
    this.options.stage.classList.remove('near-snap');
  }

  setZoom(zoom: number): void {
    this.zoom = Math.max(zoom, this.minZoom);
    this.emitZoomState();
    this.requestRender();
  }

  resetView(): void {
    if (this.editingNoteId) {
      this.cancelEditing();
    }

    this.flyTo(this.world.home);
  }

  private initZoom(): void {
    const zoom = this.fitZoom();
    this.zoom = zoom;
    this.minZoom = zoom;
    this.emitZoomState();
  }

  private fitZoom(): number {
    const rect = this.options.stage.getBoundingClientRect();
    return fitDiskZoom(rect.width, rect.height);
  }

  // Read layout/style once and cache. getBoundingClientRect and getComputedStyle
  // both force the browser to flush pending work, so calling them every frame
  // during a pan thrashes layout against the DOM writes in NoteLayer.render.
  private refreshViewMetrics(): void {
    const rect = this.options.stage.getBoundingClientRect();
    this.stageRect = {
      width: rect.width,
      height: rect.height,
      left: rect.left,
      top: rect.top,
    };
    const style = getComputedStyle(this.options.stage);
    this.gridColor = style.getPropertyValue('--grid').trim() || '#888';
    this.surfaceColor = style.getPropertyValue('--surface-elevated').trim() || this.surfaceColor;
    this.arrowColors = {
      c1: style.getPropertyValue('--c1').trim() || this.arrowColors.c1,
      c2: style.getPropertyValue('--c2').trim() || this.arrowColors.c2,
      c3: style.getPropertyValue('--c3').trim() || this.arrowColors.c3,
      c4: style.getPropertyValue('--c4').trim() || this.arrowColors.c4,
    };
  }

  private viewport(): Viewport {
    if (!this.stageRect) {
      this.refreshViewMetrics();
    }
    return createViewportFromRect(this.stageRect as StageRect, this.zoom);
  }

  private emitZoomState(): void {
    this.options.onZoomStateChange?.({
      zoom: this.zoom,
      minZoom: this.minZoom,
    });
  }

  private updateMinimumZoom(): void {
    const minZoom = this.fitZoom();
    const wasAtMinimum = Math.abs(this.zoom - this.minZoom) < 1e-6;
    this.minZoom = minZoom;

    if (wasAtMinimum || this.zoom < minZoom) {
      this.zoom = minZoom;
    }

    this.emitZoomState();
  }

  private bindPointerEvents(): void {
    this.listen<PointerEvent>(this.options.stage, 'pointerdown', (event) =>
      this.onPointerDown(event),
    );
    this.listen<PointerEvent>(this.options.stage, 'pointermove', (event) =>
      this.onPointerMove(event),
    );
    this.listen(this.options.stage, 'pointerup', () => this.endPointer());
    this.listen(this.options.stage, 'pointercancel', () => this.endPointer());
    this.listen(this.options.stage, 'pointerleave', () => {
      this.options.stage.classList.remove('near-snap');
    });
  }

  private bindResize(): void {
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => {
        this.refreshViewMetrics();
        this.updateMinimumZoom();
        this.requestRender();
      });
      observer.observe(this.options.stage);
      this.disposers.push(() => observer.disconnect());
    }
    this.listen(window, 'resize', () => {
      this.refreshViewMetrics();
      this.updateMinimumZoom();
      this.requestRender();
    });
  }

  private listen<TEvent extends Event>(
    target: EventTarget,
    type: string,
    listener: (event: TEvent) => void,
  ): void {
    const eventListener = (event: Event): void => {
      listener(event as TEvent);
    };

    target.addEventListener(type, eventListener);
    this.disposers.push(() => target.removeEventListener(type, eventListener));
  }

  private onPointerDown(event: PointerEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    if (
      target?.closest(
        [
          '[data-testid="note-editor"]',
          '[data-testid="arrow-inspector"]',
          '[data-testid="inspector"]',
          '[data-testid="history-controls"]',
          '[data-testid="mode-controls"]',
          '[data-testid="zoom-controls"]',
        ].join(', '),
      )
    ) {
      return;
    }

    if (this.pointerMode === 'editing') {
      this.cancelEditing();
      event.preventDefault();
      return;
    }

    if (this.flying) {
      return;
    }

    // Picks up scrolling / theme changes between gestures without per-frame reads.
    this.refreshViewMetrics();
    const viewport = this.viewport();

    if (this.interactionMode === 'arrow') {
      this.beginArrowGesture(event, viewport);
      return;
    }

    const noteId = this.noteLayer.getNoteIdFromEventTarget(event.target);
    if (noteId) {
      this.selectNote(noteId);
    }
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
      this.updateHoveredNote(event.target);
      if (this.interactionMode === 'edit' || this.interactionMode === 'arrow') {
        this.updateSnapCursor(event.clientX, event.clientY);
      }
      return;
    }
    if (this.pointerMode === 'editing' || this.flying) {
      return;
    }

    if (this.pointerMode === 'arrow-draw') {
      this.updateArrowDraft(event);
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

    const viewport = this.viewport();
    const z = clampDisk(screenToDisk(event.clientX, event.clientY, viewport));
    this.view = transformFromPointPair(this.dragStartPoint, z);
    this.reanchorIfNeeded();
  }

  private reanchorIfNeeded(): void {
    const viewCenter = applyTransform(invertTransform(this.view), [0, 0]);
    if (abs2(viewCenter) < 0.49) {
      return;
    }

    const { transientPoints = [] } = applyWorldCommand(this.world, {
      type: 'reanchor-world',
      transform: this.view,
      transientPoints: [this.dragStartPoint],
    });
    const [dragStartPoint = null] = transientPoints;
    this.dragStartPoint = dragStartPoint;
    this.view = identityTransform;
  }

  private dragItemToPointer(event: PointerEvent): void {
    if (!this.dragNoteId) {
      return;
    }

    if (this.pointerMode !== 'item-drag') {
      this.pointerMode = 'item-drag';
      this.draggingNoteId = this.dragNoteId;
      this.dragMoveBefore = this.currentMoveSnapshot(this.dragNoteId);
      this.emitSelection();
      this.options.stage.classList.add('item-drag');
    }

    const viewport = this.viewport();
    const snappedGridPoint = this.world.grid.snapScreenPoint(
      event.clientX,
      event.clientY,
      this.view,
      viewport,
    );
    if (snappedGridPoint) {
      this.applyCommand(
        {
          type: 'move-note',
          noteId: this.dragNoteId,
          position: snappedGridPoint.point,
          updatedAt: Date.now(),
        },
        { recordHistory: false },
      );
    }
  }

  private currentMoveSnapshot(noteId: string | null): NoteMoveSnapshot | null {
    if (!noteId) {
      return null;
    }

    const note = this.world.notes.find((candidate) => candidate.id === noteId);
    if (!note) {
      return null;
    }

    return {
      position: note.position,
      updatedAt: note.updatedAt,
    };
  }

  private recordFinishedMove(): void {
    if (!this.dragNoteId || !this.dragMoveBefore) {
      return;
    }

    const after = this.currentMoveSnapshot(this.dragNoteId);
    if (!after || diskPointsAlmostEqual(this.dragMoveBefore.position, after.position)) {
      return;
    }

    this.history.record({
      type: 'move-note',
      noteId: this.dragNoteId,
      before: this.dragMoveBefore,
      after,
    });
    this.emitHistoryState();
  }

  private resetDragState(): void {
    this.dragStartPoint = null;
    this.dragNoteId = null;
    this.draggingNoteId = null;
    this.dragMoveBefore = null;
    this.emitSelection();
  }

  private applyCommand(
    command: WorldCommand,
    options: Readonly<{ recordHistory?: boolean }> = {},
  ): void {
    const result = applyWorldCommand(this.world, command);
    if (options.recordHistory !== false && result.patch) {
      this.history.record(result.patch);
      this.emitHistoryState();
    }

    this.noteLayer.sync(this.world.notes);
  }

  private afterHistoryChange(): void {
    this.noteLayer.sync(this.world.notes);
    if (this.selectedNoteId && !this.selectedNote()) {
      this.selectedNoteId = null;
    }
    if (this.selectedArrowId && !this.selectedArrow()) {
      this.selectedArrowId = null;
    }
    this.emitSelection();
    // Arrow selection may have been invalidated by undo/redo; re-emit so the
    // inspector UI stays in sync.
    this.emitArrowSelection(this.viewport());
    this.emitHistoryState();
    this.requestRender();
  }

  private selectedNote(): Note | null {
    if (!this.selectedNoteId) {
      return null;
    }

    return this.world.notes.find((candidate) => candidate.id === this.selectedNoteId) ?? null;
  }

  private selectNote(noteId: string | null): void {
    this.selectedNoteId = noteId;
    // Arrow and note selections are mutually exclusive—only one inspector
    // should be visible at a time.
    if (noteId !== null && this.selectedArrowId !== null) {
      this.selectedArrowId = null;
      this.options.onArrowSelectionChange?.(null);
    }
    this.emitSelection();
  }

  private updateHoveredNote(target: EventTarget | null): void {
    const nextHoveredNoteId = this.noteLayer.getNoteIdFromEventTarget(target);
    if (nextHoveredNoteId === this.hoveredNoteId) {
      return;
    }

    this.hoveredNoteId = nextHoveredNoteId;
    this.emitSelection();
  }

  private emitSelection(): void {
    const selectedNote = this.selectedNote();
    this.options.onSelectionChange?.({
      selectedNoteId: selectedNote?.id ?? null,
      hoveredNoteId: this.hoveredNoteId,
      editingNoteId: this.editingNoteId,
      draggingNoteId: this.draggingNoteId,
      selectedNote: selectedNote
        ? {
            id: selectedNote.id,
            text: noteDisplayText(selectedNote),
            color: noteColor(selectedNote),
          }
        : null,
    });
  }

  private emitHistoryState(): void {
    this.options.onHistoryStateChange?.(this.history.state);
  }

  private endPointer(): void {
    if (this.pointerMode === 'idle' || this.pointerMode === 'editing' || this.flying) {
      return;
    }

    const endedPointerMode = this.pointerMode;
    this.options.stage.classList.remove('dragging', 'item-drag');

    if (endedPointerMode === 'arrow-draw') {
      this.finishArrowGesture();
      this.pointerMode = 'idle';
      this.requestRender();
      return;
    }

    if (!this.didMove) {
      if (this.pointerMode === 'pending-pan' && this.dragStartPoint) {
        if (this.interactionMode === 'edit' && this.downPosition) {
          const viewport = this.viewport();
          const snapped = this.world.grid.snapScreenPoint(
            this.downPosition[0],
            this.downPosition[1],
            this.view,
            viewport,
          );
          if (snapped) {
            const existing = this.world.notes.find((n) =>
              diskPointsAlmostEqual(n.position, snapped.point),
            );
            const target = existing ?? this.createNote(snapped.point);
            this.selectNote(target.id);
            this.startEdit(target);
            this.resetDragState();
            return;
          }
        }
        this.selectNote(null);
        this.flyTo(this.dragStartPoint);
      } else if (this.pointerMode === 'pending-item' && this.dragNoteId) {
        const note = this.world.notes.find((candidate) => candidate.id === this.dragNoteId);
        if (note) {
          if (this.interactionMode === 'edit') {
            this.startEdit(note);
            this.resetDragState();
            return;
          }
        }
      }
    }

    if (endedPointerMode === 'item-drag') {
      this.recordFinishedMove();
    }

    this.pointerMode = 'idle';
    this.resetDragState();
    this.requestRender();
  }

  private commitPendingNote(parsed: ParsedNoteDraft): void {
    const noteId = this.pendingNoteId;
    this.pendingNoteId = null;
    if (!noteId) {
      return;
    }

    const note = this.world.notes.find((candidate) => candidate.id === noteId);
    if (!note) {
      return;
    }

    note.content = parsed.content;
    note.appearance = parsed.appearance;
    note.updatedAt = Date.now();

    this.applyCommand({ type: 'delete-note', noteId }, { recordHistory: false });
    this.applyCommand({ type: 'create-note', note });
  }

  private discardPendingNote(): void {
    const noteId = this.pendingNoteId;
    this.pendingNoteId = null;
    if (!noteId) {
      return;
    }

    this.applyCommand({ type: 'delete-note', noteId }, { recordHistory: false });
    if (this.selectedNoteId === noteId) {
      this.selectedNoteId = null;
    }
  }

  private startEdit(note: Note): void {
    if (this.pendingNoteId && this.pendingNoteId !== note.id) {
      this.discardPendingNote();
    }
    this.selectedNoteId = note.id;
    this.pointerMode = 'editing';
    this.editingNoteId = note.id;
    this.editingVisible = false;
    this.options.onEditingSessionChange?.(null);
    this.emitSelection();
    this.flyTo(note.position, 380, () => {
      if (this.editingNoteId !== note.id) {
        return;
      }

      this.editingVisible = true;
      this.render();
    });
  }

  private finishEditingSession(): void {
    if (this.pendingNoteId && this.pendingNoteId === this.editingNoteId) {
      this.discardPendingNote();
    }
    this.editingNoteId = null;
    this.editingVisible = false;
    this.pointerMode = 'idle';
    this.options.onEditingSessionChange?.(null);
    this.emitSelection();
    this.requestRender();
  }

  private emitEditingSession(viewport: Viewport): void {
    if (!this.options.onEditingSessionChange) {
      return;
    }

    if (!this.editingNoteId || !this.editingVisible) {
      this.options.onEditingSessionChange(null);
      return;
    }

    const note = this.world.notes.find((candidate) => candidate.id === this.editingNoteId);
    if (!note) {
      this.options.onEditingSessionChange(null);
      return;
    }

    const transformed = applyTransform(this.view, note.position);
    const projected = projectDiskPoint(transformed, viewport);
    this.options.onEditingSessionChange({
      noteId: note.id,
      anchor: note.position,
      draft: {
        text: noteDisplayText(note),
        color: noteColor(note),
      },
      screenPosition: {
        x: projected.x,
        y: projected.y,
      },
    });
  }

  private updateSnapCursor(clientX: number, clientY: number): void {
    const viewport = this.viewport();
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

  private beginArrowGesture(event: PointerEvent, viewport: Viewport): void {
    this.downPosition = [event.clientX, event.clientY];
    this.didMove = false;

    const snapped = this.world.grid.snapScreenPoint(
      event.clientX,
      event.clientY,
      this.view,
      viewport,
    );
    this.arrowFrom = snapped ? snapped.point : null;
    this.draftArrowTo = this.arrowFrom;
    this.pendingArrowHitId = arrowHitTest(
      this.world.arrows,
      this.view,
      viewport,
      event.clientX - viewport.left,
      event.clientY - viewport.top,
    );

    this.pointerMode = 'arrow-draw';
    this.options.stage.setPointerCapture(event.pointerId);
    this.options.stage.classList.remove('near-snap');
    this.requestRender();
  }

  private updateArrowDraft(event: PointerEvent): void {
    if (this.downPosition && !this.didMove) {
      const dx = event.clientX - this.downPosition[0];
      const dy = event.clientY - this.downPosition[1];
      if (dx * dx + dy * dy > 16) {
        this.didMove = true;
      }
    }

    const viewport = this.viewport();
    const snapped = this.world.grid.snapScreenPoint(
      event.clientX,
      event.clientY,
      this.view,
      viewport,
    );
    if (snapped) {
      this.draftArrowTo = snapped.point;
    }
    this.updateSnapCursor(event.clientX, event.clientY);
    this.requestRender();
  }

  // A drag between two distinct grid points draws an arrow; a click (no drag)
  // selects the arrow under the pointer, or clears the selection on empty space.
  private finishArrowGesture(): void {
    this.options.stage.classList.remove('dragging');
    const from = this.arrowFrom;
    const to = this.draftArrowTo;
    const hitId = this.pendingArrowHitId;
    const moved = this.didMove;
    this.arrowFrom = null;
    this.draftArrowTo = null;
    this.pendingArrowHitId = null;

    if (!moved) {
      this.selectArrow(hitId);
      return;
    }

    if (from && to && !diskPointsAlmostEqual(from, to)) {
      this.createArrow(from, to);
    }
  }

  private cancelArrowGesture(): void {
    if (this.pointerMode === 'arrow-draw') {
      this.pointerMode = 'idle';
      this.options.stage.classList.remove('dragging');
    }
    this.arrowFrom = null;
    this.draftArrowTo = null;
    this.pendingArrowHitId = null;
  }

  private createArrow(from: DiskPoint, to: DiskPoint): void {
    const now = Date.now();
    const arrow: Arrow = {
      id: `arrow-${this.nextArrowId++}`,
      from,
      to,
      label: '',
      appearance: {
        color: ARROW_DEFAULT_COLOR,
      },
      createdAt: now,
      updatedAt: now,
    };
    this.applyCommand({ type: 'create-arrow', arrow });
    // Select the fresh arrow so its inspector is one gesture away for labelling.
    this.selectArrow(arrow.id);
  }

  private selectedArrow(): Arrow | null {
    if (!this.selectedArrowId) {
      return null;
    }
    return this.world.arrows.find((candidate) => candidate.id === this.selectedArrowId) ?? null;
  }

  private selectArrow(arrowId: string | null): void {
    this.selectedArrowId = arrowId;
    // Arrow and note selections are mutually exclusive.
    if (arrowId !== null && this.selectedNoteId !== null) {
      this.selectedNoteId = null;
      this.emitSelection();
    }
    this.emitArrowSelection(this.viewport());
    this.requestRender();
  }

  private clearArrowSelection(): void {
    if (this.selectedArrowId === null) {
      return;
    }
    this.selectedArrowId = null;
    this.options.onArrowSelectionChange?.(null);
    this.requestRender();
  }

  deleteSelectedArrow(): void {
    if (!this.selectedArrowId) {
      return;
    }
    this.applyCommand({ type: 'delete-arrow', arrowId: this.selectedArrowId });
    this.selectedArrowId = null;
    this.options.onArrowSelectionChange?.(null);
    this.requestRender();
  }

  setSelectedArrowColor(color: NoteColor): void {
    const arrow = this.selectedArrow();
    if (!arrow || arrow.appearance.color === color) {
      return;
    }
    this.applyCommand({
      type: 'update-arrow',
      arrowId: arrow.id,
      label: arrow.label,
      appearance: { color },
      updatedAt: Date.now(),
    });
    this.requestRender();
  }

  commitSelectedArrowLabel(label: string): void {
    const arrow = this.selectedArrow();
    if (!arrow || arrow.label === label) {
      return;
    }
    this.applyCommand({
      type: 'update-arrow',
      arrowId: arrow.id,
      label,
      appearance: arrow.appearance,
      updatedAt: Date.now(),
    });
    this.requestRender();
  }

  private createNote(position: DiskPoint): Note {
    const now = Date.now();
    const note: Note = {
      id: `note-${this.nextNoteId++}`,
      position,
      content: {
        kind: 'plain-text',
        text: '',
      },
      appearance: {
        color: 'c1',
      },
      createdAt: now,
      updatedAt: now,
    };
    this.applyCommand(
      {
        type: 'create-note',
        note,
      },
      { recordHistory: false },
    );
    this.pendingNoteId = note.id;
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
      const eased = 1 - (1 - t) ** 3;
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

  private emitArrowSelection(viewport: Viewport): void {
    if (!this.options.onArrowSelectionChange) {
      return;
    }

    const arrow = this.selectedArrow();
    if (!arrow) {
      this.options.onArrowSelectionChange(null);
      return;
    }

    const midpoint = arrowMidpoint(arrow.from, arrow.to, this.view, viewport);
    this.options.onArrowSelectionChange({
      arrowId: arrow.id,
      label: arrow.label,
      color: arrow.appearance.color,
      screenPosition: {
        x: midpoint.x,
        y: midpoint.y,
      },
    });
  }

  private arrowDraft(): ArrowDraft | null {
    if (this.pointerMode !== 'arrow-draw' || !this.arrowFrom || !this.draftArrowTo) {
      return null;
    }
    if (diskPointsAlmostEqual(this.arrowFrom, this.draftArrowTo)) {
      return null;
    }
    return {
      from: this.arrowFrom,
      to: this.draftArrowTo,
      color: ARROW_DEFAULT_COLOR,
    };
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
    const viewport = this.viewport();

    this.gridRenderer.draw(this.world.grid, this.view, viewport, this.gridColor);
    this.arrowLayer.draw(
      this.world.arrows,
      this.view,
      viewport,
      (color) => this.arrowColors[color],
      this.arrowDraft(),
      {
        selectedArrowId: this.selectedArrowId,
        labelHalo: this.surfaceColor,
      },
    );

    this.noteLayer.render(
      this.world.notes,
      this.view,
      viewport,
      this.editingVisible ? this.editingNoteId : null,
      this.selectedNoteId,
    );
    this.emitEditingSession(viewport);
  }
}

const diskPointsAlmostEqual = (a: DiskPoint, b: DiskPoint): boolean => {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy < 1e-18;
};
