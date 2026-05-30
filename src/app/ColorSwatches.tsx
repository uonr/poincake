import type { NoteColor } from '../model/note';
import { NOTE_COLORS } from '../model/noteDraft';

type ColorSwatchesProps = Readonly<{
  label: string;
  value: NoteColor;
  onChange: (color: NoteColor) => void;
  className?: string;
}>;

export const ColorSwatches = ({ label, value, onChange, className }: ColorSwatchesProps) => (
  <fieldset className={['note-color-swatches', className].filter(Boolean).join(' ')}>
    <legend className="visually-hidden">{label}</legend>
    {NOTE_COLORS.map((color) => (
      <button
        aria-label={`${label}: ${color}`}
        className={color === value ? 'active' : undefined}
        data-color={color}
        key={color}
        type="button"
        onClick={() => onChange(color)}
      />
    ))}
  </fieldset>
);
