import type { CachedWidget, WidgetSeries } from '@rawdash/core';
import { Skeleton } from '@rawdash/sdk-nextjs/skeleton';

import { FailingWidget } from './failing-widget';
import { NoDataWidget } from './no-data-widget';
import { StatWidget } from './stat-widget';
import { StatusWidget } from './status-widget';
import { TimeseriesWidget } from './timeseries-widget';
import { WaitingForFirstSync } from './waiting-for-first-sync';

function widgetLabel(widgetId: string): string {
  return widgetId.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function isStatWithDelta(
  value: unknown,
): value is { value: number; delta: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>)['value'] === 'number' &&
    typeof (value as Record<string, unknown>)['delta'] === 'number'
  );
}

function toTimeseriesEntries(
  value: unknown,
): Array<{ date: string; count: number }> | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const entries: Array<{ date: string; count: number }> = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) return null;
    const row = item as Record<string, unknown>;
    const date =
      typeof row['date'] === 'string'
        ? row['date']
        : typeof row['created_at'] === 'string'
          ? row['created_at']
          : null;
    const count =
      typeof row['count'] === 'number'
        ? row['count']
        : typeof row['value'] === 'number'
          ? row['value']
          : null;
    if (date === null || count === null) return null;
    entries.push({ date, count });
  }
  return entries;
}

interface WidgetCardProps {
  widget: CachedWidget;
}

export function WidgetCard({ widget }: WidgetCardProps) {
  const {
    widgetId,
    data,
    series,
    status,
    errorMessage,
    syncState,
    meta,
    cachedAt,
  } = widget;
  const label = widgetLabel(widgetId);

  if (status === 'error' || syncState === 'failing') {
    const connectorStatus =
      typeof meta?.['connectorStatus'] === 'string'
        ? meta['connectorStatus']
        : 'error';
    const lastError =
      errorMessage ??
      (typeof meta?.['lastError'] === 'string' ? meta['lastError'] : null);
    return (
      <FailingWidget
        label={label}
        status={connectorStatus}
        lastError={lastError}
      />
    );
  }

  const stale = syncState === 'stale' || syncState === 'syncing';

  const hasRenderableSeries =
    series?.some((s) => Array.isArray(s.data) || typeof s.data === 'number') ??
    false;
  if (hasRenderableSeries) {
    const timeseries = series!
      .map((s) => ({
        key: s.key,
        label: s.label,
        entries: toTimeseriesEntries(s.data),
      }))
      .filter(
        (
          s,
        ): s is {
          key: string;
          label: string;
          entries: { date: string; count: number }[];
        } => s.entries !== null,
      );
    if (timeseries.length > 0) {
      return (
        <TimeseriesWidget label={label} series={timeseries} stale={stale} />
      );
    }
    return <MultiStatWidget label={label} series={series!} stale={stale} />;
  }

  if (data === null) {
    return (
      <SkeletonCard
        label={label}
        syncState={syncState ?? 'unsynced'}
        cachedAt={cachedAt}
      />
    );
  }

  if (status === 'no_data') {
    return <NoDataWidget label={label} stale={stale} />;
  }

  if (typeof data === 'string') {
    return <StatusWidget label={label} value={data} stale={stale} />;
  }

  if (typeof data === 'number') {
    return <StatWidget label={label} value={data} stale={stale} />;
  }

  if (isStatWithDelta(data)) {
    return (
      <StatWidget
        label={label}
        value={data.value}
        trend={data.delta}
        stale={stale}
      />
    );
  }

  const timeseries = toTimeseriesEntries(data);
  if (timeseries) {
    return (
      <TimeseriesWidget label={label} entries={timeseries} stale={stale} />
    );
  }

  return null;
}

function MultiStatWidget({
  label,
  series,
  stale,
}: {
  label: string;
  series: WidgetSeries[];
  stale?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-gray-100 bg-white px-5 py-4 shadow-sm sm:px-6 sm:py-5">
      <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-gray-400">
        {label}
      </span>
      <div className="flex flex-col gap-2">
        {series.map((s) => (
          <div key={s.key} className="flex items-baseline justify-between">
            <span className="text-xs text-gray-500">{s.label}</span>
            <span className="text-lg font-semibold text-gray-900">
              {typeof s.data === 'number'
                ? s.data.toLocaleString()
                : String(s.data ?? '—')}
            </span>
          </div>
        ))}
      </div>
      {stale && <span className="text-[10px] text-amber-500">stale</span>}
    </div>
  );
}

function SkeletonCard({
  label,
  syncState,
  cachedAt,
}: {
  label: string;
  syncState: NonNullable<CachedWidget['syncState']>;
  cachedAt: string | null;
}) {
  return (
    <div className="flex flex-col justify-between gap-3 rounded-xl border border-gray-100 bg-white px-5 py-4 shadow-sm sm:px-6 sm:py-5">
      <span className="text-[11px] font-semibold uppercase tracking-widest text-gray-400">
        {label}
      </span>
      <Skeleton height="2.5rem" width="60%" />
      {syncState === 'unsynced' && (
        <WaitingForFirstSync cachedAt={cachedAt} delayMs={30_000} />
      )}
    </div>
  );
}
