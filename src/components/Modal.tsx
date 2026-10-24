import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { IconX } from './icons';
import './Modal.css';

export interface ModalProps {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  /** Prevent closing via Escape/backdrop, e.g. while an irreversible action runs. */
  locked?: boolean;
  testId?: string;
}

/**
 * Accessible modal: focus trap, Escape to close, backdrop click, body scroll lock.
 * Uses a native <dialog> so mobile browsers get the right stacking behaviour.
 */
export function Modal({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  width = 640,
  locked = false,
  testId,
}: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      restoreFocus.current = document.activeElement as HTMLElement | null;
      // `showModal` is not implemented by every test environment / older browser,
      // so fall back to the `open` attribute instead of crashing the whole app.
      if (!dialog.open) {
        if (typeof dialog.showModal === 'function') dialog.showModal();
        else dialog.setAttribute('open', '');
      }
      document.body.classList.add('modal-open');
      const focusable = dialog.querySelector<HTMLElement>(
        'input, textarea, select, button, [href], [tabindex]:not([tabindex="-1"])',
      );
      focusable?.focus();
    } else {
      if (dialog.open) {
        if (typeof dialog.close === 'function') dialog.close();
        else dialog.removeAttribute('open');
      }
      document.body.classList.remove('modal-open');
      restoreFocus.current?.focus?.();
    }
    return () => {
      document.body.classList.remove('modal-open');
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !locked) {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, locked, onClose]);

  return (
    <dialog
      ref={dialogRef}
      className="modal"
      style={{ ['--modal-width' as string]: `${width}px` }}
      onCancel={(event) => {
        event.preventDefault();
        if (!locked) onClose();
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current && !locked) onClose();
      }}
      data-testid={testId}
      aria-label={title}
    >
      {open ? (
        <div className="modal__panel">
          <header className="modal__head">
            <div>
              <h2 className="modal__title">{title}</h2>
              {subtitle ? <p className="modal__subtitle">{subtitle}</p> : null}
            </div>
            <button
              type="button"
              className="icon-btn"
              onClick={onClose}
              disabled={locked}
              aria-label="关闭"
            >
              <IconX size={16} />
            </button>
          </header>
          <div className="modal__body">{children}</div>
          {footer ? <footer className="modal__foot">{footer}</footer> : null}
        </div>
      ) : null}
    </dialog>
  );
}
