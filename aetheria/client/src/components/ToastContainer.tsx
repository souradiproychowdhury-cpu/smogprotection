import React from 'react';
import { useAppStore } from '../store/useAppStore';

export const ToastContainer: React.FC = () => {
  const toasts = useAppStore((s) => s.toasts);
  const dismissToast = useAppStore((s) => s.dismissToast);

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="fixed bottom-20 lg:bottom-6 inset-x-4 lg:inset-x-auto lg:end-6 z-[70] flex flex-col gap-2 pointer-events-none max-w-md lg:w-96 mx-auto lg:mx-0"
    >
      {toasts.map((t) => {
        const colors =
          t.kind === 'error'
            ? 'bg-error-container text-on-error-container border-error/40'
            : t.kind === 'success'
            ? 'bg-secondary-container text-on-secondary-container border-secondary/40'
            : 'bg-surface-container-high text-on-surface border-primary/40';
        const icon =
          t.kind === 'error' ? 'error' : t.kind === 'success' ? 'check_circle' : 'info';

        return (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto rounded-xl px-4 py-3 shadow-2xl border backdrop-blur-xl flex items-center gap-3 ${colors}`}
          >
            <span className="material-symbols-outlined text-[20px] shrink-0">{icon}</span>
            <span className="font-body-sm text-body-sm font-medium flex-1">{t.message}</span>
            <button
              type="button"
              onClick={() => dismissToast(t.id)}
              aria-label="Dismiss notification"
              className="p-1 rounded-full hover:bg-black/15 shrink-0"
            >
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          </div>
        );
      })}
    </div>
  );
};
