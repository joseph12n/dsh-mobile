import { useEffect, useId, useRef, type ReactNode } from 'react';
import { CloseIcon } from './icons.js';

export function Sheet({
  open,
  title,
  closeLabel,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) ref.current?.close();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') ref.current?.close();
      }}
    >
      <div className="sheet-inner">
        <header className="sheet-head">
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            className="ghost icon-button"
            aria-label={closeLabel}
            onClick={() => ref.current?.close()}
          >
            <CloseIcon />
          </button>
        </header>

        <div className="sheet-body">{children}</div>
      </div>
    </dialog>
  );
}
