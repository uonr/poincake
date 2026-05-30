import { ArrowLeft, ArrowLeftRight, ArrowRight, Minus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { ArrowSelection } from '../core/arrowSelection';
import type { ArrowHeadMode } from '../model/arrow';
import type { NoteColor } from '../model/note';
import { ColorSwatches } from './ColorSwatches';
import { useCanvasFloatingPosition } from './useCanvasFloatingPosition';

type ArrowInspectorProps = Readonly<{
  selection: ArrowSelection;
  onChangeColor: (color: NoteColor) => void;
  onChangeHeadMode: (mode: ArrowHeadMode) => void;
  onChangeLabel: (label: string) => void;
  onDelete: () => void;
}>;

export const ArrowInspector = ({
  selection,
  onChangeColor,
  onChangeHeadMode,
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
      <fieldset className="arrow-endpoint-controls" aria-label="Arrow endpoints">
        <legend className="visually-hidden">Arrow endpoints</legend>
        {HEAD_MODE_OPTIONS.map((option) => {
          const Icon = option.icon;
          return (
            <button
              key={option.mode}
              type="button"
              className={selection.headMode === option.mode ? 'active' : undefined}
              aria-label={option.label}
              title={option.label}
              onClick={() => onChangeHeadMode(option.mode)}
            >
              <Icon size={14} aria-hidden />
            </button>
          );
        })}
      </fieldset>
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

const HEAD_MODE_OPTIONS: readonly {
  mode: ArrowHeadMode;
  label: string;
  icon: typeof Minus;
}[] = [
  { mode: 'none', label: 'No arrowheads', icon: Minus },
  { mode: 'start', label: 'Arrowhead at start', icon: ArrowLeft },
  { mode: 'end', label: 'Arrowhead at end', icon: ArrowRight },
  { mode: 'both', label: 'Arrowheads at both ends', icon: ArrowLeftRight },
];
