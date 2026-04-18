import { WidgetCard } from '@/components/widgets/widget-card';
import { rawdash } from '@/lib/rawdash';

import { SyncButton } from './sync-button';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  await rawdash.ensureFresh().catch((err: unknown) => {
    console.error('rawdash.ensureFresh failed', err);
  });
  const widgets = await rawdash.getWidgets().catch((err: unknown) => {
    console.error('rawdash.getWidgets failed', err);
    return [];
  });

  const cachedAt = widgets.reduce<string | null>((max, w) => {
    if (!w.cachedAt) return max;
    if (!max || w.cachedAt > max) return w.cachedAt;
    return max;
  }, null);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Dashboard</h2>
          <p className="text-muted-foreground">
            GitHub Actions — rawdash/rawdash
          </p>
          {cachedAt && (
            <p className="mt-1 text-xs text-muted-foreground">
              Last synced: {new Date(cachedAt).toLocaleString()}
            </p>
          )}
        </div>
        <SyncButton />
      </div>

      {widgets.length === 0 ? (
        <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-border bg-muted/30">
          <span className="text-sm text-muted-foreground">
            No data yet — start the Rawdash server and click Sync.
          </span>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {widgets.map((w) => (
            <WidgetCard key={`${w.connectorId}:${w.widgetId}`} widget={w} />
          ))}
        </div>
      )}
    </div>
  );
}
