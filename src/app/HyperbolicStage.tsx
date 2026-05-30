import { Hand, LocateFixed, Move, Pencil, Redo2, Undo2, ZoomIn } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
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
import type { NoteDraft } from '../model/noteDraft';
import { NoteEditorOverlay } from './NoteEditorOverlay';

export const HyperbolicStage = () => {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<HyperbolicCanvasController | null>(null);
  const [mode, setMode] = useState<InteractionMode>('pan');
  const [editingSession, setEditingSession] = useState<EditingSession | null>(null);
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

    if (!stage || !canvas) {
      throw new Error('Hyperbolic stage mounted without required DOM refs.');
    }

    const tiling = generateHyperbolicTiling();
    const grid = new AnchoredGrid(tiling);
    const notes = seedNotes(tiling.coarseGridPoints, 700, { maxInitialRadius: 0.92 });
    const controller = new HyperbolicCanvasController({
      stage,
      canvas,
      notes,
      grid,
      initialMode: 'pan',
      onEditingSessionChange: setEditingSession,
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

  return (
    <div id="stage" className={`mode-${mode}`} ref={stageRef}>
      <canvas id="grid" ref={canvasRef} />
      {editingSession ? (
        <NoteEditorOverlay
          key={editingSession.noteId}
          session={editingSession}
          onCommit={commitEditingDraft}
          onCancel={() => controllerRef.current?.cancelEditing()}
          onDelete={() => controllerRef.current?.deleteEditingNote()}
        />
      ) : null}
      <div className="top-left-controls">
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
            <Pencil size={14} aria-hidden />
            Edit
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
