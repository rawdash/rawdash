import { rawdash } from '@/lib/rawdash';
import type { CachedWidgetResponse } from '@rawdash/nextjs';

import { SyncButton } from './sync-button';

function widgetLabel(widgetId: string): string {
  return widgetId.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const STATUS_COLORS: Record<string, string> = {
  success: 'text-green-600',
  failure: 'text-red-600',
  cancelled: 'text-yellow-600',
  skipped: 'text-muted-foreground',
};

function WidgetCard({ widget }: { widget: CachedWidgetResponse }) {
  const { widgetId, data } = widget;
  const label = widgetLabel(widgetId);
  const isString = typeof data === 'string';
  const isNumber = typeof data === 'number';
  const colorClass = isString
    ? (STATUS_COLORS[data as string] ?? 'text-foreground')
    : 'text-foreground';

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-5 shadow-sm">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {isString && (
        <span
          className={`text-2xl font-bold capitalize leading-none ${colorClass}`}
        >
          {(data as string).replace(/_/g, ' ')}
        </span>
      )}
      {isNumber && (
        <span className="text-3xl font-bold leading-none">{String(data)}</span>
      )}
      {!isString && !isNumber && (
        <span className="text-sm text-muted-foreground">—</span>
      )}
    </div>
  );
}

export default async function DashboardPage() {
  let widgets: CachedWidgetResponse[] = [];
  try {
    widgets = await rawdash.getWidgets();
  } catch {
    // Server not reachable — show empty state
  }

  const cachedAt = widgets.find((w) => w.cachedAt)?.cachedAt;

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
