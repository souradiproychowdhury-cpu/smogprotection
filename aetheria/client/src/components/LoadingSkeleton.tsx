import React from 'react';

export const GlassSkeleton: React.FC<{ lines?: number; className?: string }> = ({
  lines = 3,
  className = ''
}) => (
  <div className={`rounded-2xl bg-surface-container/70 p-4 space-y-3 animate-pulse gilded-rim ${className}`}>
    <div className="h-4 w-2/5 rounded bg-surface-container-highest" />
    {Array.from({ length: lines }).map((_, i) => (
      <div
        key={i}
        className={`h-3 rounded bg-surface-container-high ${i === lines - 1 ? 'w-3/4' : 'w-full'}`}
      />
    ))}
  </div>
);

export const ErrorRetryCard: React.FC<{
  message: string;
  onRetry: () => void;
  retryLabel?: string;
}> = ({ message, onRetry, retryLabel = 'Retry' }) => (
  <div
    role="alert"
    className="rounded-2xl bg-error-container/25 border border-error/40 p-4 flex items-center justify-between gap-3"
  >
    <div className="flex items-start gap-2.5 min-w-0">
      <span className="material-symbols-outlined text-error text-[20px] shrink-0 mt-0.5">warning</span>
      <p className="font-body-sm text-body-sm text-on-error-container">{message}</p>
    </div>
    <button
      type="button"
      onClick={onRetry}
      className="shrink-0 px-3 py-1.5 rounded-lg bg-error text-on-error font-label-md text-label-md font-semibold hover:brightness-110 transition"
    >
      {retryLabel}
    </button>
  </div>
);
