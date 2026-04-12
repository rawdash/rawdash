'use client';

import { RefreshCw } from 'lucide-react';
import { useTransition } from 'react';

import { triggerSync } from './actions';

export function SyncButton() {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      onClick={() => startTransition(() => triggerSync())}
      disabled={isPending}
      className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-muted disabled:opacity-60"
    >
      <RefreshCw className={`h-4 w-4 ${isPending ? 'animate-spin' : ''}`} />
      Sync
    </button>
  );
}
