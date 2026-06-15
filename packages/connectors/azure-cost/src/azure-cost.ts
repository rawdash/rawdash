import {
  ARM_HOST,
  BaseAzureConnector,
  type BaseAzureSettings,
  isAllowedArmUrl,
  mapArmError,
} from '@rawdash/connector-azure-shared';
import {
  type HttpResponse,
  UpstreamBugError,
  connectorUserAgent,
} from '@rawdash/connector-shared';
import {
  type ConnectorContext,
  type ConnectorCost,
  type ConnectorDoc,
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

const dimensionValues = [
  'ResourceGroup',
  'ResourceGroupName',
  'ServiceName',
  'ServiceTier',
  'Meter',
  'MeterCategory',
  'MeterSubCategory',
  'ResourceId',
  'ResourceType',
  'ResourceLocation',
  'ChargeType',
  'PublisherType',
  'BillingPeriod',
  'InvoiceId',
  'SubscriptionId',
  'SubscriptionName',
] as const;

type CostDimension = (typeof dimensionValues)[number];

const groupByEntrySchema = z
  .string()
  .min(1)
  .regex(
    new RegExp(`^(${dimensionValues.join('|')}|TAG:.+)$`),
    `groupBy entries must be one of ${dimensionValues.join(', ')}, or TAG:<tag-key>`,
  );

export const configFields = defineConfigFields(
  z.object({
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
        'Azure subscription ID the cost query is scoped to. The service principal needs Cost Management Reader (or Reader) on this subscription.',
      placeholder: '00000000-0000-0000-0000-000000000000',
    }),
    groupBy: z
      .array(groupByEntrySchema)
      .max(2, 'Cost Management accepts at most two grouping dimensions')
      .optional()
      .meta({
        label: 'Group by (optional)',
        description:
          'Up to two Cost Management dimensions to break costs down by, e.g. ServiceName, ResourceGroup, or TAG:Environment. Omit for total cost only.',
      }),
    lookbackDays: z.number().int().positive().max(365).optional().meta({
      label: 'Backfill window (days)',
      description:
        'How many days of history to fetch on a full sync. Defaults to 90.',
      placeholder: '90',
    }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'Azure Cost Management',
  category: 'finance',
  brandColor: '#0078D4',
  tagline:
    'Track daily Azure spend over time, optionally broken down by resource group, service, or tag, via the Cost Management query API.',
  vendor: {
    name: 'Microsoft Azure',
    domain: 'azure.microsoft.com',
    apiDocs: 'https://learn.microsoft.com/en-us/rest/api/cost-management/',
    website: 'https://azure.microsoft.com/en-us/products/cost-management',
  },
  auth: {
    summary:
      'Authenticates with a Microsoft Entra ID (Azure AD) service principal (tenant ID + client ID + client secret) scoped to the target subscription. The principal needs the built-in Cost Management Reader role at the subscription scope (or Reader).',
    setup: [
      'In the Azure portal open Microsoft Entra ID → App registrations → New registration and create an app for rawdash.',
      'Under Certificates & secrets, generate a client secret and copy its value (it is only shown once).',
      'In the target subscription open Access control (IAM) → Add role assignment and grant the new service principal the built-in Cost Management Reader role.',
      'Store the client secret as a secret and reference it from config as `clientSecret: secret("AZ_CLIENT_SECRET")`, alongside `tenantId`, `clientId`, and `subscriptionId`.',
      'Cost Management must be enabled for the subscription; the first activation can take up to 24 hours before data is queryable.',
    ],
  },
  rateLimit:
    'Cost Management throttles via 429 responses with Retry-After; the shared HTTP client honors Retry-After and backs off on 429.',
  limitations: [
    'Cost data can be revised for a couple of days after the fact, so incremental syncs refetch a short trailing window.',
    'Daily granularity only (the most common dashboard slice). Monthly granularity is not exposed in v1.',
    'At most two grouping dimensions are accepted per query (Cost Management limit).',
    'Forecast (`forecast` endpoint) is not synced in v1; only historical actual cost.',
  ],
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AzureCostSettings extends BaseAzureSettings {
  groupBy?: readonly string[];
  lookbackDays?: number;
}

// ---------------------------------------------------------------------------
// API response schemas
// ---------------------------------------------------------------------------

const costColumnSchema = z.object({
  name: z.string(),
  type: z.string().optional(),
});

const costRowSchema = z.array(z.union([z.string(), z.number(), z.null()]));

const costQueryResponseSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  type: z.string().optional(),
  properties: z.object({
    nextLink: z.string().nullish(),
    columns: z.array(costColumnSchema),
    rows: z.array(costRowSchema),
  }),
});

// ---------------------------------------------------------------------------
// Runtime response shapes (permissive — assertions live in the Zod schemas)
// ---------------------------------------------------------------------------

interface CostColumn {
  name?: string;
  type?: string;
}

interface CostQueryProperties {
  nextLink?: string | null;
  columns?: CostColumn[];
  rows?: Array<Array<string | number | null>>;
}

interface CostQueryResponseBody {
  properties?: CostQueryProperties;
}

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

const DAILY_METRIC_NAME = 'azure_cost_daily';

export const azureCostResources = defineResources({
  azure_cost_daily: {
    shape: 'metric',
    description:
      'Daily Azure actual cost per time bucket, optionally split across the configured group-by dimensions.',
    endpoint:
      'POST /subscriptions/{subId}/providers/Microsoft.CostManagement/query',
    unit: 'currency reported by Azure',
    granularity: 'daily',
    notes:
      'Cost data can be revised for a couple of days after the fact, so incremental syncs refetch a short trailing window. Cost Management accepts at most two grouping dimensions per query.',
    dimensions: [
      {
        name: 'unit',
        description: 'Currency reported by Azure (e.g. USD, EUR).',
      },
      {
        name: 'service_name',
        description:
          'Azure service name, present when grouping by ServiceName (other dimensions appear under their normalized key, e.g. resource_group, tag_<key>).',
      },
    ],
    responses: { cost_query: costQueryResponseSchema },
  },
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COST_API_VERSION = '2024-08-01';
const DEFAULT_BACKFILL_DAYS = 90;
const INCREMENTAL_LOOKBACK_DAYS = 3;
const MS_PER_DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Pure helpers — exported for unit testing
// ---------------------------------------------------------------------------

function startOfUtcDay(ms: number): number {
  return Math.floor(ms / MS_PER_DAY) * MS_PER_DAY;
}

export interface CostWindow {
  from: string;
  to: string;
}

export function getCostWindow(
  options: SyncOptions,
  lookbackDays: number,
  now: number = Date.now(),
): CostWindow {
  const sinceMs = options.since !== undefined ? Date.parse(options.since) : NaN;
  const hasSince = Number.isFinite(sinceMs);

  let days = lookbackDays;
  if (options.mode === 'latest') {
    days = INCREMENTAL_LOOKBACK_DAYS;
  } else if (hasSince) {
    const elapsed = Math.ceil((now - sinceMs) / MS_PER_DAY);
    days = Math.min(Math.max(elapsed, 1), lookbackDays);
  }
  // Inclusive end at end of today UTC so the still-estimating current day is
  // captured and overwritten on each later sync.
  const todayStart = startOfUtcDay(now);
  const fromMs = todayStart - (days - 1) * MS_PER_DAY;
  const toMs = todayStart + MS_PER_DAY - 1;
  return {
    from: new Date(fromMs).toISOString(),
    to: new Date(toMs).toISOString(),
  };
}

function dimensionAttrKey(dimension: string): string {
  if (dimension.startsWith('TAG:')) {
    return `tag_${dimension.slice(4)}`;
  }
  // Normalize dimension names ("ResourceGroup" → "resource_group") so attribute
  // keys are stable regardless of the case Azure echoes back in column headers.
  return dimension
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}

function toGrouping(dimension: string): { type: string; name: string } {
  if (dimension.startsWith('TAG:')) {
    return { type: 'TagKey', name: dimension.slice(4) };
  }
  return { type: 'Dimension', name: dimension };
}

function parseUsageDate(value: string | number | null): number | null {
  if (value === null) {
    return null;
  }
  // Cost Management returns UsageDate as an integer YYYYMMDD (column type
  // 'Number') for Daily granularity. We normalize to the start-of-day Unix ms.
  const s = String(value);
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (!m) {
    return null;
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const ts = Date.UTC(year, month - 1, day);
  if (!Number.isFinite(ts)) {
    return null;
  }
  const d = new Date(ts);
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return null;
  }
  return ts;
}

interface ColumnLookup {
  costIdx: number | null;
  dateIdx: number | null;
  currencyIdx: number | null;
  // Map of grouping dimension (as configured) -> column index.
  groupingIdx: Map<string, number>;
}

function lookupColumns(
  columns: CostColumn[] | undefined,
  groupBy: readonly string[] | undefined,
): ColumnLookup {
  const out: ColumnLookup = {
    costIdx: null,
    dateIdx: null,
    currencyIdx: null,
    groupingIdx: new Map(),
  };
  const named = columns ?? [];
  for (let i = 0; i < named.length; i++) {
    const name = named[i]?.name ?? '';
    const lower = name.toLowerCase();
    if (lower === 'cost' || lower === 'costusd' || lower === 'pretaxcost') {
      out.costIdx = i;
    } else if (lower === 'usagedate' || lower === 'date') {
      out.dateIdx = i;
    } else if (lower === 'currency') {
      out.currencyIdx = i;
    }
  }
  if (groupBy) {
    for (const dim of groupBy) {
      const wantName = dim.startsWith('TAG:') ? dim.slice(4) : dim;
      const idx = named.findIndex(
        (c) =>
          (c.name ?? '').toLowerCase() === wantName.toLowerCase() ||
          // Cost Management sometimes prefixes tag columns with TagValue.
          (c.name ?? '').toLowerCase() === `tagvalue${wantName.toLowerCase()}`,
      );
      if (idx >= 0) {
        out.groupingIdx.set(dim, idx);
      }
    }
  }
  return out;
}

export function buildCostSamples(
  body: CostQueryResponseBody,
  groupBy: readonly string[] | undefined,
): MetricSample[] {
  const props = body.properties;
  if (!props) {
    return [];
  }
  const lookup = lookupColumns(props.columns, groupBy);
  if (lookup.costIdx === null || lookup.dateIdx === null) {
    return [];
  }
  const samples: MetricSample[] = [];
  for (const row of props.rows ?? []) {
    const rawCost = row[lookup.costIdx];
    const rawDate = row[lookup.dateIdx];
    if (rawCost === null || rawCost === undefined) {
      continue;
    }
    const cost =
      typeof rawCost === 'number'
        ? rawCost
        : Number.parseFloat(String(rawCost));
    if (!Number.isFinite(cost)) {
      continue;
    }
    const ts = parseUsageDate(
      typeof rawDate === 'string' || typeof rawDate === 'number'
        ? rawDate
        : null,
    );
    if (ts === null) {
      continue;
    }
    const currency =
      lookup.currencyIdx !== null ? (row[lookup.currencyIdx] ?? null) : null;
    const attributes: Record<string, JSONValue> = {
      unit: typeof currency === 'string' ? currency : (currency ?? 'unknown'),
    };
    for (const [dim, idx] of lookup.groupingIdx.entries()) {
      const val = row[idx];
      attributes[dimensionAttrKey(dim)] =
        typeof val === 'string' || typeof val === 'number' || val === null
          ? val
          : null;
    }
    samples.push({
      name: DAILY_METRIC_NAME,
      ts,
      value: cost,
      attributes,
    });
  }
  return samples;
}

// ---------------------------------------------------------------------------
// AzureCostConnector
// ---------------------------------------------------------------------------

export const id = 'azure-cost';

export const cost: ConnectorCost = {
  recommendedInterval: '1 day',
  minInterval: '1 hour',
  warning:
    'Azure Cost Management queries are throttled aggressively per subscription; avoid syncing more often than necessary.',
};

export class AzureCostConnector extends BaseAzureConnector<AzureCostSettings> {
  static readonly id = id;

  static readonly resources = azureCostResources;

  static readonly schemas = schemasFromResources(azureCostResources);

  static readonly cost = cost;

  static create(input: unknown, ctx?: ConnectorContext): AzureCostConnector {
    const parsed = configFields.parse(input);
    return new AzureCostConnector(
      {
        tenantId: parsed.tenantId,
        clientId: parsed.clientId,
        subscriptionId: parsed.subscriptionId,
        groupBy: parsed.groupBy,
        lookbackDays: parsed.lookbackDays,
      },
      { clientSecret: parsed.clientSecret },
      ctx,
    );
  }

  readonly id = id;

  private queryUrl(): string {
    const params = new URLSearchParams();
    params.set('api-version', COST_API_VERSION);
    return `${ARM_HOST}/subscriptions/${encodeURIComponent(this.settings.subscriptionId)}/providers/Microsoft.CostManagement/query?${params.toString()}`;
  }

  private buildQueryPayload(window: CostWindow): Record<string, unknown> {
    const groupBy = this.settings.groupBy ?? [];
    const grouping = groupBy.slice(0, 2).map(toGrouping);
    return {
      type: 'ActualCost',
      timeframe: 'Custom',
      timePeriod: { from: window.from, to: window.to },
      dataset: {
        granularity: 'Daily',
        aggregation: {
          totalCost: { name: 'Cost', function: 'Sum' },
        },
        ...(grouping.length > 0 ? { grouping } : {}),
      },
    };
  }

  private async runQuery(
    url: string,
    payload: Record<string, unknown> | undefined,
    signal?: AbortSignal,
  ): Promise<HttpResponse<CostQueryResponseBody>> {
    const token = await this.getAccessToken(signal);
    try {
      return await this.post<CostQueryResponseBody>(url, {
        resource: 'cost_query',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': connectorUserAgent(this.id),
        },
        body: payload ? JSON.stringify(payload) : undefined,
        signal,
      });
    } catch (err) {
      throw mapArmError(err);
    }
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    if (
      options.resources &&
      options.resources.size > 0 &&
      !options.resources.has('azure_cost_daily')
    ) {
      return { done: true };
    }

    const lookbackDays = this.settings.lookbackDays ?? DEFAULT_BACKFILL_DAYS;
    const window = getCostWindow(options, lookbackDays);
    const payload = this.buildQueryPayload(window);
    const phaseStart = Date.now();
    const samples: MetricSample[] = [];
    let pages = 0;

    let url = this.queryUrl();
    let body: Record<string, unknown> | undefined = payload;
    const seenNextLinks = new Set<string>();
    while (true) {
      if (signal?.aborted) {
        return { done: false };
      }
      const res = await this.runQuery(url, body, signal);
      const chunk = buildCostSamples(res.body, this.settings.groupBy);
      samples.push(...chunk);
      pages += 1;
      this.logger.info('fetched page', {
        resource: 'cost_query',
        page: pages,
        items: chunk.length,
      });
      const next = res.body.properties?.nextLink;
      if (typeof next === 'string' && next.length > 0) {
        if (!isAllowedArmUrl(next)) {
          throw new UpstreamBugError(
            `Azure Cost nextLink rejected by ARM host allowlist: ${next}`,
            res,
          );
        }
        if (seenNextLinks.has(next)) {
          throw new UpstreamBugError(
            `Azure Cost pagination cycle detected for nextLink: ${next}`,
            res,
          );
        }
        seenNextLinks.add(next);
        url = next;
        // Cost Management's nextLink is a continuation token URL; the request
        // body is empty on subsequent calls.
        body = undefined;
      } else {
        break;
      }
    }

    await storage.metrics(samples, { names: [DAILY_METRIC_NAME] });
    this.logger.info('resource done', {
      resource: 'cost_query',
      pages,
      items: samples.length,
      duration_ms: Date.now() - phaseStart,
    });
    return { done: true };
  }
}

// Exported only so it shows up in the connector's typed surface for tests.
export type { CostDimension };
