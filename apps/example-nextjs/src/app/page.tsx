'use client';

import { LastRefreshed } from '@/components/last-refreshed';
import { WidgetCard } from '@/components/widgets/widget-card';
import { rawdashSource } from '@/lib/rawdash';
import { useDashboard } from '@rawdash/sdk-nextjs/client';

export default function DashboardPage() {
  const { widgets } = useDashboard(rawdashSource, 'github');
  const list = Object.values(widgets);

  if (list.length === 0) {
    return (
      <div className="flex h-[calc(100vh-3rem)] items-center justify-center">
        <span className="text-sm text-gray-400">
          No data yet — sync is in progress.
        </span>
      </div>
    );
  }

  const cachedAtMs = list
    .map((w) => w.cachedAt)
    .filter((v): v is string => typeof v === 'string')
    .map((s) => new Date(s).getTime())
    .filter((ms) => Number.isFinite(ms));
  const lastRefresh =
    cachedAtMs.length > 0 ? new Date(Math.max(...cachedAtMs)) : new Date();

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <div className="mb-3 flex justify-end">
        <LastRefreshed timestamp={lastRefresh.toISOString()} />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((w) => (
          <WidgetCard key={`${w.connectorId}:${w.widgetId}`} widget={w} />
        ))}
      </div>
    </div>
  );
}
