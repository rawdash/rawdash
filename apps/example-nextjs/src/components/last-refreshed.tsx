'use client';

import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

interface LastRefreshedProps {
  timestamp: string;
  syncing?: boolean;
}

function formatRelative(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  return `${hr}h ago`;
}

export function LastRefreshed({ timestamp, syncing }: LastRefreshedProps) {
  const target = new Date(timestamp).getTime();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!Number.isFinite(target)) {
    return null;
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-400">
      {syncing && (
        <Loader2
          className="h-3 w-3 animate-spin text-gray-400"
          aria-label="Syncing"
        />
      )}
      Last refreshed {formatRelative(now - target)}
    </span>
  );
}
