import { arrowNavigationTarget } from '../core/arrowNavigation';
import type { ArrowSelection } from '../core/arrowSelection';
import type { CoordinateTarget } from '../core/coordinateIndicator';
import type { EditingSession, ScreenPoint } from '../core/editingSession';
import type { SelectionState } from '../core/selectionState';
import { abs2 } from '../geometry/complex';
import { clampDisk, type DiskPoint } from '../geometry/disk';
import {
  applyTransform,
  composeTransforms,
  type DiskTransform,
  identityTransform,
  invertTransform,
  transformFromPointPair,
} from '../geometry/mobius';
import type { AnchoredGrid } from '../grid/anchoredGrid';
import { type GridAnchor, gridAnchorsEqual } from '../grid/tilingAddress';
import type { Arrow, ArrowHeadMode } from '../model/arrow';
import { AssetStore } from '../model/assetStore';
import { applyWorldCommand, type NoteMoveSnapshot, type WorldCommand } from '../model/commands';
import { type HistoryState, WorldHistory } from '../model/history';
import {
  type Note,
  type NoteColor,
  type NoteId,
  noteColor,
  noteCoordinateTarget,
  noteDisplayText,
  noteIsTextEditable,
} from '../model/note';
import { type NoteDraft, type ParsedNoteDraft, parseNoteDraft } from '../model/noteDraft';
import { parseExternalLink } from '../model/noteLink';
import { parseWorldFileText, stringifyWorldFile } from '../model/worldFile';
import { HyperbolicWorldState } from '../model/worldState';
import { type ArrowGeometry, arrowHitTest, arrowMidpoint } from '../render/arrowGeometry';
import { type ArrowDraft, ArrowLayer, type RenderedArrow } from '../render/arrowLayer';
import { GridRenderer } from '../render/gridRenderer';
import { NoteLayer, type RenderedNote } from '../render/noteLayer';
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
type GestureButton = 'primary' | 'middle';

const ARROW_DEFAULT_COLOR: NoteColor = 'c1';
const MAX_ZOOM = 6;
const WHEEL_ZOOM_STEP = 600;

type AnchoredPoint = Readonly<{
  anchor: GridAnchor;
  point: DiskPoint;
}>;

type FlyToOptions = Readonly<{
  ms?: number;
  onDone?: () => void;
  recordNavigation?: boolean;
  zoom?: number;
}>;

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
  onCoordinateTargetChange?: (target: CoordinateTarget | null) => void;
  onCoordinateNotePreviewChange?: (preview: CoordinateNotePreview | null) => void;
  onSelectedImageChange?: (toolbar: SelectedImageToolbar | null) => void;
  onZoomStateChange?: (state: ZoomState) => void;
  onHistoryStateChange?: (state: HistoryState) => void;
  onNavigationHistoryStateChange?: (state: NavigationHistoryState) => void;
  // Fired after any mutation to the persisted document (notes/arrows/charts), so
  // the host can save it. View-only changes (pan/zoom/selection) do not fire it.
  onChange?: () => void;
}>;

export type ZoomState = Readonly<{
  zoom: number;
  minZoom: number;
}>;

export type NavigationHistoryState = Readonly<{
  canGoBack: boolean;
  canGoForward: boolean;
}>;

export type CoordinateNotePreview = Readonly<{
  sourceNoteId: NoteId;
  targetNoteId: NoteId;
  text: string;
  color: NoteColor;
  screenPosition: ScreenPoint;
}>;

type CoordinateJumpPreview = Readonly<{
  source: Note;
  target: Note;
}>;

// Image notes can't be text-edited, so they get a small floating delete button
// in edit mode instead of the note editor. Anchored to the image's top-right
// corner in stage coordinates, re-emitted each render so it tracks pan/zoom.
export type SelectedImageToolbar = Readonly<{
  noteId: NoteId;
  screenPosition: ScreenPoint;
}>;

export class HyperbolicCanvasController {
  private readonly gridRenderer: GridRenderer;
  private readonly noteLayer: NoteLayer;
  private readonly arrowLayer: ArrowLayer;
  private readonly assets = new AssetStore();
  private readonly world: HyperbolicWorldState;
  private readonly history = new WorldHistory();
  private interactionMode: InteractionMode;
  private zoom = 1;
  private minZoom = 0.5;
  private view: DiskTransform = identityTransform;
  private pointerMode: PointerMode = 'idle';
  private gestureButton: GestureButton | null = null;
  private dragStartPoint: DiskPoint | null = null;
  private dragStartDisk: DiskPoint | null = null;
  private dragStartView: DiskTransform | null = null;
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
  private arrowFrom: AnchoredPoint | null = null;
  private draftArrowTo: AnchoredPoint | null = null;
  private pendingArrowHitId: string | null = null;
  private selectedArrowId: string | null = null;
  private hoveredArrowId: string | null = null;
  private readonly navigationBackStack: DiskPoint[] = [];
  private readonly navigationForwardStack: DiskPoint[] = [];
  private flying = false;
  private flyRafId: number | null = null;
  // Snaps the in-flight fly to its destination; set while a fly is running so it
  // can be settled (rather than dropped) when another navigation interrupts it.
  private flySettle: (() => void) | null = null;
  private rafId: number | null = null;
  private started = false;
  // Once disposed the instance is inert: async work that resolves later (image
  // hydration, world import) must not touch the DOM, or—under StrictMode's
  // mount/unmount/mount—an orphaned note element leaks onto the shared stage.
  private disposed = false;
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
  private readonly notePointCache = new Map<string, DiskPoint>();
  private readonly arrowGeometryCache = new Map<string, ArrowGeometry>();
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
    this.syncNotes();
    this.hydrateImageAssets();
    this.bindPointerEvents();
    this.bindResize();
    this.initZoom();
    this.emitSelection();
    this.emitCoordinateTarget();
    this.emitHistoryState();
    this.emitNavigationHistoryState();
    this.requestRender();
  }

  dispose(): void {
    this.disposed = true;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.cancelFly(false);

    while (this.disposers.length > 0) {
      this.disposers.pop()?.();
    }

    this.noteLayer.dispose();
    this.arrowLayer.dispose();
    this.gridRenderer.dispose();
    this.assets.dispose();
    this.options.stage.classList.remove('dragging', 'item-drag', 'near-snap');
    this.options.onEditingSessionChange?.(null);
    this.options.onArrowSelectionChange?.(null);
    this.options.onCoordinateTargetChange?.(null);
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

    this.flyTo(this.notePoint(note), { recordNavigation: true });
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

  // Keyboard delete: remove whichever of note/arrow is currently selected.
  // Only one is ever selected at a time (see selectNote/selectArrow).
  deleteSelection(): void {
    if (this.selectedArrowId) {
      this.deleteSelectedArrow();
      return;
    }
    this.deleteSelectedNote();
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
    this.zoom = this.clampZoom(zoom);
    this.emitZoomState();
    this.requestRender();
  }

  resetView(): void {
    if (this.editingNoteId) {
      this.cancelEditing();
    }

    this.flyTo(this.world.home, { recordNavigation: true });
  }

  goBack(): void {
    // Settle any in-flight fly first so the recorded forward entry is the real
    // prior location rather than a mid-animation point.
    this.cancelFly(true);
    const target = this.navigationBackStack.pop();
    if (!target) {
      return;
    }

    this.navigationForwardStack.push(this.currentViewCenter());
    this.emitNavigationHistoryState();
    this.flyTo(target);
  }

  goForward(): void {
    this.cancelFly(true);
    const target = this.navigationForwardStack.pop();
    if (!target) {
      return;
    }

    this.navigationBackStack.push(this.currentViewCenter());
    this.emitNavigationHistoryState();
    this.flyTo(target);
  }

  exportWorldFileText(): Promise<string> {
    return stringifyWorldFile(this.world, this.assets);
  }

  async importWorldFileText(text: string): Promise<void> {
    const content = await parseWorldFileText(text, this.assets);
    // The parse above is async, so the controller may have been disposed meanwhile;
    // bail before firing stale React callbacks (emitSelection etc.) and wasted work.
    if (this.disposed) {
      return;
    }

    if (this.editingNoteId) {
      this.cancelEditing();
    }

    this.cancelArrowGesture();
    this.options.stage.classList.remove('dragging', 'item-drag', 'near-snap');
    this.world.grid.restoreChartSnapshots(content.charts);
    this.world.replaceContent(content.notes, content.arrows);
    this.history.clear();
    this.navigationBackStack.length = 0;
    this.navigationForwardStack.length = 0;
    this.invalidateWorldPointCache();

    this.view = identityTransform;
    this.pointerMode = 'idle';
    this.gestureButton = null;
    this.dragStartPoint = null;
    this.dragStartDisk = null;
    this.dragStartView = null;
    this.downPosition = null;
    this.didMove = false;
    this.dragNoteId = null;
    this.selectedNoteId = null;
    this.hoveredNoteId = null;
    this.draggingNoteId = null;
    this.dragMoveBefore = null;
    this.editingNoteId = null;
    this.editingVisible = false;
    this.pendingNoteId = null;
    this.arrowFrom = null;
    this.draftArrowTo = null;
    this.pendingArrowHitId = null;
    this.selectedArrowId = null;
    this.hoveredArrowId = null;
    this.nextNoteId = nextNumericId(content.notes, 'note');
    this.nextArrowId = nextNumericId(content.arrows, 'arrow');

    this.syncNotes();
    this.options.onEditingSessionChange?.(null);
    this.options.onArrowSelectionChange?.(null);
    this.emitSelection();
    this.emitCoordinateTarget();
    this.emitCoordinateNotePreview();
    this.emitHistoryState();
    this.emitNavigationHistoryState();
    this.requestRender();
    this.options.onChange?.();
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
      this.zoom = this.clampZoom(minZoom);
    }

    this.emitZoomState();
  }

  private clampZoom(zoom: number): number {
    return Math.min(MAX_ZOOM, Math.max(zoom, this.minZoom));
  }

  private bindPointerEvents(): void {
    this.listen<PointerEvent>(this.options.stage, 'pointerdown', (event) =>
      this.onPointerDown(event),
    );
    this.listen<PointerEvent>(this.options.stage, 'pointermove', (event) =>
      this.onPointerMove(event),
    );
    this.listen<WheelEvent>(this.options.stage, 'wheel', (event) => this.onWheel(event));
    this.listen<DragEvent>(this.options.stage, 'dragover', (event) => this.onDragOver(event));
    this.listen<DragEvent>(this.options.stage, 'drop', (event) => this.onDrop(event));
    this.listen<MouseEvent>(this.options.stage, 'dblclick', (event) => this.onDoubleClick(event));
    this.listen<PointerEvent>(this.options.stage, 'pointerup', (event) => this.endPointer(event));
    this.listen(this.options.stage, 'pointercancel', () => this.endPointer());
    this.listen(this.options.stage, 'pointerleave', () => {
      this.options.stage.classList.remove('near-snap');
      this.updateHoveredTarget(null);
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
    if (isCanvasControlTarget(target)) {
      return;
    }

    const gestureButton = parseGestureButton(event);
    if (!gestureButton) {
      return;
    }
    this.hoveredNoteId = null;
    this.hoveredArrowId = null;
    this.emitCoordinateNotePreview();
    this.requestRender();

    if (this.pointerMode === 'editing') {
      this.cancelEditing();
      event.preventDefault();
      if (gestureButton === 'primary') {
        return;
      }
    }

    if (this.flying) {
      return;
    }

    if (gestureButton === 'middle') {
      event.preventDefault();
    }

    // Picks up scrolling / theme changes between gestures without per-frame reads.
    this.refreshViewMetrics();
    const viewport = this.viewport();

    if (gestureButton === 'primary' && this.interactionMode === 'arrow') {
      this.beginArrowGesture(event, viewport);
      return;
    }

    const noteId =
      gestureButton === 'primary' ? this.noteLayer.getNoteIdFromEventTarget(event.target) : null;
    if (noteId) {
      this.selectNote(noteId);
    }
    this.downPosition = [event.clientX, event.clientY];
    this.didMove = false;
    this.gestureButton = gestureButton;
    const z = clampDisk(screenToDisk(event.clientX, event.clientY, viewport));
    this.dragStartPoint = applyTransform(invertTransform(this.view), z);
    this.dragStartDisk = z;
    this.dragStartView = this.view;

    if (gestureButton === 'primary' && noteId) {
      this.pointerMode = 'pending-item';
      this.dragNoteId = noteId;
    } else {
      this.pointerMode = 'pending-pan';
    }

    this.options.stage.setPointerCapture(event.pointerId);
    this.options.stage.classList.add('dragging');
    this.options.stage.classList.remove('near-snap');
  }

  private onWheel(event: WheelEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    if (isCanvasControlTarget(target) || this.noteLayer.getNoteIdFromEventTarget(event.target)) {
      return;
    }

    event.preventDefault();
    const nextZoom = this.zoom * 2 ** (-event.deltaY / WHEEL_ZOOM_STEP);
    this.setZoom(nextZoom);
  }

  private onDragOver(event: DragEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    if (isCanvasControlTarget(target) || !event.dataTransfer) {
      return;
    }
    if (!hasImageDropItem(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }

  private onDrop(event: DragEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    if (isCanvasControlTarget(target) || !event.dataTransfer) {
      return;
    }

    const image = firstImageFile(event.dataTransfer.files);
    if (!image) {
      return;
    }

    event.preventDefault();
    void this.createImageNoteFromDrop(image, event.clientX, event.clientY);
  }

  private async createImageNoteFromDrop(
    file: File,
    clientX: number,
    clientY: number,
  ): Promise<void> {
    this.refreshViewMetrics();
    const snapped = this.world.grid.snapScreenPoint(clientX, clientY, this.view, this.viewport());
    if (!snapped) {
      return;
    }

    // Store the bytes in IndexedDB and keep only the content-hash id on the note.
    const assetId = await this.assets.put(file);
    const now = Date.now();
    const note: Note = {
      id: `note-${this.nextNoteId++}`,
      anchor: snapped.anchor,
      content: {
        kind: 'image',
        assetId,
        alt: file.name,
        mimeType: file.type,
      },
      appearance: {
        color: 'c1',
      },
      createdAt: now,
      updatedAt: now,
    };
    this.applyCommand({ type: 'create-note', note });
    this.selectNote(note.id);
    this.requestRender();
  }

  private onDoubleClick(event: MouseEvent): void {
    // The pointerdown gesture captures the pointer on the stage, so the synthesized
    // dblclick retargets to the stage rather than the note. Hit-test by coordinates.
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    const noteId =
      this.noteLayer.getNoteIdFromEventTarget(hit) ??
      this.noteLayer.getNoteIdFromEventTarget(event.target);
    if (!noteId) {
      return;
    }

    const note = this.world.notes.find((candidate) => candidate.id === noteId);
    if (!note || note.content.kind !== 'image') {
      return;
    }

    // Center the image and zoom so it renders at its intrinsic pixel size (1:1).
    event.preventDefault();
    this.refreshViewMetrics();
    this.selectNote(note.id);
    this.flyTo(this.notePoint(note), {
      zoom: this.imageActualSizeZoom(note.id),
      recordNavigation: true,
    });
  }

  // The zoom at which the centered image renders 1:1 with its source pixels.
  // At the disk center the render scale equals visualScale (= zoom / fitDiskZoom),
  // so scaling the fit zoom by intrinsic/layout width lands the image at 100%.
  private imageActualSizeZoom(noteId: string): number {
    const fitZoom = this.fitZoom();
    const image = this.noteLayer.getElement(noteId)?.firstElementChild;
    if (
      !(image instanceof HTMLImageElement) ||
      image.naturalWidth === 0 ||
      image.clientWidth === 0
    ) {
      return fitZoom;
    }

    return fitZoom * (image.naturalWidth / image.clientWidth);
  }

  private onPointerMove(event: PointerEvent): void {
    if (this.pointerMode === 'idle') {
      this.updateHoveredTarget(event.target, event);
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
    if (!this.dragStartDisk || !this.dragStartView) {
      return;
    }

    const viewport = this.viewport();
    const z = clampDisk(screenToDisk(event.clientX, event.clientY, viewport));
    this.view = composeTransforms(
      transformFromPointPair(this.dragStartDisk, z),
      this.dragStartView,
    );
    this.reanchorIfNeeded();
  }

  private reanchorIfNeeded(): void {
    const viewCenter = applyTransform(invertTransform(this.view), [0, 0]);
    if (abs2(viewCenter) < 0.49) {
      return;
    }

    const reanchorTransform = this.view;
    const { transientPoints = [] } = applyWorldCommand(this.world, {
      type: 'reanchor-world',
      transform: reanchorTransform,
      transientPoints: [this.dragStartPoint],
    });
    const [dragStartPoint = null] = transientPoints;
    this.dragStartPoint = dragStartPoint;
    if (this.dragStartDisk && this.dragStartView && dragStartPoint) {
      this.dragStartDisk = dragStartPoint;
      this.dragStartView = identityTransform;
    }
    this.view = identityTransform;
    this.transformWorldPointCache(reanchorTransform);
    this.transformNavigationHistory(reanchorTransform);
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
          anchor: snappedGridPoint.anchor,
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
      anchor: note.anchor,
      updatedAt: note.updatedAt,
    };
  }

  private recordFinishedMove(): void {
    if (!this.dragNoteId || !this.dragMoveBefore) {
      return;
    }

    const after = this.currentMoveSnapshot(this.dragNoteId);
    if (!after || gridAnchorsEqual(this.dragMoveBefore.anchor, after.anchor)) {
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
    this.gestureButton = null;
    this.dragStartPoint = null;
    this.dragStartDisk = null;
    this.dragStartView = null;
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

    this.invalidateWorldPointCache();
    this.syncNotes();
    this.emitCoordinateTarget();
    this.emitCoordinateNotePreview();
    this.options.onChange?.();
  }

  private afterHistoryChange(): void {
    this.invalidateWorldPointCache();
    this.syncNotes();
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
    this.emitCoordinateTarget();
    this.emitCoordinateNotePreview();
    this.emitHistoryState();
    this.requestRender();
    this.options.onChange?.();
  }

  private selectedNote(): Note | null {
    if (!this.selectedNoteId) {
      return null;
    }

    return this.world.notes.find((candidate) => candidate.id === this.selectedNoteId) ?? null;
  }

  private notePoint(note: Note): DiskPoint {
    const cached = this.notePointCache.get(note.id);
    if (cached) {
      return cached;
    }

    const point = this.world.grid.worldPointForAnchor(note.anchor);
    this.notePointCache.set(note.id, point);
    return point;
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
    this.emitCoordinateTarget();
  }

  private updateHoveredTarget(target: EventTarget | null, event?: PointerEvent): void {
    const nextHoveredNoteId = this.noteLayer.getNoteIdFromEventTarget(target);
    const viewport = this.viewport();
    const nextHoveredArrowId =
      nextHoveredNoteId || !event
        ? null
        : arrowHitTest(
            this.arrowGeometries(),
            this.view,
            viewport,
            event.clientX - viewport.left,
            event.clientY - viewport.top,
          );

    if (nextHoveredNoteId === this.hoveredNoteId && nextHoveredArrowId === this.hoveredArrowId) {
      return;
    }

    this.hoveredNoteId = nextHoveredNoteId;
    this.hoveredArrowId = nextHoveredArrowId;
    // Arrows live on the canvas, so CSS :hover can't reach them; mirror the
    // navigability into a stage class so the cursor signals the click target.
    const hoveredArrow = nextHoveredArrowId
      ? (this.world.arrows.find((candidate) => candidate.id === nextHoveredArrowId) ?? null)
      : null;
    const arrowIsNavigable = hoveredArrow ? hoveredArrow.appearance.headMode !== 'none' : false;
    this.options.stage.classList.toggle('arrow-hover', arrowIsNavigable);
    this.emitSelection();
    this.emitCoordinateTarget();
    this.emitCoordinateNotePreview(viewport);
    this.requestRender();
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

  private emitCoordinateTarget(): void {
    if (!this.options.onCoordinateTargetChange) {
      return;
    }

    const selectedNote = this.selectedNote();
    if (selectedNote) {
      this.options.onCoordinateTargetChange({
        kind: 'note',
        source: 'selected',
        noteId: selectedNote.id,
        anchor: selectedNote.anchor,
      });
      return;
    }

    const selectedArrow = this.selectedArrow();
    if (selectedArrow) {
      this.options.onCoordinateTargetChange({
        kind: 'arrow',
        source: 'selected',
        arrowId: selectedArrow.id,
        from: selectedArrow.from,
        to: selectedArrow.to,
      });
      return;
    }

    const hoveredNote = this.hoveredNoteId
      ? (this.world.notes.find((candidate) => candidate.id === this.hoveredNoteId) ?? null)
      : null;
    if (hoveredNote) {
      this.options.onCoordinateTargetChange({
        kind: 'note',
        source: 'hovered',
        noteId: hoveredNote.id,
        anchor: hoveredNote.anchor,
      });
      return;
    }

    const hoveredArrow = this.hoveredArrowId
      ? (this.world.arrows.find((candidate) => candidate.id === this.hoveredArrowId) ?? null)
      : null;
    if (hoveredArrow) {
      this.options.onCoordinateTargetChange({
        kind: 'arrow',
        source: 'hovered',
        arrowId: hoveredArrow.id,
        from: hoveredArrow.from,
        to: hoveredArrow.to,
      });
      return;
    }

    this.options.onCoordinateTargetChange(null);
  }

  private emitCoordinateNotePreview(viewport: Viewport = this.viewport()): void {
    if (!this.options.onCoordinateNotePreviewChange) {
      return;
    }

    const preview = this.hoveredCoordinateJump();
    if (!preview) {
      this.options.onCoordinateNotePreviewChange(null);
      return;
    }

    const projected = projectDiskPoint(
      clampDisk(applyTransform(this.view, this.notePoint(preview.source))),
      viewport,
    );
    this.options.onCoordinateNotePreviewChange({
      sourceNoteId: preview.source.id,
      targetNoteId: preview.target.id,
      text: noteDisplayText(preview.target),
      color: noteColor(preview.target),
      screenPosition: {
        x: projected.x,
        y: projected.y,
      },
    });
  }

  private hoveredCoordinateJump(): CoordinateJumpPreview | null {
    const source = this.hoveredNoteId
      ? (this.world.notes.find((candidate) => candidate.id === this.hoveredNoteId) ?? null)
      : null;
    if (!source) {
      return null;
    }

    const targetAnchor = noteCoordinateTarget(source);
    const target = targetAnchor
      ? (this.world.notes.find((candidate) => gridAnchorsEqual(candidate.anchor, targetAnchor)) ??
        null)
      : null;
    if (!target) {
      return null;
    }

    return { source, target };
  }

  private emitHistoryState(): void {
    this.options.onHistoryStateChange?.(this.history.state);
  }

  private emitNavigationHistoryState(): void {
    this.options.onNavigationHistoryStateChange?.({
      canGoBack: this.navigationBackStack.length > 0,
      canGoForward: this.navigationForwardStack.length > 0,
    });
  }

  private endPointer(event?: PointerEvent): void {
    if (this.pointerMode === 'idle' || this.pointerMode === 'editing' || this.flying) {
      return;
    }

    const endedPointerMode = this.pointerMode;
    this.options.stage.classList.remove('dragging', 'item-drag');

    if (endedPointerMode === 'arrow-draw') {
      this.finishArrowGesture();
      this.pointerMode = 'idle';
      this.gestureButton = null;
      this.requestRender();
      return;
    }

    if (!this.didMove && this.gestureButton === 'primary') {
      if (this.pointerMode === 'pending-pan' && this.dragStartPoint) {
        if (this.interactionMode === 'pan' && this.navigateClickedArrow(event)) {
          this.resetDragState();
          return;
        }
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
              gridAnchorsEqual(n.anchor, snapped.anchor),
            );
            const target = existing ?? this.createNote(snapped.anchor);
            this.selectNote(target.id);
            this.startEdit(target);
            this.resetDragState();
            return;
          }
        }
        this.selectNote(null);
        this.flyTo(this.dragStartPoint, { recordNavigation: true });
      } else if (this.pointerMode === 'pending-item' && this.dragNoteId) {
        const note = this.world.notes.find((candidate) => candidate.id === this.dragNoteId);
        if (note) {
          if (this.interactionMode === 'pan' && this.openNoteLink(note)) {
            this.resetDragState();
            this.requestRender();
            return;
          }
          if (this.interactionMode === 'pan' && this.flyToNoteCoordinate(note)) {
            this.resetDragState();
            return;
          }
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

  private navigateClickedArrow(event: PointerEvent | undefined): boolean {
    const position: DiskPoint | null = event ? [event.clientX, event.clientY] : this.downPosition;
    if (!position) {
      return false;
    }

    const viewport = this.viewport();
    const arrowId = arrowHitTest(
      this.arrowGeometries(),
      this.view,
      viewport,
      position[0] - viewport.left,
      position[1] - viewport.top,
    );
    if (!arrowId) {
      return false;
    }

    const arrow = this.world.arrows.find((candidate) => candidate.id === arrowId);
    if (!arrow) {
      return false;
    }

    const target = arrowNavigationTarget(
      arrow,
      this.world.grid.worldPointForAnchor(arrow.from),
      this.world.grid.worldPointForAnchor(arrow.to),
      this.view,
    );
    if (!target) {
      return true;
    }

    this.flyTo(target, { recordNavigation: true });
    return true;
  }

  private openNoteLink(note: Note): boolean {
    const link = parseExternalLink(noteDisplayText(note));
    if (!link) {
      return false;
    }

    window.open(link.href, '_blank', 'noopener,noreferrer');
    return true;
  }

  private flyToNoteCoordinate(note: Note): boolean {
    const anchor = noteCoordinateTarget(note);
    if (!anchor) {
      return false;
    }

    try {
      this.flyTo(this.world.grid.worldPointForAnchor(anchor), { recordNavigation: true });
    } catch {
      return false;
    }
    return true;
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
    if (!noteIsTextEditable(note)) {
      return;
    }
    if (this.pendingNoteId && this.pendingNoteId !== note.id) {
      this.discardPendingNote();
    }
    this.selectedNoteId = note.id;
    this.pointerMode = 'editing';
    this.editingNoteId = note.id;
    this.editingVisible = false;
    this.options.onEditingSessionChange?.(null);
    this.emitSelection();
    this.flyTo(this.notePoint(note), {
      ms: 380,
      onDone: () => {
        if (this.editingNoteId !== note.id) {
          return;
        }

        this.editingVisible = true;
        this.render();
      },
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

    const point = this.notePoint(note);
    const transformed = applyTransform(this.view, point);
    const projected = projectDiskPoint(transformed, viewport);
    this.options.onEditingSessionChange({
      noteId: note.id,
      anchor: point,
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

  private emitSelectedImage(): void {
    const handler = this.options.onSelectedImageChange;
    if (!handler) {
      return;
    }

    const note = this.selectedNote();
    const stageRect = this.stageRect;
    if (
      !note ||
      note.content.kind !== 'image' ||
      this.editingNoteId !== null ||
      this.pointerMode === 'item-drag' ||
      !stageRect
    ) {
      handler(null);
      return;
    }

    const element = this.noteLayer.getElement(note.id);
    if (!element) {
      handler(null);
      return;
    }

    // The element rect already reflects the CSS scale, so the corner tracks zoom.
    const rect = element.getBoundingClientRect();
    handler({
      noteId: note.id,
      screenPosition: {
        x: rect.right - stageRect.left,
        y: rect.top - stageRect.top,
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
    this.gestureButton = 'primary';

    const snapped = this.world.grid.snapScreenPoint(
      event.clientX,
      event.clientY,
      this.view,
      viewport,
    );
    this.arrowFrom = snapped ? { anchor: snapped.anchor, point: snapped.point } : null;
    this.draftArrowTo = this.arrowFrom;
    this.pendingArrowHitId = arrowHitTest(
      this.arrowGeometries(),
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
      this.draftArrowTo = { anchor: snapped.anchor, point: snapped.point };
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

    if (from && to && !gridAnchorsEqual(from.anchor, to.anchor)) {
      this.createArrow(from.anchor, to.anchor);
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

  private createArrow(from: GridAnchor, to: GridAnchor): void {
    const now = Date.now();
    const arrow: Arrow = {
      id: `arrow-${this.nextArrowId++}`,
      from,
      to,
      label: '',
      appearance: {
        color: ARROW_DEFAULT_COLOR,
        headMode: 'end',
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

  private arrowGeometry(arrow: Arrow): ArrowGeometry {
    const cached = this.arrowGeometryCache.get(arrow.id);
    if (cached) {
      return cached;
    }

    const geometry = {
      id: arrow.id,
      from: this.world.grid.worldPointForAnchor(arrow.from),
      to: this.world.grid.worldPointForAnchor(arrow.to),
    };
    this.arrowGeometryCache.set(arrow.id, geometry);
    return geometry;
  }

  private arrowGeometries(): ArrowGeometry[] {
    return this.world.arrows.map((arrow) => this.arrowGeometry(arrow));
  }

  private renderedArrows(): RenderedArrow[] {
    return this.world.arrows.map((arrow) => {
      const geometry = this.arrowGeometry(arrow);
      return { arrow, from: geometry.from, to: geometry.to };
    });
  }

  private selectArrow(arrowId: string | null): void {
    this.selectedArrowId = arrowId;
    if (arrowId !== null && this.selectedNoteId !== null) {
      this.selectedNoteId = null;
      this.emitSelection();
    }
    this.emitArrowSelection(this.viewport());
    this.emitCoordinateTarget();
    this.requestRender();
  }

  private clearArrowSelection(): void {
    if (this.selectedArrowId === null) {
      return;
    }
    this.selectedArrowId = null;
    this.options.onArrowSelectionChange?.(null);
    this.emitCoordinateTarget();
    this.requestRender();
  }

  deleteSelectedArrow(): void {
    if (!this.selectedArrowId) {
      return;
    }
    this.applyCommand({ type: 'delete-arrow', arrowId: this.selectedArrowId });
    this.selectedArrowId = null;
    this.options.onArrowSelectionChange?.(null);
    this.emitCoordinateTarget();
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
      appearance: { ...arrow.appearance, color },
      updatedAt: Date.now(),
    });
    this.requestRender();
  }

  setSelectedArrowHeadMode(headMode: ArrowHeadMode): void {
    const arrow = this.selectedArrow();
    if (!arrow || arrow.appearance.headMode === headMode) {
      return;
    }
    this.applyCommand({
      type: 'update-arrow',
      arrowId: arrow.id,
      label: arrow.label,
      appearance: { ...arrow.appearance, headMode },
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

  private createNote(anchor: GridAnchor): Note {
    const now = Date.now();
    const note: Note = {
      id: `note-${this.nextNoteId++}`,
      anchor,
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

  private flyTo(target: DiskPoint, options: FlyToOptions = {}): void {
    // Interrupt and settle any in-flight fly so this navigation takes over from
    // the prior destination instead of being dropped.
    this.cancelFly(true);

    const ms = options.ms ?? 450;
    const startView = this.view;
    const startPosition = applyTransform(startView, target);
    const startZoom = this.zoom;
    const targetZoom = options.zoom === undefined ? this.zoom : this.clampZoom(options.zoom);
    const animateZoom = Math.abs(targetZoom - startZoom) > 1e-6;
    const startTime = performance.now();
    if (options.recordNavigation) {
      this.recordNavigationJump(target);
    }
    this.flying = true;

    // Jump straight to the destination. Reused both for the final frame and for
    // settling the fly when it is interrupted partway (see cancelFly).
    const settle = (): void => {
      this.flying = false;
      this.flyRafId = null;
      this.flySettle = null;
      this.view = transformFromPointPair(target, [0, 0]);
      if (animateZoom) {
        this.zoom = targetZoom;
        this.emitZoomState();
      }
      this.reanchorIfNeeded();
      this.render();
      options.onDone?.();
    };
    this.flySettle = settle;

    const step = (): void => {
      if (this.disposed) {
        this.flying = false;
        this.flyRafId = null;
        this.flySettle = null;
        return;
      }
      // A throw here (e.g. a degenerate target) must not leave the fly state stuck,
      // which would wedge every later interaction. Reset it before re-throwing.
      try {
        const t = Math.min(1, (performance.now() - startTime) / ms);
        if (t >= 1) {
          settle();
          return;
        }

        const eased = 1 - (1 - t) ** 3;
        const position: DiskPoint = [
          startPosition[0] * (1 - eased),
          startPosition[1] * (1 - eased),
        ];
        this.view = transformFromPointPair(target, position);
        if (animateZoom) {
          this.zoom = startZoom + (targetZoom - startZoom) * eased;
          this.emitZoomState();
        }
        this.render();
        this.flyRafId = requestAnimationFrame(step);
      } catch (error) {
        this.flying = false;
        this.flyRafId = null;
        this.flySettle = null;
        throw error;
      }
    };

    this.flyRafId = requestAnimationFrame(step);
  }

  // Stop any in-flight fly. When settle is true it first jumps to the fly's
  // destination, so navigation history and the resting view reflect the logical
  // target rather than wherever the animation happened to be; dispose passes
  // false to stop silently without a final render or onDone.
  private cancelFly(settle: boolean): void {
    if (this.flyRafId !== null) {
      cancelAnimationFrame(this.flyRafId);
      this.flyRafId = null;
    }
    const settleAtTarget = this.flySettle;
    this.flySettle = null;
    this.flying = false;
    if (settle) {
      settleAtTarget?.();
    }
  }

  private currentViewCenter(): DiskPoint {
    return applyTransform(invertTransform(this.view), [0, 0]);
  }

  private recordNavigationJump(target: DiskPoint): void {
    const current = this.currentViewCenter();
    const dx = current[0] - target[0];
    const dy = current[1] - target[1];
    if (dx * dx + dy * dy < 1e-8) {
      return;
    }

    this.navigationBackStack.push(current);
    this.navigationForwardStack.length = 0;
    this.emitNavigationHistoryState();
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

    const geometry = this.arrowGeometry(arrow);
    const midpoint = arrowMidpoint(geometry.from, geometry.to, this.view, viewport);
    this.options.onArrowSelectionChange({
      arrowId: arrow.id,
      label: arrow.label,
      color: arrow.appearance.color,
      headMode: arrow.appearance.headMode,
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
    if (gridAnchorsEqual(this.arrowFrom.anchor, this.draftArrowTo.anchor)) {
      return null;
    }
    return {
      from: this.arrowFrom.point,
      to: this.draftArrowTo.point,
      color: ARROW_DEFAULT_COLOR,
    };
  }

  private coordinatePreviewArrow(): ArrowDraft | null {
    const preview = this.hoveredCoordinateJump();
    if (!preview || gridAnchorsEqual(preview.source.anchor, preview.target.anchor)) {
      return null;
    }

    return {
      from: this.notePoint(preview.source),
      to: this.notePoint(preview.target),
      color: noteColor(preview.target),
    };
  }

  private renderedNotes(): RenderedNote[] {
    return this.world.notes.map((note) => ({ note, point: this.notePoint(note) }));
  }

  private invalidateWorldPointCache(): void {
    this.notePointCache.clear();
    this.arrowGeometryCache.clear();
  }

  private transformWorldPointCache(transform: DiskTransform): void {
    for (const [noteId, point] of this.notePointCache) {
      this.notePointCache.set(noteId, applyTransform(transform, point));
    }
    for (const [arrowId, geometry] of this.arrowGeometryCache) {
      this.arrowGeometryCache.set(arrowId, {
        id: geometry.id,
        from: applyTransform(transform, geometry.from),
        to: applyTransform(transform, geometry.to),
      });
    }
  }

  private transformNavigationHistory(transform: DiskTransform): void {
    for (let i = 0; i < this.navigationBackStack.length; i += 1) {
      const point = this.navigationBackStack[i];
      if (point) {
        this.navigationBackStack[i] = applyTransform(transform, point);
      }
    }
    for (let i = 0; i < this.navigationForwardStack.length; i += 1) {
      const point = this.navigationForwardStack[i];
      if (point) {
        this.navigationForwardStack[i] = applyTransform(transform, point);
      }
    }
  }

  private syncNotes(): void {
    this.noteLayer.sync(this.world.notes, (assetId) => this.assets.objectUrl(assetId));
  }

  // Image bytes live in IndexedDB; load object URLs for the notes already in the
  // world (e.g. after import) and re-sync so their <img> src can resolve.
  private hydrateImageAssets(): void {
    const assetIds = this.world.notes
      .map((note) => (note.content.kind === 'image' ? note.content.assetId : null))
      .filter((id): id is string => id !== null);
    if (assetIds.length === 0) {
      return;
    }

    void this.assets.hydrate(assetIds).then(() => {
      if (this.disposed) {
        return;
      }
      this.syncNotes();
      this.requestRender();
    });
  }

  private requestRender(): void {
    if (this.disposed || this.rafId !== null) {
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
      this.renderedArrows(),
      this.view,
      viewport,
      (color) => this.arrowColors[color],
      this.arrowDraft(),
      {
        selectedArrowId: this.selectedArrowId,
        labelHalo: this.surfaceColor,
        preview: this.coordinatePreviewArrow(),
      },
    );

    this.noteLayer.render(
      this.renderedNotes(),
      this.view,
      viewport,
      this.editingVisible ? this.editingNoteId : null,
      this.selectedNoteId,
    );
    this.emitEditingSession(viewport);
    this.emitSelectedImage();
  }
}

const nextNumericId = (items: readonly { id: string }[], prefix: string): number => {
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);
  return items.reduce((next, item) => {
    const value = pattern.exec(item.id)?.[1];
    return value === undefined ? next : Math.max(next, Number(value) + 1);
  }, 0);
};

const isCanvasControlTarget = (target: Element | null): boolean =>
  Boolean(
    target?.closest(
      [
        '[data-testid="note-editor"]',
        '[data-testid="arrow-inspector"]',
        '[data-testid="inspector"]',
        '[data-testid="app-menu"]',
        '[data-testid="history-controls"]',
        '[data-testid="mode-controls"]',
        '[data-testid="zoom-controls"]',
        '[data-testid="coordinate-indicator"]',
      ].join(', '),
    ),
  );

const parseGestureButton = (event: PointerEvent): GestureButton | null => {
  if (event.button === 0) {
    return 'primary';
  }
  if (event.button === 1) {
    return 'middle';
  }
  return null;
};

const firstImageFile = (files: FileList): File | null => {
  for (const file of files) {
    if (file.type.startsWith('image/')) {
      return file;
    }
  }

  return null;
};

const hasImageDropItem = (dataTransfer: DataTransfer): boolean => {
  if (firstImageFile(dataTransfer.files)) {
    return true;
  }

  for (const item of dataTransfer.items) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      return true;
    }
  }

  return false;
};
