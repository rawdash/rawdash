import type { Connector } from './connector';

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

export interface Widget {
  label?: string;
  metric: ResolvedMetric;
}

// ---------------------------------------------------------------------------
// Dashboard config
// ---------------------------------------------------------------------------

export interface ConnectorEntry {
  connector: Connector;
}

export interface DashboardConfig {
  connectors: ConnectorEntry[];
  widgets: Record<string, Widget>;
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

function validateConfig(config: DashboardConfig): void {
  const connectorIds = new Set(config.connectors.map((e) => e.connector.id));

  for (const [widgetId, widget] of Object.entries(config.widgets)) {
    const { connectorId, shape, fn } = widget.metric;

    if (!connectorIds.has(connectorId)) {
      throw new Error(
        `Widget "${widgetId}": connector "${connectorId}" is not listed in connectors`,
      );
    }

    if (!VALID_SHAPES.has(shape)) {
      throw new Error(`Widget "${widgetId}": invalid shape "${shape}"`);
    }

    if (!VALID_FNS.has(fn)) {
      throw new Error(`Widget "${widgetId}": invalid fn "${fn}"`);
    }
  }
}

export function defineConfig(config: DashboardConfig): DashboardConfig {
  validateConfig(config);
  return config;
}
