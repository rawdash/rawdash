'use client';

import { useState } from 'react';

interface ReconnectingWidgetProps {
  label: string;
  lastError: string | null;
}

export function ReconnectingWidget({
  label,
  lastError,
}: ReconnectingWidgetProps) {
  const [expanded, setExpanded] = useState(false);
  const hasDetail = lastError !== null && lastError.length > 0;

  return (
    <div className="flex flex-col justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/40 px-5 py-4 shadow-sm sm:px-6 sm:py-5">
      <span className="text-[11px] font-semibold uppercase tracking-widest text-gray-400">
        {label}
      </span>
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-amber-500" />
        <span className="text-sm font-medium text-amber-700">
          Reconnecting…
        </span>
      </div>
      {hasDetail && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-left text-xs text-amber-600 underline-offset-2 hover:underline"
        >
          {expanded ? 'Hide details' : 'Show details'}
        </button>
      )}
      {hasDetail && expanded && (
        <pre className="whitespace-pre-wrap break-words rounded-md bg-amber-100/60 px-2 py-1.5 text-[11px] text-amber-800">
          {lastError}
        </pre>
      )}
    </div>
  );
}
