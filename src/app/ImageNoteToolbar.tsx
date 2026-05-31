import { Trash2 } from 'lucide-react';
import type { ScreenPoint } from '../core/editingSession';

type ImageNoteToolbarProps = Readonly<{
  position: ScreenPoint;
  onDelete: () => void;
}>;

// `position` is the image's top-right corner in stage coordinates; the button is
// centered on it (see CSS translate) so it straddles the corner.
export const ImageNoteToolbar = ({ position, onDelete }: ImageNoteToolbarProps) => (
  <div
    className="image-note-toolbar"
    data-testid="image-note-toolbar"
    style={{ left: position.x, top: position.y }}
    onPointerDown={(event) => event.stopPropagation()}
  >
    <button
      type="button"
      className="danger"
      aria-label="Delete image"
      title="Delete image"
      onClick={onDelete}
    >
      <Trash2 size={18} aria-hidden />
    </button>
  </div>
);
