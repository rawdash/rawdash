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
  RollupBucket,
  RollupPartials,
  RollupQuery,
  StorageHandle,
  SyncOptions,
  SyncResult,
} from './connector';

export {
  BaseConnector,
  defineConnector,
  resolveBackfillCutoff,
  resolveSpecCutoff,
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
  DEFAULT_MAX_CHUNK_MS,
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
  WidgetFormat,
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
  widgetFormatSchema,
  widgetSchema,
  widgetSchemas,
} from './widget-schemas';

export type { ResolvedWidgetFormat } from './wire';

export { currencyScaleFromUnit } from './format';

export type { SyncState, SyncStatus } from './engine';
export {
  ACTIVE_SYNC_STATUSES,
  healthStatusFromSyncStatus,
  isSyncActive,
} from './engine';

export type {
  CachedWidget,
  DataSource,
  HealthResponse,
  ServerDataSource,
  TriggerSyncResponse,
  WidgetStatus,
  WidgetSyncState,
  WidgetsListResponse,
} from './wire';

export type {
  RetentionDeletionPlan,
  RetentionConfig,
  RetentionSpec,
} from './retention';

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
  ResourceFilterField,
} from './resource';

export { defineResources, schemasFromResources } from './resource';
export { metricSample } from './metric-emit';
export type {
  MetricAttributeKeys,
  MetricAttributes,
  MetricSampleInput,
} from './metric-emit';

export type {
  MetricIssueSeverity,
  MetricValidationIssue,
  MetricValidationResult,
  ResourcesByConnectorId,
} from './validate-metrics';

export {
  formatMetricIssues,
  resourcesByConnectorIdFromRegistry,
  validateConfigMetrics,
} from './validate-metrics';

export { computeMetric, computeMetricWithStatus } from './compute';
export type { MetricComputation } from './compute';

export type {
  ConnectorRollupSpecs,
  FoldResult,
  RollupReadResult,
  RollupSignature,
  RollupSpec,
} from './rollup';

export {
  aggFromPartials,
  computeRollupSpecs,
  dimsKey,
  emptyPartials,
  foldConnectorRollups,
  foldResourceRollups,
  foldValueIntoPartials,
  isRollupShape,
  mergePartials,
  tryComputeMetricFromRollups,
} from './rollup';

export type { Granularity } from './time-buckets';

export {
  bucketStartMs,
  finerGranularity,
  nextBucketStartMs,
  parseWindowMs,
  truncateToGranularity,
} from './time-buckets';

export type {
  ConnectorBackfill,
  FetchSpec,
  ResourceBackfill,
} from './backfill-window';

export {
  computeConnectorBackfill,
  fetchSpecsForConnector,
} from './backfill-window';

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
export { withMetricResourceGuard } from './metric-guard';

export { InMemoryStorage } from './in-memory-storage';

export type { WireConfig, WireConnector, WireDashboard } from './wire-config';

export {
  toWireConfig,
  wireConfigSchema,
  wireConnectorSchema,
  wireDashboardSchema,
} from './wire-config';
