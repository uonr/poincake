import {
  autoUpdate,
  flip,
  offset,
  type Placement,
  shift,
  useFloating,
  type VirtualElement,
} from '@floating-ui/react';
import { useLayoutEffect } from 'react';
import type { ScreenPoint } from '../core/editingSession';

type CanvasFloatingPositionOptions = Readonly<{
  position: ScreenPoint;
  placement: Placement;
  offsetPx?: number;
}>;

const VIEWPORT_PADDING = 8;

export const useCanvasFloatingPosition = ({
  position,
  placement,
  offsetPx = 0,
}: CanvasFloatingPositionOptions) => {
  const { refs, floatingStyles, update } = useFloating({
    middleware: [
      offset(offsetPx),
      flip({ padding: VIEWPORT_PADDING }),
      shift({ padding: VIEWPORT_PADDING }),
    ],
    placement,
    strategy: 'absolute',
    whileElementsMounted: autoUpdate,
  });

  useLayoutEffect(() => {
    const floating = refs.floating.current;
    const stage = floating?.closest('#stage') ?? null;
    const stageRect = stage?.getBoundingClientRect();
    const left = (stageRect?.left ?? 0) + position.x;
    const top = (stageRect?.top ?? 0) + position.y;

    const virtualPoint: VirtualElement = {
      contextElement: stage ?? undefined,
      getBoundingClientRect: () => ({
        bottom: top,
        height: 0,
        left,
        right: left,
        top,
        width: 0,
        x: left,
        y: top,
      }),
    };

    refs.setPositionReference(virtualPoint);
    void update();
  }, [position.x, position.y, refs, update]);

  return {
    ref: refs.setFloating,
    style: floatingStyles,
  };
};
