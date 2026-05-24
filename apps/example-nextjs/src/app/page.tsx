import { AutoRefresh } from '@/components/auto-refresh';
import { LastRefreshed } from '@/components/last-refreshed';
import { WidgetCard } from '@/components/widgets/widget-card';
import { rawdash } from '@/lib/rawdash';

export const revalidate = 60;

const REFRESH_INTERVAL_MS = 60_000;

export default async function DashboardPage() {
  void rawdash.ensureFresh(60_000).catch((err: unknown) => {
    console.warn('rawdash.ensureFresh failed', err);
  });
  const widgets = await rawdash.getWidgets('github').catch((err: unknown) => {
    console.error('rawdash.getWidgets failed', err);
    return [];
  });

  if (widgets.length === 0) {
    return (
      <div className="flex h-[calc(100vh-3rem)] items-center justify-center">
        <span className="text-sm text-gray-400">
          No data yet — sync is in progress.
        </span>
      </div>
    );
  }

  const cachedAts = widgets
    .map((w) => w.cachedAt)
    .filter((v): v is string => typeof v === 'string');
  const lastRefresh =
    cachedAts.length > 0
      ? new Date(Math.max(...cachedAts.map((s) => new Date(s).getTime())))
      : new Date();

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <AutoRefresh intervalMs={REFRESH_INTERVAL_MS} />
      <div className="mb-3 flex justify-end">
        <LastRefreshed timestamp={lastRefresh.toISOString()} />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {widgets.map((w) => (
          <WidgetCard key={`${w.connectorId}:${w.widgetId}`} widget={w} />
        ))}
      </div>
    </div>
  );
}
