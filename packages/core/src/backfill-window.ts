import type { DashboardConfig, Widget } from './config';

export interface ResourceBackfill {
  requiredWindowMs: number | undefined;
}

export type ConnectorBackfill = Map<string, ResourceBackfill>;

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

interface WidgetReference {
  connectorName: string;
  resourceName: string | undefined;
}

function widgetReference(widget: Widget): WidgetReference {
  if (widget.kind === 'status') {
    return { connectorName: widget.source, resourceName: undefined };
  }
  return {
    connectorName: widget.metric.connectorId,
    resourceName: widget.metric.name ?? widget.metric.entityType,
  };
}

function mergeWindow(
  existing: number | undefined,
  next: number | undefined,
): number | undefined {
  if (next === undefined) {
    return existing;
  }
  if (existing === undefined) {
    return next;
  }
  return Math.max(existing, next);
}

export function computeConnectorBackfill(
  config: DashboardConfig,
): Map<string, ConnectorBackfill> {
  const result = new Map<string, ConnectorBackfill>();
  for (const dashboard of Object.values(config.dashboards)) {
    for (const widget of Object.values(dashboard.widgets)) {
      const { connectorName, resourceName } = widgetReference(widget);
      const windowStr = widgetWindow(widget);
      const windowMs = windowStr ? parseWindowMs(windowStr) : undefined;
      let resources = result.get(connectorName);
      if (!resources) {
        resources = new Map<string, ResourceBackfill>();
        result.set(connectorName, resources);
      }
      if (resourceName === undefined) {
        continue;
      }
      const existing = resources.get(resourceName);
      resources.set(resourceName, {
        requiredWindowMs: mergeWindow(existing?.requiredWindowMs, windowMs),
      });
    }
  }
  return result;
}
