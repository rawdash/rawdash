import type { CachedWidget } from '@rawdash/core';

import { StatWidget } from './stat-widget';
import { StatusWidget } from './status-widget';
import { TimeseriesWidget } from './timeseries-widget';

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
  const { widgetId, data, syncState } = widget;
  const label = widgetLabel(widgetId);

  if (data === null) {
    return (
      <UnsyncedPlaceholder label={label} syncState={syncState ?? 'unsynced'} />
    );
  }

  if (typeof data === 'string') {
    return <StatusWidget label={label} value={data} />;
  }

  if (typeof data === 'number') {
    return <StatWidget label={label} value={data} />;
  }

  if (isStatWithDelta(data)) {
    return <StatWidget label={label} value={data.value} trend={data.delta} />;
  }

  const timeseries = toTimeseriesEntries(data);
  if (timeseries) {
    return <TimeseriesWidget label={label} entries={timeseries} />;
  }

  return null;
}

function UnsyncedPlaceholder({
  label,
  syncState,
}: {
  label: string;
  syncState: NonNullable<CachedWidget['syncState']>;
}) {
  const message =
    syncState === 'syncing'
      ? 'Syncing…'
      : syncState === 'error'
        ? 'Sync failed'
        : 'Not yet synced';
  return (
    <div className="flex flex-col justify-between gap-3 rounded-xl border border-dashed border-gray-200 bg-white px-5 py-4 shadow-sm sm:px-6 sm:py-5">
      <span className="text-[11px] font-semibold uppercase tracking-widest text-gray-400">
        {label}
      </span>
      <span className="text-sm text-gray-400">{message}</span>
    </div>
  );
}
