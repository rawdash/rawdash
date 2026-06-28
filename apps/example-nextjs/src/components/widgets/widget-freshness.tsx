'use client';

import { useEffect, useState } from 'react';

interface WidgetFreshnessProps {
  cachedAt: string | null;
}

function describe(ageMs: number): { color: string; label: string } {
  const minutes = ageMs / 60_000;
  if (minutes < 5) return { color: 'bg-emerald-500', label: 'Fresh' };
  if (minutes < 10) return { color: 'bg-amber-500', label: 'Aging' };
  return { color: 'bg-red-500', label: 'Stale' };
}

function formatAge(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 60) return `${sec}s ago`;
  const minutes = Math.round(sec / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

export function WidgetFreshness({ cachedAt }: WidgetFreshnessProps) {
  const target = cachedAt ? new Date(cachedAt).getTime() : NaN;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!Number.isFinite(target)) {
    return null;
  }

  const age = now - target;
  const { color, label } = describe(age);
  const hint = `${label} — updated ${formatAge(age)}`;

  return (
    <span className="group relative inline-flex">
      <span
        className={`block h-2.5 w-2.5 rounded-full ring-2 ring-white ${color}`}
        role="img"
        aria-label={hint}
      />
      <span className="pointer-events-none absolute right-0 top-full z-20 mt-1.5 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-[11px] font-medium text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100">
        {hint}
      </span>
    </span>
  );
}
