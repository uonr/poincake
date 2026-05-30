import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { ArrowSelection } from '../core/arrowSelection';
import type { NoteColor } from '../model/note';
import { ColorSwatches } from './ColorSwatches';
import { useCanvasFloatingPosition } from './useCanvasFloatingPosition';

type ArrowInspectorProps = Readonly<{
  selection: ArrowSelection;
  onChangeColor: (color: NoteColor) => void;
  onChangeLabel: (label: string) => void;
  onDelete: () => void;
}>;

export const ArrowInspector = ({
  selection,
  onChangeColor,
  onChangeLabel,
  onDelete,
}: ArrowInspectorProps) => {
  const [label, setLabel] = useState(selection.label);
  const floating = useCanvasFloatingPosition({
    offsetPx: 14,
    placement: 'top',
    position: selection.screenPosition,
  });

  const commitLabel = (): void => {
    onChangeLabel(label.trim());
  };

  return (
    <div
      ref={floating.ref}
      className={`arrow-inspector ${selection.color}`}
      data-testid="arrow-inspector"
      style={floating.style}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <input
        className="arrow-inspector-label"
        aria-label="Arrow label"
        data-testid="arrow-label-input"
        value={label}
        placeholder="Label"
        onChange={(event) => setLabel(event.currentTarget.value)}
        onBlur={commitLabel}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commitLabel();
            event.currentTarget.blur();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
      />
      <div className="arrow-inspector-tools">
        <ColorSwatches label="Arrow color" value={selection.color} onChange={onChangeColor} />
        <button
          type="button"
          className="danger"
          aria-label="Delete arrow"
          title="Delete arrow"
          onClick={onDelete}
        >
          <Trash2 size={14} aria-hidden />
        </button>
      </div>
    </div>
  );
};
