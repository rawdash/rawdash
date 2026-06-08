import type { FilterClause, FilterCondition, FilterOperator } from './filters';
import type { RetentionConfig } from './retention';
import { getWidgetSchema, widgetSchemas } from './widget-schemas';
import type { WidgetKind } from './widget-schemas';

export type { FilterClause, FilterCondition, FilterOperator };

export type AggFn =
  | 'count'
  | 'sum'
  | 'avg'
  | 'min'
  | 'max'
  | 'latest'
  | 'first';

export type Shape = 'event' | 'entity' | 'metric' | 'edge' | 'distribution';

export interface GroupBy {
  field: string;
  granularity: 'hour' | 'day' | 'week' | 'month';
}

export interface Metric {
  connector: { name: string };
  shape: Shape;
  name?: string;
  entityType?: string;
  field?: string;
  fn: AggFn;
  window?: string;
  filter?: FilterClause[];
  groupBy?: GroupBy;
}

export interface ComputedMetric {
  readonly connectorId: string;
  readonly shape: Shape;
  readonly name?: string;
  readonly entityType?: string;
  readonly field?: string;
  readonly fn: AggFn;
  readonly window?: string;
  readonly filter?: FilterClause[];
  readonly groupBy?: GroupBy;
}

export interface StatWidget {
  kind: 'stat';
  title: string;
  metric: ComputedMetric;
  window?: string;
  compare?: 'none' | 'previous-period';
}

export interface StatusWidget {
  kind: 'status';
  title: string;
  source: string;
}

export interface TimeseriesWidget {
  kind: 'timeseries';
  title: string;
  metric: ComputedMetric;
  window: string;
  granularity?: 'hour' | 'day' | 'week';
}

export interface DistributionWidget {
  kind: 'distribution';
  title: string;
  metric: ComputedMetric;
  window: string;
}

export type Widget =
  | StatWidget
  | StatusWidget
  | TimeseriesWidget
  | DistributionWidget;

export type { WidgetKind };

export interface ConfiguredConnector {
  name: string;
  connectorId: string;
  config: Record<string, unknown>;
  syncIntervalSeconds?: number;
  enabled?: boolean;
  displayName?: string;
}

export interface Dashboard {
  widgets: Record<string, Widget>;
}

export interface DashboardConfig {
  connectors: ConfiguredConnector[];
  dashboards: Record<string, Dashboard>;
  retention?: RetentionConfig;
}

const VALID_WIDGET_KINDS = new Set<string>(Object.keys(widgetSchemas));

export function defineDashboard(options: {
  widgets: Record<string, Widget>;
}): Dashboard {
  for (const [key, widget] of Object.entries(options.widgets)) {
    if (!VALID_WIDGET_KINDS.has(widget.kind)) {
      throw new Error(
        `Widget "${key}": unknown kind "${widget.kind}". Must be one of: ${[...VALID_WIDGET_KINDS].join(', ')}`,
      );
    }
    const schema = getWidgetSchema(widget.kind as WidgetKind);
    const result = schema.safeParse(widget);
    if (!result.success) {
      throw new Error(
        `Widget "${key}" (kind "${widget.kind}"): ${result.error.issues.map((i) => i.message).join('; ')}`,
      );
    }
  }
  return { widgets: options.widgets };
}

export function defineMetric(options: Metric): ComputedMetric {
  return {
    connectorId: options.connector.name,
    shape: options.shape,
    name: options.name,
    entityType: options.entityType,
    field: options.field,
    fn: options.fn,
    window: options.window,
    filter: options.filter,
    groupBy: options.groupBy,
  };
}

const VALID_SHAPES = new Set<string>([
  'event',
  'entity',
  'metric',
  'edge',
  'distribution',
]);
const VALID_FNS = new Set<string>([
  'count',
  'sum',
  'avg',
  'min',
  'max',
  'latest',
  'first',
]);

const SAFE_KEY_RE = /^[a-zA-Z0-9_-]+$/;

function validateConfig(config: DashboardConfig): void {
  if (config.retention) {
    const { maxAge, maxSize, floor, intervalMs } = config.retention;
    if (maxAge !== undefined && (!Number.isFinite(maxAge) || maxAge < 0)) {
      throw new Error('retention.maxAge must be a finite number >= 0');
    }
    if (maxSize !== undefined && (!Number.isInteger(maxSize) || maxSize < 0)) {
      throw new Error('retention.maxSize must be an integer >= 0');
    }
    if (floor !== undefined && (!Number.isInteger(floor) || floor < 0)) {
      throw new Error('retention.floor must be an integer >= 0');
    }
    if (
      intervalMs !== undefined &&
      (!Number.isFinite(intervalMs) || intervalMs <= 0)
    ) {
      throw new Error('retention.intervalMs must be a finite number > 0');
    }
  }

  if (
    !config.dashboards ||
    typeof config.dashboards !== 'object' ||
    Array.isArray(config.dashboards)
  ) {
    throw new Error(
      'defineConfig: config must include a "dashboards" record — did you mean to migrate from the old flat "widgets" shape?',
    );
  }

  if (!Array.isArray(config.connectors)) {
    throw new Error('defineConfig: "connectors" must be an array');
  }

  const connectorNames = new Set<string>();
  for (const entry of config.connectors) {
    if (!entry || typeof entry !== 'object') {
      throw new Error(
        'defineConfig: every connector entry must be an object with "name", "connectorId", and "config"',
      );
    }
    if (!entry.name) {
      throw new Error('defineConfig: every connector entry must have a "name"');
    }
    if (!entry.connectorId) {
      throw new Error(
        `defineConfig: connector "${entry.name}" must have a "connectorId" (the connector type id)`,
      );
    }
    if (
      entry.config === null ||
      typeof entry.config !== 'object' ||
      Array.isArray(entry.config)
    ) {
      throw new Error(
        `defineConfig: connector "${entry.name}" must have a "config" object`,
      );
    }
    if (connectorNames.has(entry.name)) {
      throw new Error(
        `defineConfig: duplicate connector name "${entry.name}". Each instance must have a unique name.`,
      );
    }
    connectorNames.add(entry.name);
  }

  for (const [dashboardKey, dashboard] of Object.entries(config.dashboards)) {
    if (
      !dashboard.widgets ||
      typeof dashboard.widgets !== 'object' ||
      Array.isArray(dashboard.widgets)
    ) {
      throw new Error(
        `Dashboard "${dashboardKey}" must define a "widgets" record`,
      );
    }

    if (!SAFE_KEY_RE.test(dashboardKey)) {
      throw new Error(
        `Dashboard key "${dashboardKey}" contains URL-unsafe characters; use only letters, digits, hyphens, and underscores`,
      );
    }

    for (const [widgetKey, widget] of Object.entries(dashboard.widgets)) {
      const ref = `Dashboard "${dashboardKey}", widget "${widgetKey}"`;

      if (!SAFE_KEY_RE.test(widgetKey)) {
        throw new Error(
          `${ref}: widget key contains URL-unsafe characters; use only letters, digits, hyphens, and underscores`,
        );
      }

      if (widget.kind === 'status') {
        continue;
      }

      const { connectorId, shape, fn } = widget.metric;

      if (!connectorNames.has(connectorId)) {
        throw new Error(
          `${ref}: connector "${connectorId}" is not listed in connectors`,
        );
      }

      if (!VALID_SHAPES.has(shape)) {
        throw new Error(`${ref}: invalid shape "${shape}"`);
      }

      if (!VALID_FNS.has(fn)) {
        throw new Error(`${ref}: invalid fn "${fn}"`);
      }
    }
  }
}

export function defineConfig(config: DashboardConfig): DashboardConfig {
  validateConfig(config);
  return config;
}
