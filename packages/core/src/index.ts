export type {
  ConnectorDef,
  ConnectorResources,
  FieldDef,
  FieldType,
  InferFieldValue,
  InferRecord,
  ResourceSchema,
  StorageHandle,
  SyncContext,
} from './connector';

export { defineConnector } from './connector';

export type {
  AggFnForType,
  ConnectorConfigEntry,
  DashboardConfig,
  FilterClause,
  FilterCondition,
  FilterOperator,
  GroupByDef,
  MetricDef,
  NumberAggFn,
  ResolvedMetricDef,
  ScalarAggFn,
  WidgetDef,
} from './config';

export { defineConfig, defineMetric } from './config';
