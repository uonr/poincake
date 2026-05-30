import {
  autoUpdate,
  FloatingPortal,
  flip,
  offset,
  shift,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useRole,
} from '@floating-ui/react';
import type { ReactNode } from 'react';
import { useState } from 'react';

type TooltipProps = Readonly<{
  children: ReactNode;
  label: string;
}>;

export const Tooltip = ({ children, label }: TooltipProps) => {
  const [open, setOpen] = useState(false);
  const { context, floatingStyles, refs } = useFloating({
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
    onOpenChange: setOpen,
    open,
    placement: 'bottom-start',
    whileElementsMounted: autoUpdate,
  });
  const hover = useHover(context, { move: false });
  const focus = useFocus(context);
  const role = useRole(context, { role: 'tooltip' });
  const { getFloatingProps, getReferenceProps } = useInteractions([hover, focus, role]);

  return (
    <>
      <span className="tooltip-anchor" ref={refs.setReference} {...getReferenceProps()}>
        {children}
      </span>
      {open ? (
        <FloatingPortal>
          <div
            className="tooltip-popover"
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
          >
            {label}
          </div>
        </FloatingPortal>
      ) : null}
    </>
  );
};
