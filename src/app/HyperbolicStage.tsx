import {
  ChevronLeft,
  ChevronRight,
  Hand,
  LocateFixed,
  Move,
  Redo2,
  Spline,
  Type,
  Undo2,
  ZoomIn,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { ArrowSelection } from '../core/arrowSelection';
import type { CoordinateTarget } from '../core/coordinateIndicator';
import type { EditingSession } from '../core/editingSession';
import { emptySelectionState, type SelectionState } from '../core/selectionState';
import { seedNotes } from '../demo/seedNotes';
import { AnchoredGrid } from '../grid/anchoredGrid';
import { generateHyperbolicTiling } from '../grid/hyperbolicTiling';
import {
  type CoordinateNotePreview,
  HyperbolicCanvasController,
  type InteractionMode,
  type NavigationHistoryState,
  type SelectedImageToolbar,
  type ZoomState,
} from '../interaction/controller';
import type { ArrowHeadMode } from '../model/arrow';
import type { HistoryState } from '../model/history';
import type { NoteColor } from '../model/note';
import type { NoteDraft } from '../model/noteDraft';
import { gzipText, readWorldFileText } from '../model/worldFileArchive';
import { AppMenu } from './AppMenu';
import { ArrowInspector } from './ArrowInspector';
import { CoordinateIndicator } from './CoordinateIndicator';
import { CoordinateNotePreviewPopover } from './CoordinateNotePreviewPopover';
import { ImageNoteToolbar } from './ImageNoteToolbar';
import { NoteEditorOverlay } from './NoteEditorOverlay';
import { Tooltip } from './Tooltip';

export const HyperbolicStage = () => {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const arrowCanvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<HyperbolicCanvasController | null>(null);
  const modeRef = useRef<InteractionMode>('pan');
  const temporaryPanModeRef = useRef<InteractionMode | null>(null);
  const [mode, setMode] = useState<InteractionMode>('pan');
  const [editingSession, setEditingSession] = useState<EditingSession | null>(null);
  const [arrowSelection, setArrowSelection] = useState<ArrowSelection | null>(null);
  const [selectedImage, setSelectedImage] = useState<SelectedImageToolbar | null>(null);
  const [coordinateTarget, setCoordinateTarget] = useState<CoordinateTarget | null>(null);
  const [coordinateNotePreview, setCoordinateNotePreview] = useState<CoordinateNotePreview | null>(
    null,
  );
  const [, setSelection] = useState<SelectionState>(emptySelectionState);
  const [history, setHistory] = useState<HistoryState>({
    canUndo: false,
    canRedo: false,
  });
  const [navigationHistory, setNavigationHistory] = useState<NavigationHistoryState>({
    canGoBack: false,
    canGoForward: false,
  });
  const [zoomState, setZoomState] = useState<ZoomState>({
    zoom: 0.5,
    minZoom: 0.5,
  });

  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    const arrowCanvas = arrowCanvasRef.current;

    if (!stage || !canvas || !arrowCanvas) {
      throw new Error('Hyperbolic stage mounted without required DOM refs.');
    }

    const tiling = generateHyperbolicTiling();
    const grid = new AnchoredGrid(tiling);
    const notes = seedNotes(tiling.coarseGridPoints, 700, {
      maxInitialRadius: 0.92,
    });
    const controller = new HyperbolicCanvasController({
      stage,
      canvas,
      arrowCanvas,
      notes,
      grid,
      initialMode: 'pan',
      onEditingSessionChange: setEditingSession,
      onArrowSelectionChange: setArrowSelection,
      onCoordinateTargetChange: setCoordinateTarget,
      onCoordinateNotePreviewChange: setCoordinateNotePreview,
      onSelectedImageChange: setSelectedImage,
      onSelectionChange: setSelection,
      onZoomStateChange: setZoomState,
      onHistoryStateChange: setHistory,
      onNavigationHistoryStateChange: setNavigationHistory,
    });
    controllerRef.current = controller;

    controller.start();

    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, []);

  const commitEditingDraft = (draft: NoteDraft): void => {
    controllerRef.current?.commitEditingDraft(draft);
  };

  const changeMode = (nextMode: InteractionMode): void => {
    temporaryPanModeRef.current = null;
    modeRef.current = nextMode;
    setMode(nextMode);
    controllerRef.current?.setInteractionMode(nextMode);
  };

  useEffect(() => {
    const applyMode = (nextMode: InteractionMode): void => {
      modeRef.current = nextMode;
      setMode(nextMode);
      controllerRef.current?.setInteractionMode(nextMode);
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (shouldIgnoreModeShortcut(event)) {
        return;
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        controllerRef.current?.deleteSelection();
        return;
      }

      const shortcutMode = modeForShortcut(event);
      if (shortcutMode) {
        event.preventDefault();
        temporaryPanModeRef.current = null;
        applyMode(shortcutMode);
        return;
      }

      if (event.code === 'Space' && !event.repeat && !event.shiftKey && modeRef.current !== 'pan') {
        event.preventDefault();
        temporaryPanModeRef.current = modeRef.current;
        applyMode('pan');
      }
    };

    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.code !== 'Space') {
        return;
      }

      const restoreMode = temporaryPanModeRef.current;
      if (!restoreMode) {
        return;
      }

      event.preventDefault();
      temporaryPanModeRef.current = null;
      applyMode(restoreMode);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  const changeZoom = (nextZoom: number): void => {
    setZoomState((current) => ({ ...current, zoom: nextZoom }));
    controllerRef.current?.setZoom(nextZoom);
  };

  const changeArrowColor = (color: NoteColor): void => {
    controllerRef.current?.setSelectedArrowColor(color);
  };

  const changeArrowHeadMode = (headMode: ArrowHeadMode): void => {
    controllerRef.current?.setSelectedArrowHeadMode(headMode);
  };

  const changeArrowLabel = (label: string): void => {
    controllerRef.current?.commitSelectedArrowLabel(label);
  };

  const exportContent = async (): Promise<void> => {
    const text = await controllerRef.current?.exportWorldFileText();
    if (!text) {
      return;
    }

    const blob = await gzipText(text);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `poincake-${new Date().toISOString().slice(0, 10)}.poin`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const importContent = async (file: File): Promise<void> => {
    try {
      const text = await readWorldFileText(file);
      await controllerRef.current?.importWorldFileText(text);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Import failed.');
    }
  };

  return (
    <div id="stage" className={`mode-${mode}`} ref={stageRef}>
      <canvas id="grid" ref={canvasRef} />
      <canvas id="arrows" ref={arrowCanvasRef} />
      {editingSession ? (
        <NoteEditorOverlay
          key={editingSession.noteId}
          session={editingSession}
          onCommit={commitEditingDraft}
          onCancel={() => controllerRef.current?.cancelEditing()}
          onDelete={() => controllerRef.current?.deleteEditingNote()}
        />
      ) : null}
      {selectedImage && mode === 'edit' ? (
        <ImageNoteToolbar
          key={selectedImage.noteId}
          position={selectedImage.screenPosition}
          onDelete={() => controllerRef.current?.deleteSelectedNote()}
        />
      ) : null}
      {arrowSelection && mode === 'arrow' ? (
        <ArrowInspector
          key={arrowSelection.arrowId}
          selection={arrowSelection}
          onChangeColor={changeArrowColor}
          onChangeHeadMode={changeArrowHeadMode}
          onChangeLabel={changeArrowLabel}
          onDelete={() => controllerRef.current?.deleteSelectedArrow()}
        />
      ) : null}
      {coordinateNotePreview ? (
        <CoordinateNotePreviewPopover preview={coordinateNotePreview} />
      ) : null}
      <CoordinateIndicator target={coordinateTarget} />
      <div className="top-left-controls">
        <AppMenu onExport={exportContent} onImport={importContent} />
        <div className="history-controls" data-testid="history-controls">
          <button
            type="button"
            aria-label="Undo"
            title="Undo"
            onClick={() => controllerRef.current?.undo()}
            disabled={!history.canUndo}
          >
            <Undo2 size={15} aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Redo"
            title="Redo"
            onClick={() => controllerRef.current?.redo()}
            disabled={!history.canRedo}
          >
            <Redo2 size={15} aria-hidden />
          </button>
        </div>
        <fieldset className="mode-buttons" data-testid="mode-controls">
          <legend className="visually-hidden">Mode</legend>
          <ModeButton
            active={mode === 'pan'}
            icon={<Hand size={14} aria-hidden />}
            label="Navigate"
            mode="pan"
            shortcut="V, 1, Esc; hold Space"
            onClick={() => changeMode('pan')}
          />
          <ModeButton
            active={mode === 'edit'}
            icon={<Type size={14} aria-hidden />}
            label="Text"
            mode="edit"
            shortcut="T, 2"
            onClick={() => changeMode('edit')}
          />
          <ModeButton
            active={mode === 'move'}
            icon={<Move size={14} aria-hidden />}
            label="Move"
            mode="move"
            shortcut="M, 3"
            onClick={() => changeMode('move')}
          />
          <ModeButton
            active={mode === 'arrow'}
            icon={<Spline size={14} aria-hidden />}
            label="Arrow"
            mode="arrow"
            shortcut="A, 4"
            onClick={() => changeMode('arrow')}
          />
          {navigationHistory.canGoBack || navigationHistory.canGoForward ? (
            <div className="view-history-controls" data-testid="view-history-controls">
              <Tooltip label="Back">
                <button
                  type="button"
                  aria-label="Back"
                  onClick={() => controllerRef.current?.goBack()}
                  disabled={!navigationHistory.canGoBack}
                >
                  <ChevronLeft size={14} aria-hidden />
                </button>
              </Tooltip>
              <Tooltip label="Forward">
                <button
                  type="button"
                  aria-label="Forward"
                  onClick={() => controllerRef.current?.goForward()}
                  disabled={!navigationHistory.canGoForward}
                >
                  <ChevronRight size={14} aria-hidden />
                </button>
              </Tooltip>
            </div>
          ) : null}
        </fieldset>
      </div>
      <div className="zoom-control" data-testid="zoom-controls">
        <ZoomIn size={15} aria-hidden />
        <span>Zoom</span>
        <input
          type="range"
          id="zoom"
          min={zoomState.minZoom}
          max="6"
          step="0.05"
          value={zoomState.zoom}
          onChange={(event) => changeZoom(Number.parseFloat(event.currentTarget.value))}
        />
        <span id="zoom-val">{zoomState.zoom.toFixed(2)}x</span>
        <button id="reset" type="button" onClick={() => controllerRef.current?.resetView()}>
          <LocateFixed size={14} aria-hidden />
          Origin
        </button>
      </div>
    </div>
  );
};

type ModeButtonProps = Readonly<{
  active: boolean;
  icon: ReactNode;
  label: string;
  mode: InteractionMode;
  onClick: () => void;
  shortcut: string;
}>;

const ModeButton = ({ active, icon, label, mode, onClick, shortcut }: ModeButtonProps) => (
  <Tooltip label={`${label} (${shortcut})`}>
    <button
      data-mode={mode}
      className={active ? 'active' : undefined}
      type="button"
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  </Tooltip>
);

const SHORTCUT_MODES: Readonly<Record<string, InteractionMode>> = {
  '1': 'pan',
  '2': 'edit',
  '3': 'move',
  '4': 'arrow',
  a: 'arrow',
  escape: 'pan',
  m: 'move',
  t: 'edit',
  v: 'pan',
};

const modeForShortcut = (event: KeyboardEvent): InteractionMode | null => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
    return null;
  }

  return SHORTCUT_MODES[event.key.toLowerCase()] ?? null;
};

const shouldIgnoreModeShortcut = (event: KeyboardEvent): boolean => {
  if (event.altKey || event.ctrlKey || event.metaKey) {
    return true;
  }

  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
};
