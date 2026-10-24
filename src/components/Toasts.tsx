import { useEffect } from 'react';
import type { Toast } from '../state/useSubtitleStore';
import { IconAlert, IconCheck, IconInfo, IconX } from './icons';

export interface ToastsProps {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}

const TONE_ICON = {
  ok: <IconCheck size={14} />,
  warn: <IconAlert size={14} />,
  error: <IconAlert size={14} />,
  info: <IconInfo size={14} />,
} as const;

export function Toasts({ toasts, onDismiss }: ToastsProps) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(toast.id), toast.tone === 'error' ? 7000 : 4200);
    return () => window.clearTimeout(timer);
  }, [toast.id, toast.tone, onDismiss]);

  return (
    <div className={`toast toast--${toast.tone}`} data-testid="toast">
      <span className="toast__icon">{TONE_ICON[toast.tone]}</span>
      <span className="toast__message">{toast.message}</span>
      <button type="button" className="toast__close" onClick={() => onDismiss(toast.id)} aria-label="关闭提示">
        <IconX size={13} />
      </button>
    </div>
  );
}
