import type { ConnectorDef, ConnectorResources, FieldType } from './connector';

// ---------------------------------------------------------------------------
// Aggregation functions
// ---------------------------------------------------------------------------

/**
 * Aggregation functions valid for `number` fields.
 *
 * - `count`  — number of matching records
 * - `sum`    — sum of field values
 * - `avg`    — arithmetic mean of field values
 * - `min`    — minimum field value
 * - `max`    — maximum field value
 * - `latest` — value from the most recent record (by insertion order or timestamp)
 * - `first`  — value from the earliest record
 */
export type NumberAggFn =
  | 'count'
  | 'sum'
  | 'avg'
  | 'min'
  | 'max'
  | 'latest'
  | 'first';

/**
 * Aggregation functions valid for `string`, `boolean`, and `timestamp` fields.
 *
 * - `count`  — number of matching records
 * - `latest` — value from the most recent record
 * - `first`  — value from the earliest record
 */
export type ScalarAggFn = 'count' | 'latest' | 'first';

/**
 * Maps a `FieldType` literal to the set of aggregation functions that are
 * valid for it.  TypeScript enforces this at the call site of `defineMetric`.
 */
export type AggFnForType<T extends FieldType> = T extends 'number'
  ? NumberAggFn
  : ScalarAggFn;

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

/**
 * Comparison operators supported in filter conditions.
 *
 * - `eq` / `neq`         — equality / inequality
 * - `gt` / `gte`         — greater than / greater than or equal
 * - `lt` / `lte`         — less than / less than or equal
 * - `contains`           — substring match (string fields only)
 */
export type FilterOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains';

/**
 * A single condition comparing one field to a literal value.
 *
 * ```ts
 * { field: 'conclusion', op: 'eq', value: 'success' }
 * ```
 */
export type FilterCondition<
  TResources extends ConnectorResources,
  TResource extends keyof TResources & string,
> = {
  field: keyof TResources[TResource]['fields'] & string;
  op: FilterOperator;
  value: string | number | boolean;
};

/**
 * A filter clause is either a single `FilterCondition` (AND-semantics when
 * multiple clauses are present in the array) or an `{ or: [...] }` group.
 *
 * **AND example** (conclusion is success AND status is completed):
 * ```ts
 * filter: [
 *   { field: 'conclusion', op: 'eq', value: 'success' },
 *   { field: 'status',     op: 'eq', value: 'completed' },
 * ]
 * ```
 *
 * **OR example** (conclusion is success OR failure):
 * ```ts
 * filter: [
 *   { or: [
 *     { field: 'conclusion', op: 'eq', value: 'success' },
 *     { field: 'conclusion', op: 'eq', value: 'failure' },
 *   ]},
 * ]
 * ```
 */
export type FilterClause<
  TResources extends ConnectorResources,
  TResource extends keyof TResources & string,
> =
  | FilterCondition<TResources, TResource>
  | { or: FilterCondition<TResources, TResource>[] };

// ---------------------------------------------------------------------------
// GroupBy
// ---------------------------------------------------------------------------

/**
 * Groups metric results by a timestamp field at the given granularity,
 * producing a time-series array instead of a scalar.
 *
 * Only timestamp fields are valid as `field`.  The result shape is:
 * `Array<{ [field]: string; value: number }>`.
 *
 * ```ts
 * groupBy: { field: 'created_at', granularity: 'day' }
 * ```
 */
export type GroupByDef<
  TResources extends ConnectorResources,
  TResource extends keyof TResources & string,
> = {
  field: keyof TResources[TResource]['fields'] & string;
  granularity: 'hour' | 'day' | 'week' | 'month';
};

// ---------------------------------------------------------------------------
// Metric definition
// ---------------------------------------------------------------------------

/**
 * A fully-typed metric definition that references a specific connector,
 * resource, and field, with the aggregation function constrained to what
 * is valid for that field's type.
 *
 * Pass this to `defineMetric` for type checking; do not construct it directly.
 */
export type MetricDef<
  TConnector extends ConnectorDef<unknown, ConnectorResources>,
  TResource extends keyof TConnector['resources'] & string,
  TField extends keyof TConnector['resources'][TResource]['fields'] & string,
> = {
  connector: TConnector;
  resource: TResource;
  field: TField;
  fn: AggFnForType<
    TConnector['resources'][TResource]['fields'][TField]['type']
  >;
  /**
   * Time window for the aggregation, expressed as a duration string.
   * Only records whose timestamp field (the `groupBy.field`, or the first
   * `timestamp`-typed field in the resource) falls within this window are
   * included.
   *
   * Examples: `'1h'`, `'7d'`, `'30d'`, `'90d'`
   */
  window?: string;
  filter?: Array<FilterClause<TConnector['resources'], TResource>>;
  groupBy?: GroupByDef<TConnector['resources'], TResource>;
};

/**
 * Runtime representation of a metric after `defineMetric` validates it.
 * All connector/resource/field references are flattened to plain strings
 * so the engine can resolve them without the generic types.
 */
export type ResolvedMetricDef = {
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
};

// ---------------------------------------------------------------------------
// Widget definition
// ---------------------------------------------------------------------------

/**
 * A single widget displayed on the dashboard.
 *
 * ```ts
 * {
 *   label: 'CI Pass Rate (7d)',
 *   metric: defineMetric({
 *     connector: GitHubActionsConnector,
 *     resource:  'workflow_run',
 *     field:     'conclusion',
 *     fn:        'count',
 *     window:    '7d',
 *     filter:    [{ field: 'conclusion', op: 'eq', value: 'success' }],
 *   }),
 * }
 * ```
 */
export type WidgetDef = {
  label?: string;
  metric: ResolvedMetricDef;
};

// ---------------------------------------------------------------------------
// Dashboard config
// ---------------------------------------------------------------------------

/**
 * A connector paired with its resolved configuration (credentials, options).
 */
export type ConnectorConfigEntry<
  TConfig = unknown,
  TResources extends ConnectorResources = ConnectorResources,
> = {
  connector: ConnectorDef<TConfig, TResources>;
  config: TConfig;
};

/**
 * The complete dashboard configuration produced by `defineConfig`.
 *
 * - `connectors` — connector instances with their configs
 * - `widgets`    — named widget definitions referencing connector resources
 */
export type DashboardConfig = {
  connectors: ConnectorConfigEntry[];
  widgets: Record<string, WidgetDef>;
};

// ---------------------------------------------------------------------------
// defineMetric
// ---------------------------------------------------------------------------

/**
 * Creates a type-safe metric definition, constraining `fn` to the set of
 * aggregation functions valid for the referenced field's type.
 *
 * TypeScript will error at the call site if:
 * - `resource` is not a valid resource name for the connector
 * - `field` is not a valid field name for the resource
 * - `fn` is not valid for the field's type (e.g. `sum` on a string field)
 * - `filter.field` is not a valid field name for the resource
 * - `groupBy.field` is not a valid field name for the resource
 *
 * ```ts
 * defineMetric({
 *   connector: GitHubActionsConnector,
 *   resource:  'workflow_run',
 *   field:     'id',
 *   fn:        'count',
 *   window:    '7d',
 * })
 * ```
 */
export function defineMetric<
  TConnector extends ConnectorDef<unknown, ConnectorResources>,
  TResource extends keyof TConnector['resources'] & string,
  TField extends keyof TConnector['resources'][TResource]['fields'] & string,
>(options: MetricDef<TConnector, TResource, TField>): ResolvedMetricDef {
  return {
    connectorId: options.connector.id,
    resource: options.resource,
    field: options.field,
    fn: options.fn as string,
    window: options.window,
    filter: options.filter as ResolvedMetricDef['filter'],
    groupBy: options.groupBy as ResolvedMetricDef['groupBy'],
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

/**
 * Declares and validates a complete dashboard configuration.
 *
 * Validation runs at config load time (both TypeScript compile-time via
 * `defineMetric` generics and at runtime via this function).  Any mismatch
 * between widget metric definitions and connector resource schemas throws
 * immediately, before any sync runs.
 *
 * ```ts
 * export default defineConfig({
 *   connectors: [
 *     { connector: GitHubActionsConnector, config: { owner, repo, token } },
 *   ],
 *   widgets: {
 *     run_count_7d: {
 *       label: 'Runs (7d)',
 *       metric: defineMetric({
 *         connector: GitHubActionsConnector,
 *         resource:  'workflow_run',
 *         field:     'id',
 *         fn:        'count',
 *         window:    '7d',
 *       }),
 *     },
 *   },
 * });
 * ```
 */
export function defineConfig(config: DashboardConfig): DashboardConfig {
  validateConfig(config);
  return config;
}
