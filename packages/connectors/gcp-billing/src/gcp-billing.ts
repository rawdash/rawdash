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

const BQ_IDENT_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const BQ_DATASET_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
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

const BQ_API_BASE = 'https://bigquery.googleapis.com/bigquery/v2';
const BQ_SCOPE = 'https://www.googleapis.com/auth/bigquery.readonly';
const COST_METRIC_NAME = 'gcp_cost_daily';
const DEFAULT_LOOKBACK_DAYS = 90;
const INCREMENTAL_LOOKBACK_DAYS = 5;
const MS_PER_DAY = 86_400_000;
const PAGE_SIZE = 10_000;
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

const bqQueryResponseSchema = z.object({
  jobComplete: z.boolean().optional(),
  schema: z
    .object({
      fields: z.array(z.object({ name: z.string(), type: z.string() })),
    })
    .optional(),
  rows: z
    .array(
      z.object({
        f: z.array(z.object({ v: z.string().nullable().optional() })),
      }),
    )
    .optional(),
  pageToken: z.string().optional(),
  jobReference: z
    .object({
      projectId: z.string(),
      jobId: z.string(),
      location: z.string().optional(),
    })
    .optional(),
});

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
      BQ_SCOPE,
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

  private async runQuery(
    accessToken: string,
    sql: string,
    pageToken: string | undefined,
    signal?: AbortSignal,
  ): Promise<z.infer<typeof bqQueryResponseSchema>> {
    const url = `${BQ_API_BASE}/projects/${encodeURIComponent(
      this.settings.bqProject,
    )}/queries`;

    const body: Record<string, unknown> = {
      query: sql,
      useLegacySql: false,
      maxResults: PAGE_SIZE,
      timeoutMs: 30_000,
    };
    if (this.settings.bqLocation !== undefined) {
      body['location'] = this.settings.bqLocation;
    }
    if (pageToken !== undefined) {
      body['pageToken'] = pageToken;
    }

    const res = await this.post<z.infer<typeof bqQueryResponseSchema>>(url, {
      resource: 'daily_cost',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': connectorUserAgent(this.id),
      },
      body: JSON.stringify(body),
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

    const samples: MetricSample[] = [];
    let pageToken: string | undefined;
    let page = 0;
    const phaseStart = Date.now();

    do {
      if (signal?.aborted) {
        return { done: false };
      }
      const accessToken = await this.getAccessToken(signal);
      let response: z.infer<typeof bqQueryResponseSchema>;
      try {
        response = await this.runQuery(accessToken, sql, pageToken, signal);
      } catch (err) {
        this.logger.warn('fetch page failed', {
          resource: 'daily_cost',
          page: page + 1,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
      if (response.jobComplete === false) {
        throw new Error(
          `${this.id}: BigQuery query did not complete within the synchronous timeout (jobComplete=false). Narrow the groupBy or lookbackDays so the query finishes faster.`,
        );
      }
      const pageSamples = buildSamplesFromBqResponse(response, groupBy);
      samples.push(...pageSamples);
      pageToken =
        typeof response.pageToken === 'string' && response.pageToken.length > 0
          ? response.pageToken
          : undefined;
      page += 1;
      this.logger.info('fetched page', {
        resource: 'daily_cost',
        page,
        items: pageSamples.length,
        next: pageToken ?? null,
      });
    } while (pageToken !== undefined);

    await storage.metrics(samples, { names: [COST_METRIC_NAME] });
    this.logger.info('resource done', {
      resource: 'daily_cost',
      pages: page,
      items: samples.length,
      duration_ms: Date.now() - phaseStart,
    });
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

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toDateStr(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function startOfUtcDay(ms: number): number {
  return Math.floor(ms / MS_PER_DAY) * MS_PER_DAY;
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
  const schema = response.schema?.fields ?? [];
  const fieldIndex: Record<string, number> = {};
  schema.forEach((field, idx) => {
    fieldIndex[field.name] = idx;
  });

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

function readCell(
  cells: ReadonlyArray<{ v?: string | null }>,
  fieldIndex: Record<string, number>,
  name: string,
): string | null {
  const idx = fieldIndex[name];
  if (idx === undefined) {
    return null;
  }
  const raw = cells[idx]?.v;
  if (raw === undefined || raw === null) {
    return null;
  }
  return raw;
}

function parseBqDateOrEpoch(value: string): number | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateMatch) {
    return Date.UTC(
      Number(dateMatch[1]),
      Number(dateMatch[2]) - 1,
      Number(dateMatch[3]),
    );
  }
  return parseEpoch(value, 'iso');
}
