'use client';

import { useEffect, useState } from 'react';

interface WaitingForFirstSyncProps {
  cachedAt: string | null;
  delayMs: number;
}

export function WaitingForFirstSync({
  cachedAt,
  delayMs,
}: WaitingForFirstSyncProps) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    setShow(false);
    const id = setTimeout(() => setShow(true), delayMs);
    return () => clearTimeout(id);
  }, [cachedAt, delayMs]);

  if (!show) return null;
  return (
    <span className="text-[11px] text-gray-400">
      Waiting for first sync — check server logs
    </span>
  );
}
