import { Check, Clipboard } from 'lucide-react';
import { useState } from 'react';
import {
  type CoordinateTarget,
  coordinateTargetTitle,
  formatCoordinateTarget,
} from '../core/coordinateIndicator';

type CoordinateIndicatorProps = Readonly<{
  target: CoordinateTarget | null;
}>;

export const CoordinateIndicator = ({ target }: CoordinateIndicatorProps) => {
  const [copiedCoordinate, setCopiedCoordinate] = useState<string | null>(null);
  if (!target) {
    return null;
  }

  const coordinate = formatCoordinateTarget(target);
  const copied = copiedCoordinate === coordinate;

  const copyCoordinate = async (): Promise<void> => {
    await navigator.clipboard.writeText(coordinate);
    setCopiedCoordinate(coordinate);
  };

  return (
    <button
      type="button"
      className="coordinate-indicator"
      data-testid="coordinate-indicator"
      title={coordinate}
      onClick={() => {
        void copyCoordinate();
      }}
    >
      {copied ? <Check size={14} aria-hidden /> : <Clipboard size={14} aria-hidden />}
      <span className="coordinate-indicator-title">{coordinateTargetTitle(target)}</span>
      <code>{coordinate}</code>
    </button>
  );
};
