import type { CoordinateNotePreview } from '../interaction/controller';
import { useCanvasFloatingPosition } from './useCanvasFloatingPosition';

type CoordinateNotePreviewPopoverProps = Readonly<{
  preview: CoordinateNotePreview;
}>;

export const CoordinateNotePreviewPopover = ({ preview }: CoordinateNotePreviewPopoverProps) => {
  const floating = useCanvasFloatingPosition({
    offsetPx: 12,
    placement: 'top',
    position: preview.screenPosition,
  });

  return (
    <div
      ref={floating.ref}
      className={`coordinate-note-preview ${preview.color}`}
      data-testid="coordinate-note-preview"
      role="tooltip"
      style={floating.style}
    >
      {preview.text}
    </div>
  );
};
