import {
  ARM_HOST,
  BaseAzureConnector,
  type BaseAzureSettings,
  isAllowedArmUrl,
  mapArmError,
} from '@rawdash/connector-azure-shared';
import {
  type HttpResponse,
  connectorUserAgent,
  parseEpoch,
} from '@rawdash/connector-shared';
import {
  type ConnectorContext,
  type ConnectorDoc,
  type Entity,
  type FetchSpec,
  type FilterClause,
  type JSONValue,
  type MetricSample,
  type StorageHandle,
  type SyncOptions,
  type SyncResult,
  defineConfigFields,
  defineConnectorDoc,
  defineResources,
  schemasFromResources,
} from '@rawdash/core';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// configFields
// ---------------------------------------------------------------------------

const aggregationValues = [
  'Average',
  'Minimum',
  'Maximum',
  'Total',
  'Count',
] as const;
type Aggregation = (typeof aggregationValues)[number];

const intervalValues = [
  'PT1M',
  'PT5M',
  'PT15M',
  'PT30M',
  'PT1H',
  'PT6H',
  'PT12H',
  'P1D',
] as const;
type Interval = (typeof intervalValues)[number];

const metricQuerySchema = z.object({
  id: z
    .string()
    .regex(
      /^[a-z][a-zA-Z0-9_]*$/,
      'Azure Monitor query id must start with a lowercase letter and contain only letters, digits, and underscores',
    ),
  resourceUri: z
    .string()
    .min(1)
    .regex(
      /^\/subscriptions\/[^/]+\/resourceGroups\/[^/]+\/providers\/.+$/,
      'resourceUri must be an ARM resource id starting with /subscriptions/<id>/resourceGroups/<rg>/providers/...',
    ),
  metricNamespace: z.string().min(1),
  metric: z.string().min(1),
  aggregation: z.enum(aggregationValues),
  interval: z.enum(intervalValues),
});

export const configFields = defineConfigFields(
  z
    .object({
      tenantId: z.string().min(1).meta({
        label: 'Tenant ID',
        description:
          'Microsoft Entra ID (Azure AD) tenant ID - the directory that hosts the app registration.',
        placeholder: '00000000-0000-0000-0000-000000000000',
      }),
      clientId: z.string().min(1).meta({
        label: 'Client ID',
        description:
          'Application (client) ID of the Entra ID app registration / service principal used for authentication.',
        placeholder: '00000000-0000-0000-0000-000000000000',
      }),
      clientSecret: z.object({ $secret: z.string().min(1) }).meta({
        label: 'Client secret',
        description:
          'Client secret of the Entra ID app registration. Generate one under App registrations → Certificates & secrets.',
        placeholder: 'azure-client-secret',
        secret: true,
      }),
      subscriptionId: z.string().min(1).meta({
        label: 'Subscription ID',
        description:
          'Azure subscription ID that scopes every metric query and alert listing. Resource URIs in `metricQueries` must live inside this subscription.',
        placeholder: '00000000-0000-0000-0000-000000000000',
      }),
      metricQueries: z.array(metricQuerySchema).nonempty().meta({
        label: 'Metric queries',
        description:
          'Azure Monitor is too broad to mirror wholesale; declare the specific resource+metric combinations to pull. Each query needs an id, the full resource URI, the metric namespace, the metric name, an aggregation (Average / Minimum / Maximum / Total / Count), and an ISO 8601 interval (e.g. PT1H, P1D).',
      }),
      resources: z
        .array(z.enum(['metric_queries', 'alerts']))
        .nonempty()
        .optional()
        .meta({
          label: 'Resources',
          description:
            'Which Azure Monitor resources to sync. Omit to sync all of them.',
        }),
      lookbackMinutes: z.number().int().positive().max(40_320).optional().meta({
        label: 'Lookback (minutes)',
        description:
          'How far back to pull metric data points on a full sync when the host does not supply a since bound. Defaults to 180.',
        placeholder: '180',
      }),
    })
    .refine(
      (cfg) =>
        new Set(cfg.metricQueries.map((q) => q.id)).size ===
        cfg.metricQueries.length,
      {
        path: ['metricQueries'],
        message: 'Each metric query id must be unique',
      },
    )
    .superRefine((cfg, ctx) => {
      const expected = cfg.subscriptionId.toLowerCase();
      cfg.metricQueries.forEach((query, index) => {
        const subscription = query.resourceUri
          .match(/^\/subscriptions\/([^/]+)\//)?.[1]
          ?.toLowerCase();
        if (subscription !== expected) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['metricQueries', index, 'resourceUri'],
            message:
              'resourceUri must live inside the configured subscriptionId',
          });
        }
      });
    }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'Azure Monitor',
  category: 'infrastructure',
  brandColor: '#0078D4',
  tagline:
    'Pull declared Azure Monitor metric time series and resource alerts into the six-shape storage model.',
  vendor: {
    name: 'Microsoft Azure',
    domain: 'azure.microsoft.com',
    apiDocs: 'https://learn.microsoft.com/en-us/rest/api/monitor/',
    website: 'https://azure.microsoft.com/en-us/products/monitor',
  },
  auth: {
    summary:
      'Authenticates with a Microsoft Entra ID (Azure AD) service principal (tenant ID + client ID + client secret) scoped to the target subscription. The principal needs the built-in Monitoring Reader role at the subscription (or resource group) level.',
    setup: [
      'In the Azure portal open Microsoft Entra ID → App registrations → New registration and create an app for rawdash.',
      'Under Certificates & secrets, generate a client secret and copy its value (it is only shown once).',
      'In the target subscription open Access control (IAM) → Add role assignment and grant the new service principal the built-in Monitoring Reader role (Reader is also sufficient).',
      'Store the client secret as a secret and reference it from config as `clientSecret: secret("AZ_CLIENT_SECRET")`, alongside `tenantId`, `clientId`, and `subscriptionId`.',
      'Each entry in `metricQueries` needs the full ARM resource URI (`/subscriptions/<sub>/resourceGroups/<rg>/providers/...`) of the resource the metric belongs to.',
    ],
  },
  rateLimit:
    'Azure Resource Manager enforces per-tenant and per-subscription read throttling and signals it via 429 responses with Retry-After; the shared HTTP client honors Retry-After and backs off on 429.',
  limitations: [
    'Azure Monitor is too broad to mirror wholesale; only the metrics declared in `metricQueries` are synced; there is no automatic resource discovery.',
    'Only the standard Metrics REST API is supported; Log Analytics (KQL) and Application Insights queries are out of scope for v1.',
    'A single metric query pulls one aggregation per call; declare a second query with a different `aggregation` if you need both (e.g. Average and Maximum).',
    'Alerts are pulled from the Alerts Management API at subscription scope; classic alert rules and the legacy Activity Log alerts are not synced.',
  ],
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AzureMonitorMetricQuery {
  id: string;
  resourceUri: string;
  metricNamespace: string;
  metric: string;
  aggregation: Aggregation;
  interval: Interval;
}

export type AzureMonitorResource = 'metric_queries' | 'alerts';

export interface AzureMonitorSettings extends BaseAzureSettings {
  metricQueries: readonly AzureMonitorMetricQuery[];
  resources?: readonly AzureMonitorResource[];
  lookbackMinutes?: number;
}

// ---------------------------------------------------------------------------
// API response schemas
// ---------------------------------------------------------------------------

const metricDatapointSchema = z.object({
  timeStamp: z.string(),
  average: z.number().optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  total: z.number().optional(),
  count: z.number().optional(),
});

const metricsResponseSchema = z.object({
  timespan: z.string().optional(),
  interval: z.string().optional(),
  namespace: z.string().optional(),
  resourceregion: z.string().optional(),
  value: z.array(
    z.object({
      id: z.string().optional(),
      type: z.string().optional(),
      name: z.object({
        value: z.string(),
        localizedValue: z.string().optional(),
      }),
      unit: z.string().optional(),
      timeseries: z
        .array(
          z.object({
            metadatavalues: z
              .array(
                z.object({
                  name: z
                    .object({
                      value: z.string(),
                      localizedValue: z.string().optional(),
                    })
                    .optional(),
                  value: z.string().optional(),
                }),
              )
              .optional(),
            data: z.array(metricDatapointSchema).optional(),
          }),
        )
        .optional(),
    }),
  ),
});

const alertEssentialsSchema = z.object({
  severity: z.string().optional(),
  signalType: z.string().optional(),
  alertState: z.string().optional(),
  monitorCondition: z.string().optional(),
  monitorService: z.string().optional(),
  targetResource: z.string().optional(),
  targetResourceType: z.string().optional(),
  targetResourceGroup: z.string().optional(),
  alertRule: z.string().optional(),
  sourceCreatedId: z.string().optional(),
  smartGroupId: z.string().optional(),
  smartGroupingReason: z.string().optional(),
  startDateTime: z.string().optional(),
  lastModifiedDateTime: z.string().optional(),
  monitorConditionResolvedDateTime: z.string().optional(),
  description: z.string().optional(),
});

const alertSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  type: z.string().optional(),
  properties: z
    .object({
      essentials: alertEssentialsSchema.optional(),
    })
    .optional(),
});

const alertsResponseSchema = z.object({
  value: z.array(alertSchema).optional(),
  nextLink: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Runtime response shapes (permissive — assertions live in the Zod schemas)
// ---------------------------------------------------------------------------

interface MetricDatapoint {
  timeStamp?: string;
  average?: number;
  minimum?: number;
  maximum?: number;
  total?: number;
  count?: number;
}

interface MetricSeriesMetadata {
  name?: { value?: string };
  value?: string;
}

interface MetricSeries {
  metadatavalues?: MetricSeriesMetadata[];
  data?: MetricDatapoint[];
}

interface MetricEntry {
  id?: string;
  type?: string;
  unit?: string;
  name?: { value?: string; localizedValue?: string };
  timeseries?: MetricSeries[];
}

interface MetricsResponseBody {
  timespan?: string;
  interval?: string;
  namespace?: string;
  value?: MetricEntry[];
}

interface AlertEssentials {
  severity?: string;
  signalType?: string;
  alertState?: string;
  monitorCondition?: string;
  monitorService?: string;
  targetResource?: string;
  targetResourceType?: string;
  targetResourceGroup?: string;
  alertRule?: string;
  startDateTime?: string;
  lastModifiedDateTime?: string;
  monitorConditionResolvedDateTime?: string;
  description?: string;
}

interface AlertEntry {
  id?: string;
  name?: string;
  type?: string;
  properties?: { essentials?: AlertEssentials };
}

interface AlertsResponseBody {
  value?: AlertEntry[];
  nextLink?: string;
}

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

const ALERT_ENTITY = 'azure_alert';

export const azureMonitorResources = defineResources({
  '<metricNamespace>/<metric>': {
    shape: 'metric',
    dynamic: true,
    description:
      'One metric series per declared Azure Monitor metric query. The series name is the query metric namespace/metric (e.g. `Microsoft.Compute/virtualMachines/Percentage CPU`), so the actual keys depend on the configured `metricQueries`. Each sample carries the query aggregation, interval, query id, the metric unit, and any series metadata as attributes.',
    endpoint: 'GET {resourceUri}/providers/Microsoft.Insights/metrics',
    granularity: 'Per query interval',
    notes:
      'Each sync replaces the full set of samples for the metric names it owns (idempotent).',
    dimensions: [
      {
        name: 'aggregation',
        description:
          'The aggregation requested for the query (Average / Minimum / Maximum / Total / Count).',
      },
      {
        name: 'interval',
        description:
          'ISO 8601 aggregation interval of the data points (e.g. PT1H, P1D).',
      },
      {
        name: 'queryId',
        description:
          'The configured id of the metric query that produced the sample.',
      },
      {
        name: 'resourceUri',
        description:
          'ARM resource id whose metrics were queried (the resource the sample belongs to).',
      },
      {
        name: 'unit',
        description: 'Unit reported by Azure Monitor (e.g. Percent, Bytes).',
      },
    ],
    responses: { metrics: metricsResponseSchema },
  },
  [ALERT_ENTITY]: {
    shape: 'entity',
    filterable: [
      {
        field: 'severity',
        ops: ['eq'],
        values: ['Sev0', 'Sev1', 'Sev2', 'Sev3', 'Sev4'],
      },
      {
        field: 'state',
        ops: ['eq'],
        values: ['New', 'Acknowledged', 'Closed'],
      },
      {
        field: 'monitorCondition',
        ops: ['eq'],
        values: ['Fired', 'Resolved'],
      },
    ],
    description:
      'Azure Monitor alerts at subscription scope. Upserted by alert id.',
    endpoint:
      'GET /subscriptions/{subId}/providers/Microsoft.AlertsManagement/alerts',
    fields: [
      { name: 'name', description: 'Alert display name.' },
      { name: 'severity', description: 'Alert severity (Sev0 - Sev4).' },
      {
        name: 'state',
        description: 'Alert state (New, Acknowledged, Closed).',
      },
      {
        name: 'monitorCondition',
        description: 'Monitor condition (Fired, Resolved).',
      },
      {
        name: 'monitorService',
        description: 'Source service (e.g. Platform, ApplicationInsights).',
      },
      {
        name: 'signalType',
        description: 'Signal type (Metric, Log, Activity Log).',
      },
      {
        name: 'targetResource',
        description: 'Full ARM resource id the alert is scoped to.',
      },
      {
        name: 'targetResourceType',
        description: 'ARM type of the target resource.',
      },
      {
        name: 'targetResourceGroup',
        description: 'Resource group of the target resource.',
      },
      {
        name: 'alertRule',
        description: 'ARM id of the alert rule that fired this alert.',
      },
      {
        name: 'startedAt',
        description: 'When the alert first fired (Unix ms).',
      },
      {
        name: 'resolvedAt',
        description: 'When the alert was resolved (Unix ms), if it was.',
      },
    ],
    responses: { alerts: alertsResponseSchema },
  },
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const METRICS_API_VERSION = '2024-02-01';
const ALERTS_API_VERSION = '2019-05-05-preview';
const DEFAULT_LOOKBACK_MINUTES = 180;
const MS_PER_MINUTE = 60_000;

const RESOURCE_ORDER: readonly AzureMonitorResource[] = [
  'metric_queries',
  'alerts',
];

// ---------------------------------------------------------------------------
// Pure helpers — exported for unit testing
// ---------------------------------------------------------------------------

export function computeMetricsTimespan(
  options: SyncOptions,
  lookbackMinutes: number,
  now: number = Date.now(),
): string {
  const endMs = now;
  let startMs: number;
  if (options.since) {
    const sinceMs = parseEpoch(options.since, 'iso');
    if (sinceMs !== null) {
      startMs = Math.min(sinceMs, endMs);
    } else {
      startMs = endMs - lookbackMinutes * MS_PER_MINUTE;
    }
  } else if (options.mode === 'latest') {
    // One hour of headroom catches at least one P1D / PT1H bucket on incremental
    // ticks without overfetching when the host is polling frequently.
    startMs = endMs - 60 * MS_PER_MINUTE;
  } else {
    startMs = endMs - lookbackMinutes * MS_PER_MINUTE;
  }
  return `${new Date(startMs).toISOString()}/${new Date(endMs).toISOString()}`;
}

function metadataAttrs(
  series: MetricSeries | undefined,
): Record<string, JSONValue> {
  const out: Record<string, JSONValue> = {};
  if (!series?.metadatavalues) {
    return out;
  }
  for (const m of series.metadatavalues) {
    const key = m.name?.value;
    if (typeof key !== 'string' || key.length === 0) {
      continue;
    }
    out[key] = m.value ?? null;
  }
  return out;
}

function pickValue(
  point: MetricDatapoint,
  aggregation: Aggregation,
): number | null {
  switch (aggregation) {
    case 'Average':
      return typeof point.average === 'number' ? point.average : null;
    case 'Minimum':
      return typeof point.minimum === 'number' ? point.minimum : null;
    case 'Maximum':
      return typeof point.maximum === 'number' ? point.maximum : null;
    case 'Total':
      return typeof point.total === 'number' ? point.total : null;
    case 'Count':
      return typeof point.count === 'number' ? point.count : null;
  }
}

export function buildMetricSamples(
  body: MetricsResponseBody,
  query: AzureMonitorMetricQuery,
): MetricSample[] {
  const samples: MetricSample[] = [];
  const name = `${query.metricNamespace}/${query.metric}`;
  for (const entry of body.value ?? []) {
    const unit = entry.unit ?? null;
    for (const series of entry.timeseries ?? []) {
      const baseAttrs: Record<string, JSONValue> = {
        ...metadataAttrs(series),
        aggregation: query.aggregation,
        interval: query.interval,
        queryId: query.id,
        resourceUri: query.resourceUri,
        unit,
      };
      for (const point of series.data ?? []) {
        if (typeof point.timeStamp !== 'string') {
          continue;
        }
        const ts = parseEpoch(point.timeStamp, 'iso');
        if (ts === null) {
          continue;
        }
        const value = pickValue(point, query.aggregation);
        if (value === null || !Number.isFinite(value)) {
          continue;
        }
        samples.push({
          name,
          ts,
          value,
          attributes: { ...baseAttrs },
        });
      }
    }
  }
  return samples;
}

function pushableEq(
  filter: FilterClause[] | undefined,
  field: string,
): string | null {
  if (!filter) {
    return null;
  }
  for (const clause of filter) {
    if (
      'field' in clause &&
      clause.field === field &&
      clause.op === 'eq' &&
      typeof clause.value === 'string'
    ) {
      return clause.value;
    }
  }
  return null;
}

export function buildAlertEntities(body: AlertsResponseBody): Entity[] {
  const entities: Entity[] = [];
  for (const alert of body.value ?? []) {
    if (typeof alert.id !== 'string' || alert.id.length === 0) {
      continue;
    }
    const essentials = alert.properties?.essentials ?? {};
    const startedAt =
      typeof essentials.startDateTime === 'string'
        ? parseEpoch(essentials.startDateTime, 'iso')
        : null;
    const resolvedAt =
      typeof essentials.monitorConditionResolvedDateTime === 'string'
        ? parseEpoch(essentials.monitorConditionResolvedDateTime, 'iso')
        : null;
    const lastModified =
      typeof essentials.lastModifiedDateTime === 'string'
        ? parseEpoch(essentials.lastModifiedDateTime, 'iso')
        : null;
    entities.push({
      type: ALERT_ENTITY,
      id: alert.id,
      attributes: {
        name: alert.name ?? null,
        severity: essentials.severity ?? null,
        state: essentials.alertState ?? null,
        monitorCondition: essentials.monitorCondition ?? null,
        monitorService: essentials.monitorService ?? null,
        signalType: essentials.signalType ?? null,
        targetResource: essentials.targetResource ?? null,
        targetResourceType: essentials.targetResourceType ?? null,
        targetResourceGroup: essentials.targetResourceGroup ?? null,
        alertRule: essentials.alertRule ?? null,
        description: essentials.description ?? null,
        startedAt,
        resolvedAt,
      },
      updated_at: lastModified ?? startedAt ?? Date.now(),
    });
  }
  return entities;
}

// ---------------------------------------------------------------------------
// AzureMonitorConnector
// ---------------------------------------------------------------------------

export const id = 'azure-monitor';

export class AzureMonitorConnector extends BaseAzureConnector<AzureMonitorSettings> {
  static readonly id = id;

  static readonly resources = azureMonitorResources;

  static readonly schemas = schemasFromResources(azureMonitorResources);

  static create(input: unknown, ctx?: ConnectorContext): AzureMonitorConnector {
    const parsed = configFields.parse(input);
    return new AzureMonitorConnector(
      {
        tenantId: parsed.tenantId,
        clientId: parsed.clientId,
        subscriptionId: parsed.subscriptionId,
        metricQueries: parsed.metricQueries,
        resources: parsed.resources,
        lookbackMinutes: parsed.lookbackMinutes,
      },
      { clientSecret: parsed.clientSecret },
      ctx,
    );
  }

  readonly id = id;
  private async armGet<T>(
    url: string,
    resource: string,
    signal?: AbortSignal,
  ): Promise<HttpResponse<T>> {
    const token = await this.getAccessToken(signal);
    let res: HttpResponse<T>;
    try {
      res = await this.get<T>(url, {
        resource,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'User-Agent': connectorUserAgent(this.id),
        },
        signal,
      });
    } catch (err) {
      throw mapArmError(err);
    }
    return res;
  }

  // -------------------------------------------------------------------------
  // metric_queries
  // -------------------------------------------------------------------------

  private buildMetricsUrl(
    query: AzureMonitorMetricQuery,
    timespan: string,
  ): string {
    const params = new URLSearchParams();
    params.set('api-version', METRICS_API_VERSION);
    params.set('metricnames', query.metric);
    params.set('metricnamespace', query.metricNamespace);
    params.set('aggregation', query.aggregation);
    params.set('interval', query.interval);
    params.set('timespan', timespan);
    return `${ARM_HOST}${query.resourceUri}/providers/Microsoft.Insights/metrics?${params.toString()}`;
  }

  private async syncMetricQueries(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const queries = this.settings.metricQueries;
    if (queries.length === 0) {
      return true;
    }
    const lookback = this.settings.lookbackMinutes ?? DEFAULT_LOOKBACK_MINUTES;
    const timespan = computeMetricsTimespan(options, lookback);
    const names = new Set<string>(
      queries.map((q) => `${q.metricNamespace}/${q.metric}`),
    );
    const samples: MetricSample[] = [];
    let pages = 0;
    const phaseStart = Date.now();

    for (const query of queries) {
      if (signal?.aborted) {
        return false;
      }
      const url = this.buildMetricsUrl(query, timespan);
      const res = await this.armGet<MetricsResponseBody>(
        url,
        'metrics',
        signal,
      );
      const chunk = buildMetricSamples(res.body, query);
      samples.push(...chunk);
      pages += 1;
      this.logger.info('fetched page', {
        resource: 'metrics',
        page: pages,
        items: chunk.length,
        queryId: query.id,
      });
    }

    await storage.metrics(samples, { names: [...names] });
    this.logger.info('resource done', {
      resource: 'metrics',
      pages,
      items: samples.length,
      duration_ms: Date.now() - phaseStart,
    });
    return true;
  }

  // -------------------------------------------------------------------------
  // alerts
  // -------------------------------------------------------------------------

  private singleSpec(
    options: SyncOptions,
    resource: string,
  ): FetchSpec | undefined {
    const specs = options.fetchSpecs?.[resource];
    return specs && specs.length === 1 ? specs[0] : undefined;
  }

  private alertsUrl(options: SyncOptions): string {
    const params = new URLSearchParams();
    params.set('api-version', ALERTS_API_VERSION);
    const filter = this.singleSpec(options, ALERT_ENTITY)?.filter;
    const severity = pushableEq(filter, 'severity');
    if (severity !== null) {
      params.set('severity', severity);
    }
    const state = pushableEq(filter, 'state');
    if (state !== null) {
      params.set('alertState', state);
    }
    const monitorCondition = pushableEq(filter, 'monitorCondition');
    if (monitorCondition !== null) {
      params.set('monitorCondition', monitorCondition);
    }
    return `${ARM_HOST}/subscriptions/${encodeURIComponent(this.settings.subscriptionId)}/providers/Microsoft.AlertsManagement/alerts?${params.toString()}`;
  }

  private async syncAlerts(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const phaseStart = Date.now();
    let url: string | undefined = this.alertsUrl(options);
    const collected: Entity[] = [];
    let pages = 0;
    while (url !== undefined) {
      if (signal?.aborted) {
        return false;
      }
      const res: HttpResponse<AlertsResponseBody> =
        await this.armGet<AlertsResponseBody>(url, 'alerts', signal);
      const chunk = buildAlertEntities(res.body);
      collected.push(...chunk);
      pages += 1;
      this.logger.info('fetched page', {
        resource: 'alerts',
        page: pages,
        items: chunk.length,
      });
      const next: string | undefined = res.body.nextLink;
      url =
        typeof next === 'string' && isAllowedArmUrl(next) ? next : undefined;
    }
    await storage.entities(collected, { types: [ALERT_ENTITY] });
    this.logger.info('resource done', {
      resource: 'alerts',
      pages,
      items: collected.length,
      duration_ms: Date.now() - phaseStart,
    });
    return true;
  }

  // -------------------------------------------------------------------------
  // sync — orchestration
  // -------------------------------------------------------------------------

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const enabled = this.settings.resources;
    for (const resource of RESOURCE_ORDER) {
      if (enabled && enabled.length > 0 && !enabled.includes(resource)) {
        continue;
      }
      if (options.resources && options.resources.size > 0) {
        if (!options.resources.has(resource)) {
          continue;
        }
      }
      if (signal?.aborted) {
        return { done: false };
      }
      const completed =
        resource === 'metric_queries'
          ? await this.syncMetricQueries(options, storage, signal)
          : await this.syncAlerts(options, storage, signal);
      if (!completed) {
        return { done: false };
      }
    }
    return { done: true };
  }
}
