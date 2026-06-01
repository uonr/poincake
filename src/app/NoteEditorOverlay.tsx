import { Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { EditingSession } from '../core/editingSession';
import type { NoteDraft } from '../model/noteDraft';
import { ColorSwatches } from './ColorSwatches';
import { useCanvasFloatingPosition } from './useCanvasFloatingPosition';

type NoteEditorOverlayProps = Readonly<{
  session: EditingSession;
  onChange: (draft: NoteDraft) => void;
  onRollback: () => void;
  onDelete: () => void;
}>;

export const NoteEditorOverlay = ({
  session,
  onChange,
  onRollback,
  onDelete,
}: NoteEditorOverlayProps) => {
  const [draft, setDraft] = useState<NoteDraft>(session.draft);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const floating = useCanvasFloatingPosition({
    offsetPx: 12,
    placement: 'bottom',
    position: session.screenPosition,
  });

  useEffect(() => {
    textareaRef.current?.focus();
    textareaRef.current?.select();
  }, []);

  return (
    <div
      ref={floating.ref}
      className={`note-editor-overlay ${draft.color}`}
      data-testid="note-editor"
      style={floating.style}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <textarea
        ref={textareaRef}
        aria-label="Note text"
        data-testid="note-editor-text"
        value={draft.text}
        rows={4}
        onChange={(event) => {
          const text = event.currentTarget.value;
          setDraft((current) => {
            const next = { ...current, text };
            onChange(next);
            return next;
          });
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onRollback();
          }
        }}
      />
      <div className="note-editor-tools">
        <ColorSwatches
          label="Note color"
          value={draft.color}
          onChange={(color) => {
            setDraft((current) => {
              const next = { ...current, color };
              onChange(next);
              return next;
            });
          }}
        />
        <div className="note-editor-actions">
          <button type="button" className="danger" onClick={onDelete}>
            <Trash2 size={14} aria-hidden />
            Delete
          </button>
        </div>
      </div>
    </div>
  );
};
