import { autoUpdate, flip, offset, shift, useFloating } from '@floating-ui/react';
import { Download, Menu, Plus, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

const SOURCE_URL = 'https://github.com/uonr/poincake';

type AppMenuProps = Readonly<{
  onNew: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
}>;

export const AppMenu = ({ onNew, onExport, onImport }: AppMenuProps) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const { refs, floatingStyles } = useFloating({
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
    open,
    placement: 'bottom-start',
    whileElementsMounted: autoUpdate,
  });

  useEffect(() => {
    if (!open) {
      return;
    }

    const closeOnOutsidePointer = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node | null)) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const exportContent = (): void => {
    onExport();
    setOpen(false);
  };

  const newContent = (): void => {
    onNew();
    setOpen(false);
  };

  const openImportPicker = (): void => {
    if (importInputRef.current) {
      importInputRef.current.value = '';
      importInputRef.current.click();
    }
  };

  const importContent = (file: File | undefined): void => {
    if (!file) {
      return;
    }

    onImport(file);
    setOpen(false);
  };

  return (
    <div
      className="app-menu"
      data-testid="app-menu"
      ref={rootRef}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        ref={refs.setReference}
        type="button"
        className="app-menu-trigger"
        aria-label="Open menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Menu size={15} aria-hidden />
      </button>
      {open ? (
        <div className="app-menu-popover" ref={refs.setFloating} role="menu" style={floatingStyles}>
          <button className="app-menu-item" type="button" role="menuitem" onClick={newContent}>
            <Plus size={14} aria-hidden />
            New
          </button>
          <button className="app-menu-item" type="button" role="menuitem" onClick={exportContent}>
            <Download size={14} aria-hidden />
            Export
          </button>
          <button
            className="app-menu-item"
            type="button"
            role="menuitem"
            onClick={openImportPicker}
          >
            <Upload size={14} aria-hidden />
            Import
          </button>
          <a
            className="app-menu-item"
            href={SOURCE_URL}
            target="_blank"
            rel="noreferrer"
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            <GitHubMark />
            Source
          </a>
        </div>
      ) : null}
      <input
        ref={importInputRef}
        type="file"
        accept=".poin,.json,.gz,application/json,application/gzip"
        className="visually-hidden"
        tabIndex={-1}
        onChange={(event) => {
          importContent(event.currentTarget.files?.[0]);
        }}
      />
    </div>
  );
};

const GitHubMark = () => (
  <svg
    aria-label="GitHub"
    className="app-menu-github-mark"
    viewBox="0 0 16 16"
    width="14"
    height="14"
  >
    <path
      fill="currentColor"
      d="M8 1.2a6.8 6.8 0 0 0-2.15 13.25c.34.06.46-.14.46-.32v-1.2c-1.9.41-2.3-.82-2.3-.82-.3-.78-.76-.99-.76-.99-.62-.42.05-.41.05-.41.69.05 1.05.72 1.05.72.61 1.04 1.6.74 1.99.57.06-.44.24-.74.43-.91-1.52-.17-3.12-.76-3.12-3.38 0-.75.27-1.36.71-1.84-.07-.18-.31-.88.07-1.82 0 0 .58-.18 1.88.7A6.6 6.6 0 0 1 8 4.22c.58 0 1.16.08 1.7.23 1.3-.88 1.88-.7 1.88-.7.38.94.14 1.64.07 1.82.44.48.71 1.09.71 1.84 0 2.63-1.6 3.2-3.13 3.37.25.22.47.64.47 1.3v2.05c0 .18.12.39.47.32A6.8 6.8 0 0 0 8 1.2Z"
    />
  </svg>
);
