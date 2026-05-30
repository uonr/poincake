import { Hand, LocateFixed, Move, Redo2, Spline, Type, Undo2, ZoomIn } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ArrowSelection } from '../core/arrowSelection';
import type { CoordinateTarget } from '../core/coordinateIndicator';
import type { EditingSession } from '../core/editingSession';
import { emptySelectionState, type SelectionState } from '../core/selectionState';
import { seedNotes } from '../demo/seedNotes';
import { AnchoredGrid } from '../grid/anchoredGrid';
import { generateHyperbolicTiling } from '../grid/hyperbolicTiling';
import {
  HyperbolicCanvasController,
  type InteractionMode,
  type ZoomState,
} from '../interaction/controller';
import type { HistoryState } from '../model/history';
import type { NoteColor } from '../model/note';
import type { NoteDraft } from '../model/noteDraft';
import { AppMenu } from './AppMenu';
import { ArrowInspector } from './ArrowInspector';
import { CoordinateIndicator } from './CoordinateIndicator';
import { NoteEditorOverlay } from './NoteEditorOverlay';

export const HyperbolicStage = () => {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const arrowCanvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<HyperbolicCanvasController | null>(null);
  const [mode, setMode] = useState<InteractionMode>('pan');
  const [editingSession, setEditingSession] = useState<EditingSession | null>(null);
  const [arrowSelection, setArrowSelection] = useState<ArrowSelection | null>(null);
  const [coordinateTarget, setCoordinateTarget] = useState<CoordinateTarget | null>(null);
  const [, setSelection] = useState<SelectionState>(emptySelectionState);
  const [history, setHistory] = useState<HistoryState>({
    canUndo: false,
    canRedo: false,
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
      onSelectionChange: setSelection,
      onZoomStateChange: setZoomState,
      onHistoryStateChange: setHistory,
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
    setMode(nextMode);
    controllerRef.current?.setInteractionMode(nextMode);
  };

  const changeZoom = (nextZoom: number): void => {
    setZoomState((current) => ({ ...current, zoom: nextZoom }));
    controllerRef.current?.setZoom(nextZoom);
  };

  const changeArrowColor = (color: NoteColor): void => {
    controllerRef.current?.setSelectedArrowColor(color);
  };

  const changeArrowLabel = (label: string): void => {
    controllerRef.current?.commitSelectedArrowLabel(label);
  };

  const exportContent = (): void => {
    const text = controllerRef.current?.exportWorldFileText();
    if (!text) {
      return;
    }

    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `poincake-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const importContent = (text: string): void => {
    try {
      controllerRef.current?.importWorldFileText(text);
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
      {arrowSelection && mode === 'arrow' ? (
        <ArrowInspector
          key={arrowSelection.arrowId}
          selection={arrowSelection}
          onChangeColor={changeArrowColor}
          onChangeLabel={changeArrowLabel}
          onDelete={() => controllerRef.current?.deleteSelectedArrow()}
        />
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
          <button
            data-mode="pan"
            className={mode === 'pan' ? 'active' : undefined}
            type="button"
            onClick={() => changeMode('pan')}
          >
            <Hand size={14} aria-hidden />
            Navigate
          </button>
          <button
            data-mode="edit"
            className={mode === 'edit' ? 'active' : undefined}
            type="button"
            onClick={() => changeMode('edit')}
          >
            <Type size={14} aria-hidden />
            Text
          </button>
          <button
            data-mode="move"
            className={mode === 'move' ? 'active' : undefined}
            type="button"
            onClick={() => changeMode('move')}
          >
            <Move size={14} aria-hidden />
            Move
          </button>
          <button
            data-mode="arrow"
            className={mode === 'arrow' ? 'active' : undefined}
            type="button"
            onClick={() => changeMode('arrow')}
          >
            <Spline size={14} aria-hidden />
            Arrow
          </button>
        </fieldset>
      </div>
      <div className="zoom-control" data-testid="zoom-controls">
        <ZoomIn size={15} aria-hidden />
        <span>Zoom</span>
        <input
          type="range"
          id="zoom"
          min={zoomState.minZoom}
          max="2.5"
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
