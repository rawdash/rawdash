import type { DashboardConfig, Widget } from './config';

export interface ConnectorBackfill {
  requiredWindowMs: number | undefined;
}

const WINDOW_UNIT_MS: Record<string, number> = {
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
  m: 2_592_000_000,
};

function parseWindowMs(window: string): number | undefined {
  const match = /^(\d+)(h|d|w|m)$/.exec(window);
  if (!match) {
    return undefined;
  }
  const unitMs = WINDOW_UNIT_MS[match[2]!];
  if (unitMs === undefined) {
    return undefined;
  }
  return parseInt(match[1]!) * unitMs;
}

function widgetWindow(widget: Widget): string | undefined {
  switch (widget.kind) {
    case 'stat':
      return widget.window ?? widget.metric.window;
    case 'timeseries':
    case 'distribution':
      return widget.window;
    case 'status':
      return undefined;
  }
}

function widgetConnectorName(widget: Widget): string {
  if (widget.kind === 'status') {
    return widget.source;
  }
  return widget.metric.connectorId;
}

export function computeConnectorBackfill(
  config: DashboardConfig,
): Map<string, ConnectorBackfill> {
  const result = new Map<string, ConnectorBackfill>();
  for (const dashboard of Object.values(config.dashboards)) {
    for (const widget of Object.values(dashboard.widgets)) {
      const name = widgetConnectorName(widget);
      const windowStr = widgetWindow(widget);
      const windowMs = windowStr ? parseWindowMs(windowStr) : undefined;
      const existing = result.get(name);
      if (!existing) {
        result.set(name, { requiredWindowMs: windowMs });
        continue;
      }
      if (windowMs === undefined) {
        continue;
      }
      if (
        existing.requiredWindowMs === undefined ||
        windowMs > existing.requiredWindowMs
      ) {
        result.set(name, { requiredWindowMs: windowMs });
      }
    }
  }
  return result;
}
