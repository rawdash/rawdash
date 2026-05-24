'use client';

import { useState } from 'react';

interface FailingWidgetProps {
  label: string;
  status: string;
  lastError: string | null;
}

export function FailingWidget({
  label,
  status,
  lastError,
}: FailingWidgetProps) {
  const [expanded, setExpanded] = useState(false);
  const hasDetail = lastError !== null && lastError.length > 0;

  return (
    <div className="flex flex-col justify-between gap-3 rounded-xl border border-red-200 bg-red-50/40 px-5 py-4 shadow-sm sm:px-6 sm:py-5">
      <span className="text-[11px] font-semibold uppercase tracking-widest text-gray-400">
        {label}
      </span>
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-red-500" />
        <span className="text-sm font-medium capitalize text-red-700">
          {status.replace(/_/g, ' ')}
        </span>
      </div>
      {hasDetail && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-left text-xs text-red-600 underline-offset-2 hover:underline"
        >
          {expanded ? 'Hide details' : 'Show details'}
        </button>
      )}
      {hasDetail && expanded && (
        <pre className="whitespace-pre-wrap break-words rounded-md bg-red-100/60 px-2 py-1.5 text-[11px] text-red-800">
          {lastError}
        </pre>
      )}
    </div>
  );
}
