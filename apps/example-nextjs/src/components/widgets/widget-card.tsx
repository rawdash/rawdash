import type { CachedWidgetResponse } from '@rawdash/nextjs';

import { StatWidget } from './stat-widget';
import { StatusWidget } from './status-widget';
import { TimeseriesWidget } from './timeseries-widget';

function widgetLabel(widgetId: string): string {
  return widgetId.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
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

  if (Array.isArray(data)) {
    return (
      <TimeseriesWidget
        label={label}
        entries={data as Array<{ date: string; count: number }>}
      />
    );
  }

  return null;
}
