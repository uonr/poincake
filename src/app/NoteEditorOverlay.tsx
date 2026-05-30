import { useEffect, useRef, useState } from 'react';
import type { EditingSession } from '../core/editingSession';
import type { NoteDraft } from '../model/noteDraft';
import { ColorSwatches } from './ColorSwatches';

type NoteEditorOverlayProps = Readonly<{
  session: EditingSession;
  onCommit: (draft: NoteDraft) => void;
  onCancel: () => void;
  onDelete: () => void;
}>;

export const NoteEditorOverlay = ({
  session,
  onCommit,
  onCancel,
  onDelete,
}: NoteEditorOverlayProps) => {
  const [draft, setDraft] = useState<NoteDraft>(session.draft);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
    textareaRef.current?.select();
  }, []);

  return (
    <form
      className={`note-editor-overlay ${draft.color}`}
      data-testid="note-editor"
      style={{
        transform: `translate(${session.screenPosition.x}px, ${session.screenPosition.y}px) translate(-50%, -50%)`,
      }}
      onSubmit={(event) => {
        event.preventDefault();
        onCommit(draft);
      }}
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
          setDraft((current) => ({ ...current, text }));
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          }
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            onCommit(draft);
          }
        }}
      />
      <div className="note-editor-tools">
        <ColorSwatches
          label="Note color"
          value={draft.color}
          onChange={(color) => {
            setDraft((current) => ({ ...current, color }));
          }}
        />
        <div className="note-editor-actions">
          <button type="button" className="danger" onClick={onDelete}>
            Delete
          </button>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit">Done</button>
        </div>
      </div>
    </form>
  );
};
