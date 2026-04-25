import { WidgetCard } from '@/components/widgets/widget-card';
import { rawdash } from '@/lib/rawdash';

import { SyncButton } from './sync-button';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  await rawdash.ensureFresh().catch((err: unknown) => {
    console.error('rawdash.ensureFresh failed', err);
  });
  const widgets = await rawdash.getWidgets('github').catch((err: unknown) => {
    console.error('rawdash.getWidgets failed', err);
    return [];
  });

  const cachedAt = widgets.reduce<string | null>((max, w) => {
    if (!w.cachedAt) return max;
    if (!max || w.cachedAt > max) return w.cachedAt;
    return max;
  }, null);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-gray-900 sm:text-2xl">
            Dashboard
          </h2>
          <p className="text-sm text-gray-500">
            GitHub Actions — rawdash/rawdash
          </p>
          {cachedAt && (
            <p className="mt-0.5 text-xs text-gray-400">
              Last synced: {new Date(cachedAt).toLocaleString()}
            </p>
          )}
        </div>
        <SyncButton />
      </div>

      {widgets.length === 0 ? (
        <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50">
          <span className="text-sm text-gray-400">
            No data yet — start the Rawdash server and click Sync.
          </span>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {widgets.map((w) => (
            <WidgetCard key={`${w.connectorId}:${w.widgetId}`} widget={w} />
          ))}
        </div>
      )}
    </div>
  );
}
