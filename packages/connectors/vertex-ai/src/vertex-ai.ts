import {
  BQ_DATASET_RE,
  BQ_IDENT_RE,
  BQ_READONLY_SCOPE,
  type BqPageRequest,
  type BqQueryResponse,
  GcpAccessTokenProvider,
  MS_PER_DAY,
  bqQueryResponseSchema,
  collectBigQueryPages,
  gcpAuthConfigShape,
  indexBqFields,
  parseBqDateOrEpoch,
  readBqCell,
  startOfUtcDay,
  toDateStr,
  tokenResponseSchema,
} from '@rawdash/connector-gcp-shared';
import { connectorUserAgent, parseEpoch } from '@rawdash/connector-shared';
import {
  BaseConnector,
  type ChunkedSyncCursor,
  type ConnectorContext,
  type ConnectorCost,
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
  makeChunkedCursorGuard,
  schemasFromResources,
} from '@rawdash/core';
import { z } from 'zod';

export const configFields = defineConfigFields(
  z
    .object({
      projectId: z
        .string()
        .regex(BQ_IDENT_RE, 'projectId must be a valid GCP project id')
        .meta({
          label: 'GCP project ID',
          description:
            'Google Cloud project ID that hosts the Vertex AI workload. Cloud Monitoring metrics are read from this project.',
          placeholder: 'my-project-123',
        }),
      ...gcpAuthConfigShape,
      bqProject: z
        .string()
        .regex(BQ_IDENT_RE, 'bqProject must be a valid GCP project id')
        .optional()
        .meta({
          label: 'BigQuery project ID (optional)',
          description:
            'Project that hosts the Cloud Billing -> BigQuery export. Required to sync the spend resource; omit to disable spend syncing.',
          placeholder: 'my-billing-project',
        }),
      bqDataset: z
        .string()
        .regex(
          BQ_DATASET_RE,
          'bqDataset must be a valid BigQuery dataset id (letters, digits, underscores; must start with a letter or underscore)',
        )
        .optional()
        .meta({
          label: 'BigQuery dataset (optional)',
          description:
            'BigQuery dataset containing the Cloud Billing export tables (gcp_billing_export_v1_*). Required to sync the spend resource.',
          placeholder: 'billing_export',
        }),
      bqLocation: z.string().min(1).optional().meta({
        label: 'BigQuery location (optional)',
        description:
          'Region or multi-region of the billing dataset (e.g. US, EU, us-central1). Defaults to US when bqDataset is set.',
        placeholder: 'US',
      }),
      spendServiceFilter: z.string().min(1).optional().meta({
        label: 'Spend service filter (optional)',
        description:
          'BigQuery LIKE pattern matched against service.description to scope spend rows to Vertex AI. Defaults to "Vertex AI%" which covers both "Vertex AI" and "Vertex AI Generative AI" services.',
        placeholder: 'Vertex AI%',
      }),
      lookbackDays: z.number().int().positive().max(365).optional().meta({
        label: 'Backfill window (days)',
        description:
          'How many days of history to pull on a full sync. Defaults to 30.',
        placeholder: '30',
      }),
    })
    .superRefine((val, ctx) => {
      if ((val.bqProject === undefined) !== (val.bqDataset === undefined)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'bqProject and bqDataset must both be provided or both omitted',
          path: [val.bqProject === undefined ? 'bqProject' : 'bqDataset'],
        });
      }
    }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'Google Cloud Vertex AI',
  category: 'engineering',
  brandColor: '#4285F4',
  tagline:
    'Sync daily Vertex AI model invocations, token counts, errors, and spend (Gemini and partner models) into a single dashboard view of GCP AI usage.',
  vendor: {
    name: 'Google Cloud',
    domain: 'cloud.google.com',
    apiDocs: 'https://cloud.google.com/vertex-ai/docs/general/monitoring',
    website: 'https://cloud.google.com/vertex-ai',
  },
  auth: {
    summary:
      'Authenticate against the Cloud Monitoring v3 API (and optionally BigQuery for spend) with a Google service account JSON key. The service account needs the Monitoring Viewer role on the project running Vertex AI. To sync spend, it additionally needs BigQuery Data Viewer on the billing dataset and BigQuery Job User on the billing project.',
    setup: [
      'Identify the GCP project running Vertex AI (it owns the publisher/online_serving metrics).',
      'Create a service account at Google Cloud -> IAM & Admin -> Service Accounts in that project (or grant an existing one access).',
      'Grant the service account the Monitoring Viewer role (roles/monitoring.viewer) on the project so it can read Vertex AI metrics.',
      'To sync spend, enable the Cloud Billing -> BigQuery export (Billing -> Billing export -> BigQuery export). Then grant the service account roles/bigquery.dataViewer on the export dataset and roles/bigquery.jobUser on the bqProject.',
      'Generate a JSON key for the service account and store its contents as a secret (e.g. GCP_SA_JSON).',
      'Reference the key from config as serviceAccountJson: secret("GCP_SA_JSON") and set projectId to the Vertex AI project. Set bqProject / bqDataset to enable the spend resource.',
    ],
  },
  rateLimit:
    'Cloud Monitoring projects.timeSeries.list and BigQuery jobs.query are rate-limited per project; 429 / RESOURCE_EXHAUSTED responses are retried with backoff. Each sync issues at most three requests (invocations metric, tokens metric, optional BigQuery query).',
  limitations: [
    'Only the publisher (Gemini and partner online-serving) metric family is synced. Custom model deployments under aiplatform.googleapis.com/prediction/* are out of scope; query Cloud Monitoring directly via the gcp-monitoring connector if you need them.',
    'Spend rows come from the Cloud Billing -> BigQuery export; the export must be configured manually in the GCP console and only days after the configuration date are present.',
    'BigQuery cost rows are back-revised by GCP for several days; an incremental sync refetches a short trailing window to pick up corrections.',
    'Each BigQuery query is billed against the bqProject; keep lookbackDays reasonable.',
    'Daily aggregation only - sub-day granularity is intentionally not exposed for spend or invocation rollups.',
  ],
});

export interface VertexAiSettings {
  projectId: string;
  bqProject?: string;
  bqDataset?: string;
  bqLocation?: string;
  spendServiceFilter?: string;
  lookbackDays?: number;
}

const vertexAiCredentials = {
  serviceAccountJson: {
    description: 'Google service account JSON key (raw JSON or base64)',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type VertexAiCredentials = typeof vertexAiCredentials;

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

export const INVOCATIONS_METRIC_NAME = 'vertex_ai_invocations';
export const ERRORS_METRIC_NAME = 'vertex_ai_errors';
export const TOKENS_METRIC_NAME = 'vertex_ai_tokens';
export const SPEND_METRIC_NAME = 'vertex_ai_spend';

const INVOCATION_COUNT_TYPE =
  'aiplatform.googleapis.com/publisher/online_serving/model_invocation_count';
const TOKEN_COUNT_TYPE =
  'aiplatform.googleapis.com/publisher/online_serving/token_count';

export const vertexAiResources = defineResources({
  [INVOCATIONS_METRIC_NAME]: {
    shape: 'metric',
    description:
      'Daily count of successful Vertex AI model invocations (HTTP 2xx) per (date, modelId). Sourced from the Cloud Monitoring metric `aiplatform.googleapis.com/publisher/online_serving/model_invocation_count`, aggregated to one sample per day with SUM.',
    endpoint: 'GET /v3/projects/{projectId}/timeSeries',
    granularity: 'daily',
    notes:
      'On every sync the trailing `lookbackDays` window is rewritten idempotently. Non-2xx response codes flow to `vertex_ai_errors` instead.',
    dimensions: [
      {
        name: 'modelId',
        description:
          'Vertex AI publisher model identifier, e.g. gemini-1.5-pro or text-bison.',
      },
      {
        name: 'responseCode',
        description:
          'Upstream HTTP response code reported by Vertex AI (always 2xx in this resource).',
      },
    ],
    responses: {
      oauth_token: tokenResponseSchema,
      invocations: listTimeSeriesResponseSchema,
    },
  },
  [ERRORS_METRIC_NAME]: {
    shape: 'metric',
    description:
      'Daily count of failed Vertex AI model invocations (non-2xx) per (date, modelId, errorType). Sourced from the same Cloud Monitoring API call as `vertex_ai_invocations`; rows with response_code outside 200-299 are routed here.',
    endpoint:
      'GET /v3/projects/{projectId}/timeSeries (shared with vertex_ai_invocations)',
    granularity: 'daily',
    notes:
      'errorType carries the upstream HTTP status (e.g. 400, 429, 500). Use it to slice quota errors (429) from request errors (4xx) and platform errors (5xx). The response schema is registered under `vertex_ai_invocations`.',
    dimensions: [
      {
        name: 'modelId',
        description: 'Vertex AI publisher model identifier.',
      },
      {
        name: 'errorType',
        description:
          'HTTP status code returned by Vertex AI (400, 401, 403, 429, 5xx, ...).',
      },
    ],
  },
  [TOKENS_METRIC_NAME]: {
    shape: 'metric',
    description:
      'Daily Vertex AI token usage per (date, modelId, tokenType). Sourced from the Cloud Monitoring metric `aiplatform.googleapis.com/publisher/online_serving/token_count`. tokenType is either `input` (prompt) or `output` (completion).',
    endpoint: 'GET /v3/projects/{projectId}/timeSeries',
    granularity: 'daily',
    notes:
      'Sum across both tokenType values to get total tokens; slice by tokenType to separate input from output cost drivers.',
    dimensions: [
      {
        name: 'modelId',
        description: 'Vertex AI publisher model identifier.',
      },
      {
        name: 'tokenType',
        description:
          'Either `input` (prompt tokens) or `output` (response tokens).',
      },
    ],
    responses: {
      tokens: listTimeSeriesResponseSchema,
    },
  },
  [SPEND_METRIC_NAME]: {
    shape: 'metric',
    description:
      'Daily Vertex AI spend per (date, sku) sourced from the Cloud Billing -> BigQuery export. Skipped unless bqProject and bqDataset are configured.',
    endpoint: 'POST /bigquery/v2/projects/{bqProject}/queries',
    granularity: 'daily',
    notes:
      'The trailing 5 days are always refetched on incremental syncs to pick up GCP back-revisions. SKU describes the specific Vertex AI model and token type (e.g. "Gemini 1.5 Pro Online Inference - Input").',
    dimensions: [
      {
        name: 'sku',
        description:
          'GCP SKU description, e.g. "Gemini 1.5 Pro Online Inference - Input Tokens".',
      },
      {
        name: 'service',
        description:
          'GCP service description, typically "Vertex AI" or "Vertex AI Generative AI".',
      },
      {
        name: 'currency',
        description: 'Billing currency reported by GCP.',
      },
    ],
    responses: {
      spend: bqQueryResponseSchema,
    },
  },
});

const PHASE_ORDER = ['invocations', 'tokens', 'spend'] as const;
export type VertexAiPhase = (typeof PHASE_ORDER)[number];

const PHASE_TO_RESOURCES: Record<VertexAiPhase, readonly string[]> = {
  invocations: [INVOCATIONS_METRIC_NAME, ERRORS_METRIC_NAME],
  tokens: [TOKENS_METRIC_NAME],
  spend: [SPEND_METRIC_NAME],
};

export type VertexAiCursor = ChunkedSyncCursor<VertexAiPhase, string>;
const isVertexAiCursor = makeChunkedCursorGuard(PHASE_ORDER);

const MONITORING_API_BASE = 'https://monitoring.googleapis.com/v3';
const MONITORING_SCOPE = 'https://www.googleapis.com/auth/monitoring.read';
const MONITORING_PAGE_SIZE = 1000;
const DAILY_ALIGNMENT_SECONDS = 86_400;
const DAILY_ALIGNMENT = `${DAILY_ALIGNMENT_SECONDS}s`;
const DEFAULT_LOOKBACK_DAYS = 30;
const INCREMENTAL_LOOKBACK_DAYS = 5;
const DEFAULT_SPEND_SERVICE_FILTER = 'Vertex AI%';

export const id = 'vertex-ai';

export const cost: ConnectorCost = {
  recommendedInterval: '1 day',
  minInterval: '1 hour',
  perSync:
    '2 Cloud Monitoring requests, plus 1 BigQuery query when bqProject/bqDataset are set',
  warning:
    'Each BigQuery spend query is billed against the bqProject. Prefer once-a-day syncs unless you need fresher invocation counts.',
};

export class VertexAiConnector extends BaseConnector<
  VertexAiSettings,
  VertexAiCredentials
> {
  static readonly id = id;

  static readonly resources = vertexAiResources;

  static readonly schemas = schemasFromResources(vertexAiResources);

  static readonly cost = cost;

  static create(input: unknown, ctx?: ConnectorContext): VertexAiConnector {
    const parsed = configFields.parse(input);
    return new VertexAiConnector(
      {
        projectId: parsed.projectId,
        bqProject: parsed.bqProject,
        bqDataset: parsed.bqDataset,
        bqLocation: parsed.bqLocation,
        spendServiceFilter: parsed.spendServiceFilter,
        lookbackDays: parsed.lookbackDays,
      },
      { serviceAccountJson: parsed.serviceAccountJson },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = vertexAiCredentials;

  private monitoringTokenProvider?: GcpAccessTokenProvider;
  private bigQueryTokenProvider?: GcpAccessTokenProvider;

  private getMonitoringToken(signal?: AbortSignal): Promise<string> {
    this.monitoringTokenProvider ??= new GcpAccessTokenProvider({
      connectorId: this.id,
      scope: MONITORING_SCOPE,
      getServiceAccountJson: () => this.creds.serviceAccountJson,
      post: (url, opts) =>
        this.post<{ access_token: string; expires_in?: number }>(url, opts),
    });
    return this.monitoringTokenProvider.getToken(signal);
  }

  private getBigQueryToken(signal?: AbortSignal): Promise<string> {
    this.bigQueryTokenProvider ??= new GcpAccessTokenProvider({
      connectorId: this.id,
      scope: BQ_READONLY_SCOPE,
      getServiceAccountJson: () => this.creds.serviceAccountJson,
      post: (url, opts) =>
        this.post<{ access_token: string; expires_in?: number }>(url, opts),
    });
    return this.bigQueryTokenProvider.getToken(signal);
  }

  private async listTimeSeries(
    metricType: string,
    groupByFields: readonly string[],
    startMs: number,
    endMs: number,
    pageToken: string | undefined,
    resource: string,
    signal?: AbortSignal,
  ): Promise<z.infer<typeof listTimeSeriesResponseSchema>> {
    const params = new URLSearchParams();
    params.set('filter', `metric.type = "${metricType}"`);
    params.set('interval.startTime', new Date(startMs).toISOString());
    params.set('interval.endTime', new Date(endMs).toISOString());
    params.set('aggregation.alignmentPeriod', DAILY_ALIGNMENT);
    params.set('aggregation.perSeriesAligner', 'ALIGN_SUM');
    params.set('aggregation.crossSeriesReducer', 'REDUCE_SUM');
    for (const field of groupByFields) {
      params.append('aggregation.groupByFields', field);
    }
    params.set('pageSize', String(MONITORING_PAGE_SIZE));
    if (pageToken !== undefined) {
      params.set('pageToken', pageToken);
    }

    const url = `${MONITORING_API_BASE}/projects/${encodeURIComponent(
      this.settings.projectId,
    )}/timeSeries?${params.toString()}`;

    const accessToken = await this.getMonitoringToken(signal);
    const res = await this.get<z.infer<typeof listTimeSeriesResponseSchema>>(
      url,
      {
        resource,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'User-Agent': connectorUserAgent(this.id),
        },
        signal,
      },
    );
    return res.body;
  }

  private async fetchBigQueryPage(
    request: BqPageRequest,
    signal: AbortSignal | undefined,
  ): Promise<BqQueryResponse> {
    const accessToken = await this.getBigQueryToken(signal);
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'User-Agent': connectorUserAgent(this.id),
    };
    if (request.method === 'POST') {
      const res = await this.post<BqQueryResponse>(request.url, {
        resource: 'spend',
        headers,
        body: request.body,
        signal,
      });
      return res.body;
    }
    const res = await this.get<BqQueryResponse>(request.url, {
      resource: 'spend',
      headers,
      signal,
    });
    return res.body;
  }

  private async syncInvocations(
    storage: StorageHandle,
    window: { startMs: number; endMs: number },
    requestedResources: ReadonlySet<string> | undefined,
    signal?: AbortSignal,
  ): Promise<void> {
    const wantInvocations =
      !requestedResources ||
      requestedResources.size === 0 ||
      requestedResources.has(INVOCATIONS_METRIC_NAME);
    const wantErrors =
      !requestedResources ||
      requestedResources.size === 0 ||
      requestedResources.has(ERRORS_METRIC_NAME);
    if (!wantInvocations && !wantErrors) {
      return;
    }

    const invocations: MetricSample[] = [];
    const errors: MetricSample[] = [];
    let pageToken: string | undefined;
    let page = 0;
    const phaseStart = Date.now();
    do {
      if (signal?.aborted) {
        return;
      }
      let response: z.infer<typeof listTimeSeriesResponseSchema>;
      try {
        response = await this.listTimeSeries(
          INVOCATION_COUNT_TYPE,
          ['metric.labels.model_user_id', 'metric.labels.response_code'],
          window.startMs,
          window.endMs,
          pageToken,
          'invocations',
          signal,
        );
      } catch (err) {
        this.logger.warn('fetch page failed', {
          resource: 'invocations',
          page: page + 1,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
      const series = response.timeSeries ?? [];
      let pageItems = 0;
      for (const ts of series) {
        const modelId = ts.metric.labels?.['model_user_id'] ?? null;
        const responseCode = ts.metric.labels?.['response_code'] ?? '';
        const isError = !isSuccessCode(responseCode);
        for (const point of ts.points ?? []) {
          const sample = pointToCountSample(modelId, responseCode, point);
          if (sample === null) {
            continue;
          }
          if (isError) {
            errors.push({
              name: ERRORS_METRIC_NAME,
              ts: sample.ts,
              value: sample.value,
              attributes: {
                modelId: sample.attributes['modelId'] ?? null,
                errorType: responseCode,
              },
            });
          } else {
            invocations.push({
              name: INVOCATIONS_METRIC_NAME,
              ts: sample.ts,
              value: sample.value,
              attributes: sample.attributes,
            });
          }
          pageItems += 1;
        }
      }
      pageToken = nextPageTokenOrUndefined(response.nextPageToken);
      page += 1;
      this.logger.info('fetched page', {
        resource: 'invocations',
        page,
        items: pageItems,
        next: pageToken ?? null,
      });
    } while (pageToken !== undefined);

    if (wantInvocations) {
      await storage.metrics(invocations, { names: [INVOCATIONS_METRIC_NAME] });
    }
    if (wantErrors) {
      await storage.metrics(errors, { names: [ERRORS_METRIC_NAME] });
    }
    this.logger.info('resource done', {
      resource: 'invocations',
      pages: page,
      items: invocations.length + errors.length,
      duration_ms: Date.now() - phaseStart,
    });
  }

  private async syncTokens(
    storage: StorageHandle,
    window: { startMs: number; endMs: number },
    signal?: AbortSignal,
  ): Promise<void> {
    const samples: MetricSample[] = [];
    let pageToken: string | undefined;
    let page = 0;
    const phaseStart = Date.now();
    do {
      if (signal?.aborted) {
        return;
      }
      let response: z.infer<typeof listTimeSeriesResponseSchema>;
      try {
        response = await this.listTimeSeries(
          TOKEN_COUNT_TYPE,
          ['metric.labels.model_user_id', 'metric.labels.type'],
          window.startMs,
          window.endMs,
          pageToken,
          'tokens',
          signal,
        );
      } catch (err) {
        this.logger.warn('fetch page failed', {
          resource: 'tokens',
          page: page + 1,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
      const series = response.timeSeries ?? [];
      let pageItems = 0;
      for (const ts of series) {
        const modelId = ts.metric.labels?.['model_user_id'] ?? null;
        const tokenType =
          ts.metric.labels?.['type'] ?? ts.metric.labels?.['token_type'] ?? '';
        for (const point of ts.points ?? []) {
          const sample = pointToTokenSample(modelId, tokenType, point);
          if (sample === null) {
            continue;
          }
          samples.push(sample);
          pageItems += 1;
        }
      }
      pageToken = nextPageTokenOrUndefined(response.nextPageToken);
      page += 1;
      this.logger.info('fetched page', {
        resource: 'tokens',
        page,
        items: pageItems,
        next: pageToken ?? null,
      });
    } while (pageToken !== undefined);

    await storage.metrics(samples, { names: [TOKENS_METRIC_NAME] });
    this.logger.info('resource done', {
      resource: 'tokens',
      pages: page,
      items: samples.length,
      duration_ms: Date.now() - phaseStart,
    });
  }

  private async syncSpend(
    storage: StorageHandle,
    window: { startDate: string; endDate: string },
    signal?: AbortSignal,
  ): Promise<void> {
    if (
      this.settings.bqProject === undefined ||
      this.settings.bqDataset === undefined
    ) {
      this.logger.info('resource done', {
        resource: 'spend',
        pages: 0,
        items: 0,
        duration_ms: 0,
        skipped: 'bqProject or bqDataset not configured',
      });
      return;
    }

    const sql = buildVertexSpendSql({
      bqProject: this.settings.bqProject,
      bqDataset: this.settings.bqDataset,
      startDate: window.startDate,
      endDate: window.endDate,
      serviceFilter:
        this.settings.spendServiceFilter ?? DEFAULT_SPEND_SERVICE_FILTER,
    });

    const { rows: samples, aborted } = await collectBigQueryPages<MetricSample>(
      {
        projectId: this.settings.bqProject,
        sql,
        resource: 'spend',
        location: this.settings.bqLocation,
        signal,
        logger: this.logger,
        mapRows: (response) => buildSpendSamplesFromBqResponse(response),
        jobIncompleteMessage: `${this.id}: BigQuery spend query did not complete within the synchronous timeout (jobComplete=false). Lower lookbackDays so the query finishes faster.`,
        fetchPage: (request, sig) => this.fetchBigQueryPage(request, sig),
      },
    );
    if (aborted) {
      return;
    }
    await storage.metrics(samples, { names: [SPEND_METRIC_NAME] });
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const lookbackDays = this.settings.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
    const monitoringWindow = getMonitoringWindow(options, lookbackDays);
    const spendWindow = getSpendWindow(options, lookbackDays);

    const cursor = isVertexAiCursor(options.cursor)
      ? options.cursor
      : undefined;
    const resumeIdx = cursor ? PHASE_ORDER.indexOf(cursor.phase) : 0;
    const startIdx = resumeIdx >= 0 ? resumeIdx : 0;

    for (let i = startIdx; i < PHASE_ORDER.length; i++) {
      const phase = PHASE_ORDER[i]!;
      if (signal?.aborted) {
        return { done: false, cursor: { phase, page: null } };
      }
      if (
        options.resources &&
        options.resources.size > 0 &&
        !PHASE_TO_RESOURCES[phase].some((r) => options.resources!.has(r))
      ) {
        continue;
      }
      try {
        if (phase === 'invocations') {
          await this.syncInvocations(
            storage,
            monitoringWindow,
            options.resources,
            signal,
          );
        } else if (phase === 'tokens') {
          await this.syncTokens(storage, monitoringWindow, signal);
        } else {
          await this.syncSpend(storage, spendWindow, signal);
        }
      } catch (err) {
        if (signal?.aborted) {
          return { done: false, cursor: { phase, page: null } };
        }
        throw err;
      }
    }

    return { done: true };
  }
}

function isSuccessCode(code: string): boolean {
  if (code.length === 0) {
    return true;
  }
  const n = Number.parseInt(code, 10);
  if (!Number.isFinite(n)) {
    return false;
  }
  return n >= 200 && n < 300;
}

function nextPageTokenOrUndefined(token: unknown): string | undefined {
  if (typeof token === 'string' && token.length > 0) {
    return token;
  }
  return undefined;
}

export function pointToCountSample(
  modelId: string | null,
  responseCode: string,
  point: z.infer<typeof pointSchema>,
): { ts: number; value: number; attributes: Record<string, JSONValue> } | null {
  const ts = parseEpoch(
    point.interval.startTime ?? point.interval.endTime,
    'iso',
  );
  if (ts === null) {
    return null;
  }
  const value = extractScalarValue(point.value);
  if (value === null) {
    return null;
  }
  return {
    ts,
    value,
    attributes: {
      modelId: modelId ?? null,
      responseCode,
    },
  };
}

export function pointToTokenSample(
  modelId: string | null,
  tokenType: string,
  point: z.infer<typeof pointSchema>,
): MetricSample | null {
  const ts = parseEpoch(
    point.interval.startTime ?? point.interval.endTime,
    'iso',
  );
  if (ts === null) {
    return null;
  }
  const value = extractScalarValue(point.value);
  if (value === null) {
    return null;
  }
  return {
    name: TOKENS_METRIC_NAME,
    ts,
    value,
    attributes: {
      modelId: modelId ?? null,
      tokenType,
    },
  };
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

export function getMonitoringWindow(
  options: SyncOptions,
  lookbackDays: number,
  now: number = Date.now(),
): { startMs: number; endMs: number } {
  const endMs = startOfUtcDay(now) + MS_PER_DAY;
  let days = lookbackDays;
  if (options.mode === 'latest') {
    days = INCREMENTAL_LOOKBACK_DAYS;
  } else if (options.since !== undefined) {
    const sinceMs = parseEpoch(options.since, 'iso');
    if (sinceMs !== null) {
      const elapsed = Math.ceil((now - sinceMs) / MS_PER_DAY);
      days = Math.min(
        Math.max(elapsed + INCREMENTAL_LOOKBACK_DAYS, 1),
        lookbackDays,
      );
    }
  }
  return { startMs: endMs - days * MS_PER_DAY, endMs };
}

export function getSpendWindow(
  options: SyncOptions,
  lookbackDays: number,
  now: number = Date.now(),
): { startDate: string; endDate: string } {
  const endMs = startOfUtcDay(now) + MS_PER_DAY;
  let days = lookbackDays;
  if (options.mode === 'latest') {
    days = INCREMENTAL_LOOKBACK_DAYS;
  } else if (options.since !== undefined) {
    const sinceMs = parseEpoch(options.since, 'iso');
    if (sinceMs !== null) {
      const elapsed = Math.ceil((now - sinceMs) / MS_PER_DAY);
      days = Math.min(
        Math.max(elapsed + INCREMENTAL_LOOKBACK_DAYS, 1),
        lookbackDays,
      );
    }
  }
  return {
    startDate: toDateStr(endMs - days * MS_PER_DAY),
    endDate: toDateStr(endMs),
  };
}

export function buildVertexSpendSql(args: {
  bqProject: string;
  bqDataset: string;
  startDate: string;
  endDate: string;
  serviceFilter: string;
}): string {
  const escapedFilter = args.serviceFilter.replace(/'/g, "\\'");
  const table = `\`${args.bqProject}.${args.bqDataset}.gcp_billing_export_v1_*\``;
  return [
    `SELECT DATE(usage_start_time) AS date,`,
    `  service.description AS service,`,
    `  sku.description AS sku,`,
    `  SUM(cost) AS cost,`,
    `  ANY_VALUE(currency) AS currency`,
    `FROM ${table}`,
    `WHERE DATE(usage_start_time) >= DATE('${args.startDate}')`,
    `  AND DATE(usage_start_time) < DATE('${args.endDate}')`,
    `  AND service.description LIKE '${escapedFilter}'`,
    `GROUP BY date, service, sku`,
    `ORDER BY date`,
  ].join('\n');
}

export function buildSpendSamplesFromBqResponse(
  response: BqQueryResponse,
): MetricSample[] {
  const fieldIndex = indexBqFields(response);
  const samples: MetricSample[] = [];
  for (const row of response.rows ?? []) {
    const dateValue = readBqCell(row.f, fieldIndex, 'date');
    if (dateValue === null) {
      continue;
    }
    const ts = parseBqDateOrEpoch(dateValue);
    if (ts === null) {
      continue;
    }
    const costValue = readBqCell(row.f, fieldIndex, 'cost');
    if (costValue === null) {
      continue;
    }
    const value = Number.parseFloat(costValue);
    if (!Number.isFinite(value)) {
      continue;
    }
    const attributes: Record<string, JSONValue> = {
      sku: readBqCell(row.f, fieldIndex, 'sku') ?? null,
      service: readBqCell(row.f, fieldIndex, 'service') ?? null,
    };
    const currency = readBqCell(row.f, fieldIndex, 'currency');
    if (currency !== null) {
      attributes['currency'] = currency;
    }
    samples.push({ name: SPEND_METRIC_NAME, ts, value, attributes });
  }
  return samples;
}
