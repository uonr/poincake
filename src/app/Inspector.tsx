import type { SelectionState } from '../core/selectionState';
import type { NoteColor } from '../model/note';
import { ColorSwatches } from './ColorSwatches';

type InspectorProps = Readonly<{
  selection: SelectionState;
  onEdit: () => void;
  onCenter: () => void;
  onDelete: () => void;
  onColorChange: (color: NoteColor) => void;
}>;

export const Inspector = ({
  selection,
  onEdit,
  onCenter,
  onDelete,
  onColorChange,
}: InspectorProps) => {
  const selectedNote = selection.selectedNote;
  if (!selectedNote) {
    return null;
  }

  return (
    <aside className="inspector" data-testid="inspector">
      <div className="inspector-note" data-testid="selected-note">
        {selectedNote.text}
      </div>
      <ColorSwatches
        label="Selected note color"
        value={selectedNote.color}
        onChange={onColorChange}
        className="inspector-swatches"
      />
      <div className="inspector-actions">
        <button type="button" onClick={onEdit}>
          Edit
        </button>
        <button type="button" onClick={onCenter}>
          Center
        </button>
        <button type="button" className="danger" onClick={onDelete}>
          Delete
        </button>
      </div>
    </aside>
  );
};
