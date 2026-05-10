import type { Connector } from './connector';
import type { RetentionConfig } from './retention';
import { getWidgetSchema, widgetSchemas } from './widget-schemas';
import type { WidgetKind } from './widget-schemas';

// ---------------------------------------------------------------------------
// Aggregation functions
// ---------------------------------------------------------------------------

export type AggFn =
  | 'count'
  | 'sum'
  | 'avg'
  | 'min'
  | 'max'
  | 'latest'
  | 'first';

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

export type Shape = 'event' | 'entity' | 'metric' | 'edge' | 'distribution';

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export type FilterOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains';

export interface FilterCondition {
  field: string;
  op: FilterOperator;
  value: string | number | boolean;
}

export type FilterClause = FilterCondition | { or: FilterCondition[] };

// ---------------------------------------------------------------------------
// GroupBy
// ---------------------------------------------------------------------------

export interface GroupBy {
  field: string;
  granularity: 'hour' | 'day' | 'week' | 'month';
}

// ---------------------------------------------------------------------------
// Metric definition
// ---------------------------------------------------------------------------

export interface MetricDef {
  connector: { id: string };
  shape: Shape;
  name?: string;
  entityType?: string;
  field: string;
  fn: AggFn;
  window?: string;
  filter?: FilterClause[];
  groupBy?: GroupBy;
}

export interface ResolvedMetric {
  readonly connectorId: string;
  readonly shape: Shape;
  readonly name?: string;
  readonly entityType?: string;
  readonly field: string;
  readonly fn: string;
  readonly window?: string;
  readonly filter?: FilterClause[];
  readonly groupBy?: GroupBy;
}

// ---------------------------------------------------------------------------
// Widget definition
// ---------------------------------------------------------------------------

export interface StatWidget {
  kind: 'stat';
  title: string;
  metric: ResolvedMetric;
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
  metric: ResolvedMetric;
  window: string;
  granularity?: 'hour' | 'day' | 'week';
}

export interface DistributionWidget {
  kind: 'distribution';
  title: string;
  metric: ResolvedMetric;
  window: string;
}

export type Widget =
  | StatWidget
  | StatusWidget
  | TimeseriesWidget
  | DistributionWidget;

export type { WidgetKind };

// ---------------------------------------------------------------------------
// Dashboard config
// ---------------------------------------------------------------------------

export interface ConnectorEntry {
  connector: Connector;
}

export interface Dashboard {
  widgets: Record<string, Widget>;
}

export interface DashboardConfig {
  connectors: ConnectorEntry[];
  dashboards: Record<string, Dashboard>;
  retention?: RetentionConfig;
}

// ---------------------------------------------------------------------------
// defineDashboard
// ---------------------------------------------------------------------------

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
    const parseInput: Record<string, unknown> = { ...widget };
    if (widget.kind !== 'status') {
      const m = (widget as { metric?: unknown }).metric;
      if (typeof m !== 'object' || m === null) {
        throw new Error(
          `Widget "${key}" (kind "${widget.kind}"): metric is required`,
        );
      }
      parseInput.metric = 'placeholder';
    }
    const result = schema.safeParse(parseInput);
    if (!result.success) {
      throw new Error(
        `Widget "${key}" (kind "${widget.kind}"): ${result.error.issues.map((i) => i.message).join('; ')}`,
      );
    }
  }
  return { widgets: options.widgets };
}

// ---------------------------------------------------------------------------
// defineMetric
// ---------------------------------------------------------------------------

export function defineMetric(options: MetricDef): ResolvedMetric {
  return {
    connectorId: options.connector.id,
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

// ---------------------------------------------------------------------------
// defineConfig
// ---------------------------------------------------------------------------

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

  const connectorIds = new Set(config.connectors.map((e) => e.connector.id));

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

      if (!connectorIds.has(connectorId)) {
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
