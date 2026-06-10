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
  readBqCell as readCell,
  startOfUtcDay,
  toDateStr,
  tokenResponseSchema,
} from '@rawdash/connector-gcp-shared';
import { connectorUserAgent, parseEpoch } from '@rawdash/connector-shared';
import {
  BaseConnector,
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
  schemasFromResources,
} from '@rawdash/core';
import { z } from 'zod';

const DIMENSION_VALUES = ['service', 'project', 'sku', 'location'] as const;
type Dimension = (typeof DIMENSION_VALUES)[number];

export const configFields = defineConfigFields(
  z.object({
    ...gcpAuthConfigShape,
    bqProject: z
      .string()
      .regex(BQ_IDENT_RE, 'bqProject must be a valid GCP project id')
      .meta({
        label: 'BigQuery project ID',
        description:
          'Project that hosts the BigQuery billing-export dataset (also the project used to bill the BigQuery queries this connector runs).',
        placeholder: 'my-billing-project',
      }),
    bqDataset: z
      .string()
      .regex(
        BQ_DATASET_RE,
        'bqDataset must be a valid BigQuery dataset id (letters, digits, and underscores; must start with a letter or underscore)',
      )
      .meta({
        label: 'BigQuery dataset',
        description:
          'BigQuery dataset containing the Cloud Billing export tables (gcp_billing_export_v1_*).',
        placeholder: 'billing_export',
      }),
    bqLocation: z.string().min(1).optional().meta({
      label: 'BigQuery location',
      description:
        'Region or multi-region of the billing dataset (e.g. US, EU, us-central1). Defaults to US.',
      placeholder: 'US',
    }),
    groupBy: z
      .array(z.enum(DIMENSION_VALUES))
      .nonempty()
      .max(
        3,
        'groupBy accepts at most three dimensions to keep query cardinality bounded',
      )
      .refine(
        (dims) => new Set(dims).size === dims.length,
        'groupBy values must be unique',
      )
      .optional()
      .meta({
        label: 'Group by (optional)',
        description:
          'Dimensions to break daily costs down by. Pick from service, project, sku, location. Defaults to ["service"].',
      }),
    lookbackDays: z.number().int().positive().max(720).optional().meta({
      label: 'Backfill window (days)',
      description:
        'How many days of history to query on a full sync. Defaults to 90.',
      placeholder: '90',
    }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'Google Cloud Billing',
  category: 'finance',
  brandColor: '#669DF6',
  tagline:
    'Track Google Cloud spend over time from the Cloud Billing -> BigQuery export, optionally broken down by service, project, SKU, or location.',
  vendor: {
    name: 'Google Cloud',
    domain: 'cloud.google.com',
    apiDocs:
      'https://cloud.google.com/billing/docs/how-to/export-data-bigquery',
    website: 'https://cloud.google.com/billing',
  },
  auth: {
    summary:
      'Authenticate against the BigQuery API with a Google service account JSON key. The service account needs the BigQuery Data Viewer role on the billing-export dataset and the BigQuery Job User role on the project that runs the queries.',
    setup: [
      'Enable the Cloud Billing -> BigQuery export in the GCP console (Billing -> Billing export -> BigQuery export). This is a manual one-time setup; data starts flowing into the configured dataset within a day.',
      'Create a service account at Google Cloud -> IAM & Admin -> Service Accounts (or grant an existing one access).',
      'Grant the service account roles/bigquery.dataViewer on the billing dataset (so it can read the export tables) and roles/bigquery.jobUser on the bqProject (so it can run query jobs).',
      'Generate a JSON key for the service account and store its contents as a secret (e.g. GCP_BILLING_SA_JSON).',
      'Reference the key from config as serviceAccountJson: secret("GCP_BILLING_SA_JSON") and set bqProject + bqDataset to the export location.',
    ],
  },
  rateLimit:
    'BigQuery jobs.query is rate-limited per project; standard 429 / RESOURCE_EXHAUSTED responses are retried with backoff. Each connector sync runs one query (or a small number when paginated).',
  limitations: [
    'Requires the Cloud Billing -> BigQuery export to be configured in the GCP console; that step is manual and one-time, and only days after the configuration date are present in the export.',
    'Queries the gcp_billing_export_v1_* table family (standard usage cost export). The detailed resource-level export (gcp_billing_export_resource_v1_*) is not used.',
    'Each BigQuery query is billed against the bqProject; over long windows or wide groupBy axes the cost adds up. Prefer narrow groupBy and reasonable lookbackDays.',
    'Cost data is back-revised by GCP for several days; an incremental sync refetches the trailing 5 days to pick up corrections.',
  ],
});

const COST_METRIC_NAME = 'gcp_cost_daily';
const DEFAULT_LOOKBACK_DAYS = 90;
const INCREMENTAL_LOOKBACK_DAYS = 5;
const DEFAULT_GROUP_BY: readonly Dimension[] = ['service'];

export interface GcpBillingSettings {
  bqProject: string;
  bqDataset: string;
  bqLocation?: string;
  groupBy?: readonly Dimension[];
  lookbackDays?: number;
}

const gcpBillingCredentials = {
  serviceAccountJson: {
    description: 'Google service account JSON key (raw JSON or base64)',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type GcpBillingCredentials = typeof gcpBillingCredentials;

export const gcpBillingResources = defineResources({
  [COST_METRIC_NAME]: {
    shape: 'metric',
    description:
      'Historical GCP cost per day, summed over the dimensions in `groupBy`. One sample per (date, dimension tuple). Pulls from the gcp_billing_export_v1_* tables in BigQuery.',
    endpoint: 'POST /bigquery/v2/projects/{bqProject}/queries',
    unit: 'USD',
    granularity: 'daily',
    notes:
      'BigQuery charges per query; prefer narrow groupBy and reasonable lookbackDays. The trailing 5 days are always refetched on incremental syncs to pick up back-revisions.',
    dimensions: [
      {
        name: 'service',
        description:
          'GCP service description (e.g. Compute Engine, BigQuery). Present when groupBy includes service.',
      },
      {
        name: 'project',
        description:
          'GCP project id the spend is attributed to. Present when groupBy includes project.',
      },
      {
        name: 'sku',
        description:
          'GCP SKU description (e.g. N1 Predefined Instance Core running in Americas). Present when groupBy includes sku.',
      },
      {
        name: 'location',
        description:
          'GCP location/region the spend is attributed to. Present when groupBy includes location.',
      },
      { name: 'currency', description: 'Billing currency reported by GCP.' },
    ],
    responses: {
      oauth_token: tokenResponseSchema,
      daily_cost: bqQueryResponseSchema,
    },
  },
});

export const id = 'gcp-billing';

export const cost: ConnectorCost = {
  recommendedInterval: '1 day',
  minInterval: '1 hour',
  perSync: '1 BigQuery query over the gcp_billing_export_v1_* table family',
  warning:
    'Each BigQuery query is billed against the bqProject. Prefer once-a-day syncs and a focused groupBy.',
};

export class GcpBillingConnector extends BaseConnector<
  GcpBillingSettings,
  GcpBillingCredentials
> {
  static readonly id = id;

  static readonly resources = gcpBillingResources;

  static readonly schemas = schemasFromResources(gcpBillingResources);

  static readonly cost = cost;

  static create(input: unknown, ctx?: ConnectorContext): GcpBillingConnector {
    const parsed = configFields.parse(input);
    return new GcpBillingConnector(
      {
        bqProject: parsed.bqProject,
        bqDataset: parsed.bqDataset,
        bqLocation: parsed.bqLocation,
        groupBy: parsed.groupBy,
        lookbackDays: parsed.lookbackDays,
      },
      { serviceAccountJson: parsed.serviceAccountJson },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = gcpBillingCredentials;

  private tokenProvider?: GcpAccessTokenProvider;

  private getAccessToken(signal?: AbortSignal): Promise<string> {
    this.tokenProvider ??= new GcpAccessTokenProvider({
      connectorId: this.id,
      scope: BQ_READONLY_SCOPE,
      getServiceAccountJson: () => this.creds.serviceAccountJson,
      post: (url, opts) =>
        this.post<{ access_token: string; expires_in?: number }>(url, opts),
    });
    return this.tokenProvider.getToken(signal);
  }

  private async fetchBigQueryPage(
    request: BqPageRequest,
    signal: AbortSignal | undefined,
  ): Promise<BqQueryResponse> {
    const accessToken = await this.getAccessToken(signal);
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'User-Agent': connectorUserAgent(this.id),
    };
    if (request.method === 'POST') {
      const res = await this.post<BqQueryResponse>(request.url, {
        resource: 'daily_cost',
        headers,
        body: request.body,
        signal,
      });
      return res.body;
    }
    const res = await this.get<BqQueryResponse>(request.url, {
      resource: 'daily_cost',
      headers,
      signal,
    });
    return res.body;
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const groupBy = this.settings.groupBy ?? DEFAULT_GROUP_BY;
    const window = getCostWindow(
      options,
      this.settings.lookbackDays ?? DEFAULT_LOOKBACK_DAYS,
    );
    const sql = buildBillingSql({
      bqProject: this.settings.bqProject,
      bqDataset: this.settings.bqDataset,
      groupBy,
      startDate: window.startDate,
      endDate: window.endDate,
    });

    const { rows: samples, aborted } = await collectBigQueryPages<MetricSample>(
      {
        projectId: this.settings.bqProject,
        sql,
        resource: 'daily_cost',
        location: this.settings.bqLocation,
        signal,
        logger: this.logger,
        mapRows: (response) => buildSamplesFromBqResponse(response, groupBy),
        jobIncompleteMessage: `${this.id}: BigQuery query did not complete within the synchronous timeout (jobComplete=false). Narrow the groupBy or lookbackDays so the query finishes faster.`,
        fetchPage: (request, sig) => this.fetchBigQueryPage(request, sig),
      },
    );
    if (aborted) {
      return { done: false };
    }
    await storage.metrics(samples, { names: [COST_METRIC_NAME] });
    return { done: true };
  }
}

interface CostWindow {
  startDate: string;
  endDate: string;
}

const DIM_TO_SELECT: Record<Dimension, { select: string; alias: string }> = {
  service: { select: 'service.description', alias: 'service' },
  project: { select: 'project.id', alias: 'project' },
  sku: { select: 'sku.description', alias: 'sku' },
  location: { select: 'location.location', alias: 'location' },
};

export function buildBillingSql(args: {
  bqProject: string;
  bqDataset: string;
  groupBy: readonly Dimension[];
  startDate: string;
  endDate: string;
}): string {
  const dims = args.groupBy.map((d) => DIM_TO_SELECT[d]);
  const selectCols = ['DATE(usage_start_time) AS date']
    .concat(dims.map((d) => `${d.select} AS ${d.alias}`))
    .concat(['SUM(cost) AS cost', 'ANY_VALUE(currency) AS currency']);
  const groupCols = ['date'].concat(dims.map((d) => d.alias));
  const table = `\`${args.bqProject}.${args.bqDataset}.gcp_billing_export_v1_*\``;
  return [
    `SELECT ${selectCols.join(', ')}`,
    `FROM ${table}`,
    `WHERE DATE(usage_start_time) >= DATE('${args.startDate}')`,
    `  AND DATE(usage_start_time) < DATE('${args.endDate}')`,
    `GROUP BY ${groupCols.join(', ')}`,
    `ORDER BY date`,
  ].join('\n');
}

export function getCostWindow(
  options: SyncOptions,
  lookbackDays: number,
  now: number = Date.now(),
): CostWindow {
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

export function buildSamplesFromBqResponse(
  response: z.infer<typeof bqQueryResponseSchema>,
  groupBy: readonly Dimension[],
): MetricSample[] {
  const fieldIndex = indexBqFields(response);

  const samples: MetricSample[] = [];
  for (const row of response.rows ?? []) {
    const dateValue = readCell(row.f, fieldIndex, 'date');
    if (dateValue === null) {
      continue;
    }
    const ts = parseBqDateOrEpoch(dateValue);
    if (ts === null) {
      continue;
    }
    const costValue = readCell(row.f, fieldIndex, 'cost');
    if (costValue === null) {
      continue;
    }
    const value = Number.parseFloat(costValue);
    if (!Number.isFinite(value)) {
      continue;
    }
    const attributes: Record<string, JSONValue> = {};
    for (const dim of groupBy) {
      const v = readCell(row.f, fieldIndex, dim);
      attributes[dim] = v ?? null;
    }
    const currency = readCell(row.f, fieldIndex, 'currency');
    if (currency !== null) {
      attributes['currency'] = currency;
    }
    samples.push({ name: COST_METRIC_NAME, ts, value, attributes });
  }
  return samples;
}
