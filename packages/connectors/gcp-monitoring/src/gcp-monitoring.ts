import {
  buildServiceAccountJwt,
  gcpAuthConfigShape,
  tokenResponseSchema,
} from '@rawdash/connector-gcp-shared';
import {
  AuthError,
  connectorUserAgent,
  parseEpoch,
} from '@rawdash/connector-shared';
import {
  BaseConnector,
  type ConnectorContext,
  type ConnectorDoc,
  type CredentialsSchema,
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

const metricQuerySchema = z.object({
  id: z
    .string()
    .regex(
      /^[a-z][a-zA-Z0-9_]*$/,
      'Monitoring query id must start with a lowercase letter and contain only letters, digits, and underscores',
    ),
  metricType: z.string().min(1).meta({
    description:
      'Fully-qualified Cloud Monitoring metric type, e.g. compute.googleapis.com/instance/cpu/utilization.',
  }),
  filter: z.string().optional().meta({
    description:
      'Optional additional filter combined with metric.type using AND, e.g. resource.labels.zone="us-central1-a".',
  }),
  alignmentPeriod: z
    .string()
    .regex(
      /^\d+s$/,
      'alignmentPeriod must be a duration in seconds, e.g. 60s or 300s',
    )
    .meta({
      description:
        'Aggregation alignment period as a duration in seconds, e.g. 300s.',
    }),
  perSeriesAligner: z
    .enum([
      'ALIGN_NONE',
      'ALIGN_DELTA',
      'ALIGN_RATE',
      'ALIGN_INTERPOLATE',
      'ALIGN_NEXT_OLDER',
      'ALIGN_MIN',
      'ALIGN_MAX',
      'ALIGN_MEAN',
      'ALIGN_COUNT',
      'ALIGN_SUM',
      'ALIGN_STDDEV',
      'ALIGN_COUNT_TRUE',
      'ALIGN_COUNT_FALSE',
      'ALIGN_FRACTION_TRUE',
      'ALIGN_PERCENTILE_99',
      'ALIGN_PERCENTILE_95',
      'ALIGN_PERCENTILE_50',
      'ALIGN_PERCENTILE_05',
      'ALIGN_PERCENT_CHANGE',
    ])
    .meta({
      description:
        'Cloud Monitoring perSeriesAligner statistic, e.g. ALIGN_MEAN, ALIGN_SUM, ALIGN_PERCENTILE_99.',
    }),
});

export const configFields = defineConfigFields(
  z
    .object({
      projectId: z.string().min(1).meta({
        label: 'GCP project ID',
        description:
          'Google Cloud project ID whose metrics should be synced (the project that owns the monitored resources).',
        placeholder: 'my-project-123',
      }),
      ...gcpAuthConfigShape,
      metricQueries: z.array(metricQuerySchema).nonempty().meta({
        label: 'Metric queries',
        description:
          'Cloud Monitoring is too broad to mirror wholesale; declare the specific metrics to pull. Each query needs an id, metric type, alignment period (e.g. 300s), and a perSeriesAligner statistic, with an optional filter on resource labels.',
      }),
      lookbackMinutes: z.number().int().positive().max(40_320).optional().meta({
        label: 'Lookback (minutes)',
        description:
          'How far back to pull data points on a full sync when the host does not supply a since bound. Defaults to 180.',
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
    ),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'Google Cloud Monitoring',
  category: 'infrastructure',
  brandColor: '#4285F4',
  tagline:
    'Pull declared Cloud Monitoring metric time series (any metric type, aligner, and period) into a single metric series per query.',
  rateLimit:
    'Cloud Monitoring projects.timeSeries.list is rate-limited per project; 429 / RESOURCE_EXHAUSTED responses are retried with backoff. Pagination uses nextPageToken.',
  vendor: {
    name: 'Google Cloud',
    apiDocs: 'https://cloud.google.com/monitoring/api/v3',
    website: 'https://cloud.google.com/monitoring',
  },
  auth: {
    summary:
      'Authenticate against the Cloud Monitoring v3 API with a Google service account JSON key. The service account needs the Monitoring Viewer role (roles/monitoring.viewer) on the project whose metrics it reads.',
    setup: [
      'Identify the GCP project whose metrics you want to sync.',
      'Create a service account at Google Cloud -> IAM & Admin -> Service Accounts in that project (or grant an existing one access).',
      'Grant the service account the Monitoring Viewer role (roles/monitoring.viewer) on the project. The API enables this role automatically for owners and editors.',
      'Generate a JSON key for the service account and store its contents as a secret (e.g. GCP_MONITORING_SA_JSON).',
      'Reference the key from config as serviceAccountJson: secret("GCP_MONITORING_SA_JSON") and set projectId to the same project.',
    ],
  },
  limitations: [
    'Cloud Monitoring is too broad to mirror wholesale; only the metrics declared in metricQueries are synced; there is no automatic metric discovery.',
    'The series name is derived from the metric type, so two queries against the same metricType with different aligners or filters share one series name and are distinguished only by sample attributes.',
    'Each query alignmentPeriod must be expressed as a duration in seconds, e.g. 60s or 300s.',
    'A full sync uses lookbackMinutes; a latest sync uses a short window covering the last few alignment periods.',
    'Distribution-valued metrics (e.g. latency histograms) require a perSeriesAligner that reduces them to a scalar (ALIGN_PERCENTILE_99, ALIGN_MEAN, etc.); raw distributions are not stored.',
  ],
});

export interface GcpMonitoringMetricQuery {
  id: string;
  metricType: string;
  filter?: string;
  alignmentPeriod: string;
  perSeriesAligner: string;
}

export interface GcpMonitoringSettings {
  projectId: string;
  metricQueries: GcpMonitoringMetricQuery[];
  lookbackMinutes?: number;
}

const gcpMonitoringCredentials = {
  serviceAccountJson: {
    description: 'Google service account JSON key (raw JSON or base64)',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type GcpMonitoringCredentials = typeof gcpMonitoringCredentials;

const int64String = z.string().regex(/^-?\d+$/);
const isoTimestamp = z.iso.datetime();

const pointValue = z
  .object({
    doubleValue: z.number().optional(),
    int64Value: int64String.optional(),
    boolValue: z.boolean().optional(),
    stringValue: z.string().optional(),
    distributionValue: z.unknown().optional(),
  })
  .refine(
    (v) =>
      v.doubleValue !== undefined ||
      v.int64Value !== undefined ||
      v.boolValue !== undefined ||
      v.stringValue !== undefined ||
      v.distributionValue !== undefined,
    {
      message: 'point value must carry at least one supported value field',
    },
  );

const pointSchema = z.object({
  interval: z.object({
    startTime: isoTimestamp.optional(),
    endTime: isoTimestamp,
  }),
  value: pointValue,
});

const timeSeriesSchema = z.object({
  metric: z.object({
    type: z.string(),
    labels: z.record(z.string(), z.string()).optional(),
  }),
  resource: z
    .object({
      type: z.string().optional(),
      labels: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
  valueType: z.string().optional(),
  metricKind: z.string().optional(),
  points: z.array(pointSchema).optional(),
});

const listTimeSeriesResponseSchema = z.object({
  timeSeries: z.array(timeSeriesSchema).optional(),
  nextPageToken: z.string().optional(),
});

export const gcpMonitoringResources = defineResources({
  '<metricType>': {
    shape: 'metric',
    dynamic: true,
    description:
      'One metric series per declared metric query. The series name is the configured metric type (e.g. `compute.googleapis.com/instance/cpu/utilization`), so the actual keys depend on the configured `metricQueries`. Each sample carries the aligner, alignment period, query id, and metric/resource labels as attributes.',
    endpoint: 'GET /v3/projects/{projectId}/timeSeries',
    granularity: 'Per alignmentPeriod (a duration in seconds, e.g. 300s)',
    notes:
      'Each sync replaces the full set of samples for the metric names it owns (idempotent). Distribution-valued points are dropped unless reduced to a scalar by the perSeriesAligner.',
    dimensions: [
      {
        name: 'perSeriesAligner',
        description:
          'The Cloud Monitoring statistic requested for the query, e.g. ALIGN_MEAN, ALIGN_SUM, or ALIGN_PERCENTILE_99.',
      },
      {
        name: 'alignmentPeriod',
        description:
          'The aggregation alignment period as configured, e.g. 300s.',
      },
      {
        name: 'queryId',
        description:
          'The configured id of the metric query that produced the sample.',
      },
      {
        name: 'resourceType',
        description:
          'The monitored resource type the sample originated from (e.g. gce_instance).',
      },
    ],
    responses: {
      oauth_token: tokenResponseSchema,
      time_series: listTimeSeriesResponseSchema,
    },
  },
});

const MONITORING_API_BASE = 'https://monitoring.googleapis.com/v3';
const MONITORING_SCOPE = 'https://www.googleapis.com/auth/monitoring.read';
const PAGE_SIZE = 1000;
const DEFAULT_LOOKBACK_MINUTES = 180;
const MS_PER_MINUTE = 60_000;

export const id = 'gcp-monitoring';

export class GcpMonitoringConnector extends BaseConnector<
  GcpMonitoringSettings,
  GcpMonitoringCredentials
> {
  static readonly id = id;

  static readonly resources = gcpMonitoringResources;

  static readonly schemas = schemasFromResources(gcpMonitoringResources);

  static create(
    input: unknown,
    ctx?: ConnectorContext,
  ): GcpMonitoringConnector {
    const parsed = configFields.parse(input);
    return new GcpMonitoringConnector(
      {
        projectId: parsed.projectId,
        metricQueries: parsed.metricQueries,
        lookbackMinutes: parsed.lookbackMinutes,
      },
      {
        serviceAccountJson: parsed.serviceAccountJson,
      },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = gcpMonitoringCredentials;

  private cachedToken: { token: string; expiresAt: number } | null = null;

  private async getAccessToken(signal?: AbortSignal): Promise<string> {
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAt) {
      return this.cachedToken.token;
    }
    const { serviceAccountJson } = this.creds;
    if (!serviceAccountJson) {
      throw new AuthError(`${this.id}: missing serviceAccountJson credential`);
    }
    const { url, body } = await buildServiceAccountJwt(
      serviceAccountJson,
      MONITORING_SCOPE,
    );
    const res = await this.post<{
      access_token: string;
      expires_in?: number;
    }>(url, {
      resource: 'oauth_token',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal,
    });
    const expiresIn = res.body.expires_in ?? 3600;
    this.cachedToken = {
      token: res.body.access_token,
      expiresAt: Date.now() + (expiresIn - 60) * 1000,
    };
    return this.cachedToken.token;
  }

  private computeWindow(options: SyncOptions): {
    startMs: number;
    endMs: number;
  } {
    const endMs = Date.now();
    if (options.since) {
      const sinceMs = parseEpoch(options.since, 'iso');
      if (sinceMs !== null) {
        return { startMs: Math.min(sinceMs, endMs), endMs };
      }
    }
    if (options.mode === 'latest') {
      const maxPeriodSec = Math.max(
        ...this.settings.metricQueries.map(
          (q) => parseDurationSeconds(q.alignmentPeriod) ?? 60,
        ),
        60,
      );
      return { startMs: endMs - maxPeriodSec * 3 * 1000, endMs };
    }
    const lookback = this.settings.lookbackMinutes ?? DEFAULT_LOOKBACK_MINUTES;
    return { startMs: endMs - lookback * MS_PER_MINUTE, endMs };
  }

  private buildFilter(query: GcpMonitoringMetricQuery): string {
    const base = `metric.type = "${query.metricType}"`;
    if (query.filter && query.filter.trim().length > 0) {
      return `${base} AND ${query.filter}`;
    }
    return base;
  }

  private async listTimeSeries(
    accessToken: string,
    query: GcpMonitoringMetricQuery,
    startMs: number,
    endMs: number,
    pageToken: string | undefined,
    signal?: AbortSignal,
  ): Promise<z.infer<typeof listTimeSeriesResponseSchema>> {
    const params = new URLSearchParams();
    params.set('filter', this.buildFilter(query));
    params.set('interval.startTime', new Date(startMs).toISOString());
    params.set('interval.endTime', new Date(endMs).toISOString());
    params.set('aggregation.alignmentPeriod', query.alignmentPeriod);
    params.set('aggregation.perSeriesAligner', query.perSeriesAligner);
    params.set('pageSize', String(PAGE_SIZE));
    if (pageToken !== undefined) {
      params.set('pageToken', pageToken);
    }

    const url = `${MONITORING_API_BASE}/projects/${encodeURIComponent(
      this.settings.projectId,
    )}/timeSeries?${params.toString()}`;

    const res = await this.get<z.infer<typeof listTimeSeriesResponseSchema>>(
      url,
      {
        resource: 'time_series',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'User-Agent': connectorUserAgent(this.id),
        },
        signal,
      },
    );
    return res.body;
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const queries = this.settings.metricQueries;
    if (queries.length === 0) {
      return { done: true };
    }

    const names = new Set(queries.map((q) => q.metricType));
    const { startMs, endMs } = this.computeWindow(options);

    let token: string | null = null;
    const getToken = async (sig?: AbortSignal): Promise<string> => {
      if (token === null) {
        token = await this.getAccessToken(sig);
      }
      return token;
    };

    const samples: MetricSample[] = [];

    for (const query of queries) {
      let pageToken: string | undefined;
      let page = 0;
      let pageItems = 0;
      let total = 0;
      const phaseStart = Date.now();
      do {
        if (signal?.aborted) {
          return { done: false };
        }
        let response: z.infer<typeof listTimeSeriesResponseSchema>;
        try {
          const accessToken = await getToken(signal);
          response = await this.listTimeSeries(
            accessToken,
            query,
            startMs,
            endMs,
            pageToken,
            signal,
          );
        } catch (err) {
          this.logger.warn('fetch page failed', {
            resource: query.metricType,
            page: page + 1,
            queryId: query.id,
            error: err instanceof Error ? err.message : String(err),
          });
          throw err;
        }
        const series = response.timeSeries ?? [];
        pageItems = 0;
        for (const ts of series) {
          for (const point of ts.points ?? []) {
            const sample = pointToSample(query, ts, point);
            if (sample !== null) {
              samples.push(sample);
              pageItems += 1;
            }
          }
        }
        total += pageItems;
        pageToken =
          typeof response.nextPageToken === 'string' &&
          response.nextPageToken.length > 0
            ? response.nextPageToken
            : undefined;
        page += 1;
        this.logger.info('fetched page', {
          resource: query.metricType,
          queryId: query.id,
          page,
          items: pageItems,
          next: pageToken ?? null,
        });
      } while (pageToken !== undefined);
      this.logger.info('resource done', {
        resource: query.metricType,
        queryId: query.id,
        pages: page,
        items: total,
        duration_ms: Date.now() - phaseStart,
      });
    }

    await storage.metrics(samples, { names: [...names] });
    return { done: true };
  }
}

export function parseDurationSeconds(duration: string): number | null {
  const m = /^(\d+)s$/.exec(duration);
  if (!m) {
    return null;
  }
  const n = Number.parseInt(m[1]!, 10);
  return Number.isFinite(n) ? n : null;
}

export function pointToSample(
  query: GcpMonitoringMetricQuery,
  series: z.infer<typeof timeSeriesSchema>,
  point: z.infer<typeof pointSchema>,
): MetricSample | null {
  const tsIso = point.interval.endTime;
  const ts = parseEpoch(tsIso, 'iso');
  if (ts === null) {
    return null;
  }
  const value = extractScalarValue(point.value);
  if (value === null) {
    return null;
  }
  const attributes: Record<string, JSONValue> = {
    perSeriesAligner: query.perSeriesAligner,
    alignmentPeriod: query.alignmentPeriod,
    queryId: query.id,
  };
  if (series.resource?.type) {
    attributes['resourceType'] = series.resource.type;
  }
  for (const [k, v] of Object.entries(series.metric.labels ?? {})) {
    attributes[`metric.${k}`] = v;
  }
  for (const [k, v] of Object.entries(series.resource?.labels ?? {})) {
    attributes[`resource.${k}`] = v;
  }
  return { name: query.metricType, ts, value, attributes };
}

function extractScalarValue(v: z.infer<typeof pointValue>): number | null {
  if (v.doubleValue !== undefined && Number.isFinite(v.doubleValue)) {
    return v.doubleValue;
  }
  if (v.int64Value !== undefined) {
    const n = Number(v.int64Value);
    return Number.isSafeInteger(n) ? n : null;
  }
  if (v.boolValue !== undefined) {
    return v.boolValue ? 1 : 0;
  }
  return null;
}
