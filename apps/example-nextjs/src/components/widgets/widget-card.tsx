import type { CachedWidgetResponse } from '@rawdash/nextjs';

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
  widget: CachedWidgetResponse;
}

export function WidgetCard({ widget }: WidgetCardProps) {
  const { widgetId, data } = widget;
  const label = widgetLabel(widgetId);

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
