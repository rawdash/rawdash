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

function isTimeseriesArray(
  value: unknown,
): value is Array<{ date: string; count: number }> {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as Record<string, unknown>)['date'] === 'string' &&
        typeof (item as Record<string, unknown>)['count'] === 'number',
    )
  );
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

  if (isTimeseriesArray(data)) {
    return <TimeseriesWidget label={label} entries={data} />;
  }

  return null;
}
