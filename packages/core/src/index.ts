export type {
  Connector,
  ConnectorContext,
  ConnectorHealth,
  ConnectorRequestOptions,
  CredentialField,
  CredentialsSchema,
  InferCredentialInput,
  Distribution,
  DistributionQuery,
  Edge,
  EdgeQuery,
  Entity,
  EntityQuery,
  Event,
  EventQuery,
  InferCredentials,
  JSONValue,
  MetricSample,
  MetricQuery,
  StorageHandle,
  SyncOptions,
  SyncResult,
} from './connector';

export {
  BaseConnector,
  defineConnector,
  resolveBackfillCutoff,
} from './connector';

export {
  createDefaultConnectorLogger,
  noopConnectorLogger,
} from '@rawdash/connector-shared';
export type {
  ConnectorLogger,
  ConnectorLoggerOptions,
  LogFields,
} from '@rawdash/connector-shared';

export type {
  ChunkedSyncCursor,
  ChunkedSyncOptions,
  FetchPageResult,
} from './paginate-chunked';

export {
  makeChunkedCursorGuard,
  paginateChunked,
  selectActivePhases,
} from './paginate-chunked';

export type {
  AggFn,
  ConfiguredConnector,
  Dashboard,
  DashboardConfig,
  DistributionWidget,
  FilterClause,
  FilterCondition,
  FilterOperator,
  GroupBy,
  Metric,
  ComputedMetric,
  Shape,
  StatWidget,
  StatusWidget,
  TimeseriesWidget,
  Widget,
  WidgetKind,
} from './config';

export { defineConfig, defineDashboard, defineMetric } from './config';

export {
  aggFnSchema,
  distributionWidgetSchema,
  filterClauseSchema,
  filterConditionSchema,
  filterOperatorSchema,
  getWidgetSchema,
  groupBySchema,
  computedMetricSchema,
  shapeSchema,
  statWidgetSchema,
  statusWidgetSchema,
  timeseriesWidgetSchema,
  widgetSchema,
  widgetSchemas,
} from './widget-schemas';

export type { SyncState, SyncStatus } from './engine';
export { ACTIVE_SYNC_STATUSES, isSyncActive } from './engine';

export type {
  CachedWidget,
  DataSource,
  HealthResponse,
  ServerDataSource,
  TriggerSyncResponse,
  WidgetSyncState,
  WidgetsListResponse,
} from './wire';

export type { RetentionDeletionPlan, RetentionConfig } from './retention';

export { computeRetention, selectForDeletion } from './retention';

export type { Secret, SecretRef, SecretsResolver } from './secrets';

export {
  EnvSecretsResolver,
  extractSecretNames,
  isSecret,
  resolveSecrets,
  secret,
  secretRefSchema,
  withSecretRef,
} from './secrets';

export type { ConfigFieldsSchema } from './config-fields';

export { defineConfigFields } from './config-fields';

export type { ConnectorCategory, ConnectorDoc } from './connector-doc';

export {
  connectorCategorySchema,
  connectorDocSchema,
  defineConnectorDoc,
} from './connector-doc';

export type {
  ResourceDefinition,
  ResourceDefinitions,
  ResourceField,
} from './resource';

export { defineResources, schemasFromResources } from './resource';

export { computeMetric } from './compute';

export type { ConnectorBackfill, ResourceBackfill } from './backfill-window';

export { computeConnectorBackfill } from './backfill-window';

export { resolveWidget } from './resolve-widget';

export { computeWidgetEtag, hashWidgetConfig } from './widget-etag';

export type {
  ConnectorClass,
  ConnectorCost,
  ConnectorRegistry,
  ConnectorSchemas,
} from './registry';

export { instantiateConnector } from './registry';

export type { GetStorageHandleOptions, ServerStorage } from './server-storage';

export { withAbortSignal } from './storage-handle-guard';

export { InMemoryStorage } from './in-memory-storage';

export type { WireConfig, WireConnector, WireDashboard } from './wire-config';

export {
  toWireConfig,
  wireConfigSchema,
  wireConnectorSchema,
  wireDashboardSchema,
} from './wire-config';
