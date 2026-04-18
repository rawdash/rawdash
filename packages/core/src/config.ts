import type { Connector, ConnectorResources, FieldType } from './connector';

// ---------------------------------------------------------------------------
// Aggregation functions
// ---------------------------------------------------------------------------

export type NumberAggFn =
  | 'count'
  | 'sum'
  | 'avg'
  | 'min'
  | 'max'
  | 'latest'
  | 'first';

export type ScalarAggFn = 'count' | 'latest' | 'first';

export type AggFnForType<T extends FieldType> = T extends 'number'
  ? NumberAggFn
  : ScalarAggFn;

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

export interface FilterCondition<
  TResources extends ConnectorResources,
  TResource extends keyof TResources & string,
> {
  field: keyof TResources[TResource]['fields'] & string;
  op: FilterOperator;
  value: string | number | boolean;
}

export type FilterClause<
  TResources extends ConnectorResources,
  TResource extends keyof TResources & string,
> =
  | FilterCondition<TResources, TResource>
  | { or: FilterCondition<TResources, TResource>[] };

// ---------------------------------------------------------------------------
// GroupBy
// ---------------------------------------------------------------------------

export interface GroupBy<
  TResources extends ConnectorResources,
  TResource extends keyof TResources & string,
> {
  field: keyof TResources[TResource]['fields'] & string;
  granularity: 'hour' | 'day' | 'week' | 'month';
}

// ---------------------------------------------------------------------------
// Metric definition
// ---------------------------------------------------------------------------

export interface Metric<
  TConnector extends { resources: ConnectorResources; id: string },
  TResource extends keyof TConnector['resources'] & string,
  TField extends keyof TConnector['resources'][TResource]['fields'] & string,
> {
  connector: TConnector;
  resource: TResource;
  field: TField;
  fn: AggFnForType<
    TConnector['resources'][TResource]['fields'][TField]['type']
  >;
  window?: string;
  filter?: Array<FilterClause<TConnector['resources'], TResource>>;
  groupBy?: GroupBy<TConnector['resources'], TResource>;
}

export interface ResolvedMetric {
  readonly connectorId: string;
  readonly resource: string;
  readonly field: string;
  readonly fn: string;
  readonly window?: string;
  readonly filter?: Array<
    | { field: string; op: FilterOperator; value: string | number | boolean }
    | {
        or: Array<{
          field: string;
          op: FilterOperator;
          value: string | number | boolean;
        }>;
      }
  >;
  readonly groupBy?: { field: string; granularity: string };
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

export function defineMetric<
  TConnector extends { resources: ConnectorResources; id: string },
  TResource extends keyof TConnector['resources'] & string,
  TField extends keyof TConnector['resources'][TResource]['fields'] & string,
>(options: Metric<TConnector, TResource, TField>): ResolvedMetric {
  return {
    connectorId: options.connector.id,
    resource: options.resource,
    field: options.field,
    fn: options.fn as string,
    window: options.window,
    filter: options.filter as ResolvedMetric['filter'],
    groupBy: options.groupBy as ResolvedMetric['groupBy'],
  };
}

// ---------------------------------------------------------------------------
// defineConfig
// ---------------------------------------------------------------------------

const VALID_FNS: Record<string, string[]> = {
  string: ['count', 'latest', 'first'],
  number: ['count', 'sum', 'avg', 'min', 'max', 'latest', 'first'],
  boolean: ['count', 'latest', 'first'],
  timestamp: ['count', 'latest', 'first'],
};

function validateConfig(config: DashboardConfig): void {
  const connectorMap = new Map(
    config.connectors.map((entry) => [entry.connector.id, entry.connector]),
  );

  for (const [widgetId, widget] of Object.entries(config.widgets)) {
    const { connectorId, resource, field, fn } = widget.metric;

    const connector = connectorMap.get(connectorId);
    if (!connector) {
      throw new Error(
        `Widget "${widgetId}": connector "${connectorId}" is not listed in connectors`,
      );
    }

    const resourceSchema = connector.resources[resource];
    if (!resourceSchema) {
      throw new Error(
        `Widget "${widgetId}": resource "${resource}" does not exist on connector "${connectorId}"`,
      );
    }

    const fieldSchema = resourceSchema.fields[field];
    if (!fieldSchema) {
      throw new Error(
        `Widget "${widgetId}": field "${field}" does not exist on resource "${resource}" of connector "${connectorId}"`,
      );
    }

    if (!VALID_FNS[fieldSchema.type]?.includes(fn)) {
      throw new Error(
        `Widget "${widgetId}": fn "${fn}" is not valid for field type "${fieldSchema.type}" — valid fns: ${VALID_FNS[fieldSchema.type]?.join(', ')}`,
      );
    }

    if (widget.metric.groupBy) {
      const groupByField = resourceSchema.fields[widget.metric.groupBy.field];
      if (!groupByField) {
        throw new Error(
          `Widget "${widgetId}": groupBy field "${widget.metric.groupBy.field}" does not exist on resource "${resource}"`,
        );
      }
      if (groupByField.type !== 'timestamp') {
        throw new Error(
          `Widget "${widgetId}": groupBy field "${widget.metric.groupBy.field}" must be a timestamp field (got "${groupByField.type}")`,
        );
      }
    }

    for (const clause of widget.metric.filter ?? []) {
      const conditions = 'or' in clause ? clause.or : [clause];
      for (const condition of conditions) {
        if (!resourceSchema.fields[condition.field]) {
          throw new Error(
            `Widget "${widgetId}": filter field "${condition.field}" does not exist on resource "${resource}"`,
          );
        }
      }
    }
  }
}

export function defineConfig(config: DashboardConfig): DashboardConfig {
  validateConfig(config);
  return config;
}
