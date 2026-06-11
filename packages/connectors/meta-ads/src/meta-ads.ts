import { connectorUserAgent } from '@rawdash/connector-shared';
import {
  BaseConnector,
  type ConnectorContext,
  type ConnectorDoc,
  type CredentialsSchema,
  type FetchSpec,
  type FilterClause,
  type StorageHandle,
  type SyncOptions,
  type SyncResult,
  defineConfigFields,
  defineConnectorDoc,
  defineResources,
  makeChunkedCursorGuard,
  paginateChunked,
  schemasFromResources,
  selectActivePhases,
} from '@rawdash/core';
import { z } from 'zod';

export const configFields = defineConfigFields(
  z.object({
    adAccountId: z
      .string()
      .trim()
      .regex(
        /^act_\d+$/,
        'Ad account ID must look like `act_<digits>` (e.g. `act_1234567890`)',
      )
      .meta({
        label: 'Ad account ID',
        description:
          'Meta Marketing API ad account ID. Find it in Ads Manager → Settings → Account info; it always starts with `act_`.',
        placeholder: 'act_1234567890',
      }),
    accessToken: z.object({ $secret: z.string() }).meta({
      label: 'System user access token',
      description:
        'Long-lived System User access token from Meta Business Manager with `ads_read` (and, for newer accounts, `read_insights`) scopes on the chosen ad account.',
      placeholder: 'EAAB...',
      secret: true,
    }),
    apiVersion: z
      .string()
      .regex(/^v\d+\.\d+$/, 'API version must look like `v21.0`')
      .optional()
      .meta({
        label: 'Graph API version',
        description:
          'Pin a specific Meta Graph API version (e.g. `v21.0`). Defaults to `v21.0`.',
        placeholder: 'v21.0',
      }),
    lookbackDays: z.number().int().positive().optional().meta({
      label: 'Lookback days (full sync)',
      description:
        'How many calendar days of insights to fetch on a full sync. Defaults to 90.',
      placeholder: '90',
    }),
    resources: z
      .array(
        z.enum([
          'campaigns',
          'campaign_insights',
          'adset_insights',
          'ad_insights',
        ]),
      )
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          'Which Meta resources to sync. Omit to sync all. Ad-level insights are the most expensive - leave them out if you only need campaign or adset rollups.',
      }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'Meta Ads',
  category: 'marketing',
  brandColor: '#0866FF',
  tagline:
    'Sync Meta (Facebook + Instagram) ad campaigns plus daily campaign, adset, and ad-level insights - spend, impressions, clicks, reach, conversions, and conversion value.',
  vendor: {
    name: 'Meta',
    domain: 'meta.com',
    apiDocs: 'https://developers.facebook.com/docs/marketing-api/insights',
    website: 'https://business.facebook.com',
  },
  auth: {
    summary:
      'A long-lived System User access token from Meta Business Manager, scoped with `ads_read` (and `read_insights` on newer accounts) for the target ad account.',
    setup: [
      'In Meta Business Manager → Business Settings → Users → System Users, create a System User (or reuse an existing one) and assign it to the ad account with at least the Advertiser role.',
      'Generate a System User access token for the System User; pick `ads_read` and (where available) `read_insights` as the scopes. Choose the longest available expiry - System User tokens can be made effectively non-expiring.',
      'Find the ad account ID in Ads Manager → Settings → Account info; it always starts with `act_`.',
      'Store the token as a secret and reference it from the connector config as `accessToken: secret("META_ACCESS_TOKEN")` alongside `adAccountId: "act_<id>"`.',
    ],
  },
  rateLimit:
    'Meta enforces per-app and per-ad-account budgets surfaced through the `X-Business-Use-Case-Usage` header. Sync at most every few hours per ad account; very large accounts may need a daily cadence.',
  limitations: [
    'Insights are always fetched at daily granularity. Sub-daily breakdowns are not supported.',
    'Insights for the most recent 30 days are re-fetched on every incremental sync because Meta keeps attributing conversions after the event date.',
    'Creative-level breakdowns (publisher_platform, placement, demographics) are intentionally out of scope to keep the metric cardinality bounded.',
  ],
});

export interface MetaAdsSettings {
  adAccountId: string;
  apiVersion?: string;
  lookbackDays?: number;
  resources?: readonly MetaAdsResource[];
}

const metaAdsCredentials = {
  accessToken: {
    description: 'Meta System User access token',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type MetaAdsCredentials = typeof metaAdsCredentials;

const PHASE_ORDER = [
  'campaigns',
  'campaign_insights',
  'adset_insights',
  'ad_insights',
] as const;

type MetaAdsPhase = (typeof PHASE_ORDER)[number];

export type MetaAdsResource = MetaAdsPhase;

const isMetaAdsSyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

const DEFAULT_API_VERSION = 'v21.0';
const BASE_URL = 'https://graph.facebook.com';
const PAGE_LIMIT = 100;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_LOOKBACK_DAYS = 90;
const INCREMENTAL_LOOKBACK_DAYS = 30;

const INSIGHTS_PHASES: ReadonlySet<MetaAdsPhase> = new Set([
  'campaign_insights',
  'adset_insights',
  'ad_insights',
]);

const PHASE_TO_LEVEL: Record<
  'campaign_insights' | 'adset_insights' | 'ad_insights',
  'campaign' | 'adset' | 'ad'
> = {
  campaign_insights: 'campaign',
  adset_insights: 'adset',
  ad_insights: 'ad',
};

const METRIC_NAME: Record<MetaAdsPhase, string> = {
  campaigns: 'meta_campaign',
  campaign_insights: 'meta_campaign_insights',
  adset_insights: 'meta_adset_insights',
  ad_insights: 'meta_ad_insights',
};

const CAMPAIGN_ENTITY_TYPE = 'meta_campaign';

function toMetaDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function metaDateToMs(metaDate: string): number {
  const [y, m, d] = metaDate.split('-').map((part) => Number(part));
  if (
    !Number.isFinite(y) ||
    !Number.isFinite(m) ||
    !Number.isFinite(d) ||
    y === undefined ||
    m === undefined ||
    d === undefined
  ) {
    return 0;
  }
  return Date.UTC(y, m - 1, d);
}

interface MetaDateRange {
  since: string;
  until: string;
}

function getDateRange(
  options: SyncOptions,
  lookbackDays: number,
): MetaDateRange {
  const now = Date.now();
  const until = toMetaDate(new Date(now));
  if (options.mode === 'latest' && options.since) {
    const startMs = now - (INCREMENTAL_LOOKBACK_DAYS - 1) * MS_PER_DAY;
    return { since: toMetaDate(new Date(startMs)), until };
  }
  if (options.since) {
    const sinceMs = new Date(options.since).getTime();
    if (Number.isFinite(sinceMs)) {
      const days = Math.max(1, Math.ceil((now - sinceMs) / MS_PER_DAY));
      const cappedDays = Math.min(days, lookbackDays);
      const startMs = now - (cappedDays - 1) * MS_PER_DAY;
      return { since: toMetaDate(new Date(startMs)), until };
    }
  }
  const startMs = now - (lookbackDays - 1) * MS_PER_DAY;
  return { since: toMetaDate(new Date(startMs)), until };
}

function parseNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function parseOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function sumActionValues(
  entries: ReadonlyArray<{ value?: unknown }> | undefined,
): number {
  if (!entries) {
    return 0;
  }
  let total = 0;
  for (const entry of entries) {
    total += parseNumber(entry.value);
  }
  return total;
}

const actionEntrySchema = z.object({
  action_type: z.string().optional(),
  value: z.union([z.string(), z.number()]).optional(),
});

const campaignSchema = z.object({
  id: z.string().min(1),
  name: z.string().nullish(),
  objective: z.string().nullish(),
  status: z.string().nullish(),
  effective_status: z.string().nullish(),
  daily_budget: z.union([z.string(), z.number()]).nullish(),
  lifetime_budget: z.union([z.string(), z.number()]).nullish(),
  created_time: z.string().nullish(),
  updated_time: z.string().nullish(),
});

const insightsBaseShape = {
  date_start: z.string(),
  date_stop: z.string().optional(),
  impressions: z.union([z.string(), z.number()]).optional(),
  clicks: z.union([z.string(), z.number()]).optional(),
  spend: z.union([z.string(), z.number()]).optional(),
  reach: z.union([z.string(), z.number()]).optional(),
  actions: z.array(actionEntrySchema).optional(),
  action_values: z.array(actionEntrySchema).optional(),
};

const campaignInsightSchema = z.object({
  ...insightsBaseShape,
  campaign_id: z.string().min(1),
  campaign_name: z.string().nullish(),
});

const adsetInsightSchema = z.object({
  ...insightsBaseShape,
  campaign_id: z.string().min(1),
  campaign_name: z.string().nullish(),
  adset_id: z.string().min(1),
  adset_name: z.string().nullish(),
});

const adInsightSchema = z.object({
  ...insightsBaseShape,
  campaign_id: z.string().min(1),
  campaign_name: z.string().nullish(),
  adset_id: z.string().min(1),
  adset_name: z.string().nullish(),
  ad_id: z.string().min(1),
  ad_name: z.string().nullish(),
});

const campaignsSchema = z.array(campaignSchema);
const campaignInsightsSchema = z.array(campaignInsightSchema);
const adsetInsightsSchema = z.array(adsetInsightSchema);
const adInsightsSchema = z.array(adInsightSchema);

export const metaAdsResources = defineResources({
  meta_campaign: {
    shape: 'entity',
    filterable: [
      {
        field: 'effectiveStatus',
        ops: ['eq'],
        values: [
          'ACTIVE',
          'PAUSED',
          'DELETED',
          'ARCHIVED',
          'IN_PROCESS',
          'WITH_ISSUES',
        ],
      },
    ],
    description:
      'Meta ad campaigns with name, objective, status, and budget. Upserted by id; one row per campaign in the ad account.',
    endpoint: 'GET /{ad_account_id}/campaigns',
    responses: { campaigns: campaignsSchema },
  },
  meta_campaign_insights: {
    shape: 'metric',
    description:
      'Daily campaign-level Meta Ads insights - spend (primary value), impressions, clicks, reach, conversions, and conversion value bucketed by campaign.',
    endpoint: 'GET /{ad_account_id}/insights?level=campaign&time_increment=1',
    unit: 'spend',
    granularity: 'day',
    notes:
      'Primary value is `spend`. `conversions` is the sum of every entry in the upstream `actions` array; `conversion_value` is the sum of every entry in `action_values`.',
    dimensions: [
      { name: 'date', description: 'Calendar day of the metric sample (UTC).' },
      { name: 'campaignId', description: 'Meta campaign id.' },
      { name: 'campaignName', description: 'Meta campaign name.' },
      { name: 'impressions', description: 'Total impressions on the day.' },
      { name: 'clicks', description: 'Total clicks on the day.' },
      { name: 'spend', description: 'Total spend (account currency).' },
      { name: 'reach', description: 'Unique reach on the day.' },
      { name: 'conversions', description: 'Total attributed actions.' },
      {
        name: 'conversion_value',
        description: 'Total attributed action value (account currency).',
      },
    ],
    responses: { campaign_insights: campaignInsightsSchema },
  },
  meta_adset_insights: {
    shape: 'metric',
    description:
      'Daily adset-level Meta Ads insights - same fields as the campaign roll-up, bucketed by adset.',
    endpoint: 'GET /{ad_account_id}/insights?level=adset&time_increment=1',
    unit: 'spend',
    granularity: 'day',
    notes:
      'Primary value is `spend`. Includes campaign_id/campaign_name so adset rows are easy to roll up to their parent campaign.',
    dimensions: [
      { name: 'date', description: 'Calendar day of the metric sample (UTC).' },
      { name: 'campaignId', description: 'Parent campaign id.' },
      { name: 'campaignName', description: 'Parent campaign name.' },
      { name: 'adsetId', description: 'Meta adset id.' },
      { name: 'adsetName', description: 'Meta adset name.' },
      { name: 'impressions', description: 'Total impressions on the day.' },
      { name: 'clicks', description: 'Total clicks on the day.' },
      { name: 'spend', description: 'Total spend (account currency).' },
      { name: 'reach', description: 'Unique reach on the day.' },
      { name: 'conversions', description: 'Total attributed actions.' },
      {
        name: 'conversion_value',
        description: 'Total attributed action value (account currency).',
      },
    ],
    responses: { adset_insights: adsetInsightsSchema },
  },
  meta_ad_insights: {
    shape: 'metric',
    description:
      'Daily ad-level Meta Ads insights - same fields as the adset roll-up, bucketed by ad.',
    endpoint: 'GET /{ad_account_id}/insights?level=ad&time_increment=1',
    unit: 'spend',
    granularity: 'day',
    notes:
      'Primary value is `spend`. Cardinality is the highest of the three insights resources - opt in via `resources: [..., "ad_insights"]` only when you need per-ad breakdowns.',
    dimensions: [
      { name: 'date', description: 'Calendar day of the metric sample (UTC).' },
      { name: 'campaignId', description: 'Parent campaign id.' },
      { name: 'campaignName', description: 'Parent campaign name.' },
      { name: 'adsetId', description: 'Parent adset id.' },
      { name: 'adsetName', description: 'Parent adset name.' },
      { name: 'adId', description: 'Meta ad id.' },
      { name: 'adName', description: 'Meta ad name.' },
      { name: 'impressions', description: 'Total impressions on the day.' },
      { name: 'clicks', description: 'Total clicks on the day.' },
      { name: 'spend', description: 'Total spend (account currency).' },
      { name: 'reach', description: 'Unique reach on the day.' },
      { name: 'conversions', description: 'Total attributed actions.' },
      {
        name: 'conversion_value',
        description: 'Total attributed action value (account currency).',
      },
    ],
    responses: { ad_insights: adInsightsSchema },
  },
});

export interface MetaActionEntry {
  action_type?: string;
  value?: string | number;
}

export interface MetaCampaign {
  id: string;
  name?: string | null;
  objective?: string | null;
  status?: string | null;
  effective_status?: string | null;
  daily_budget?: string | number | null;
  lifetime_budget?: string | number | null;
  created_time?: string | null;
  updated_time?: string | null;
}

interface MetaInsightsBase {
  date_start: string;
  date_stop?: string;
  impressions?: string | number;
  clicks?: string | number;
  spend?: string | number;
  reach?: string | number;
  actions?: MetaActionEntry[];
  action_values?: MetaActionEntry[];
}

export interface MetaCampaignInsight extends MetaInsightsBase {
  campaign_id: string;
  campaign_name?: string | null;
}

export interface MetaAdsetInsight extends MetaCampaignInsight {
  adset_id: string;
  adset_name?: string | null;
}

export interface MetaAdInsight extends MetaAdsetInsight {
  ad_id: string;
  ad_name?: string | null;
}

interface MetaPagedResponse<T> {
  data?: T[];
  paging?: {
    cursors?: { after?: string; before?: string };
    next?: string;
  };
}

export function campaignToEntity(row: MetaCampaign): {
  type: string;
  id: string;
  attributes: Record<string, string | number | null>;
  updated_at: number;
} {
  const updatedAt = row.updated_time
    ? new Date(row.updated_time).getTime()
    : row.created_time
      ? new Date(row.created_time).getTime()
      : 0;
  return {
    type: CAMPAIGN_ENTITY_TYPE,
    id: row.id,
    attributes: {
      name: row.name ?? null,
      objective: row.objective ?? null,
      status: row.status ?? null,
      effectiveStatus: row.effective_status ?? null,
      dailyBudget: parseOptionalNumber(row.daily_budget),
      lifetimeBudget: parseOptionalNumber(row.lifetime_budget),
      createdAt: row.created_time ? new Date(row.created_time).getTime() : null,
    },
    updated_at: Number.isFinite(updatedAt) ? updatedAt : 0,
  };
}

function buildInsightAttributes(
  row: MetaInsightsBase,
): Record<string, string | number | null> {
  const impressions = parseNumber(row.impressions);
  const clicks = parseNumber(row.clicks);
  const spend = parseNumber(row.spend);
  const reach = parseNumber(row.reach);
  const conversions = (row.actions ?? []).length
    ? sumActionValues(row.actions)
    : 0;
  const conversionValue = sumActionValues(row.action_values);
  return {
    date: row.date_start,
    impressions,
    clicks,
    spend,
    reach,
    conversions,
    conversion_value: conversionValue,
  };
}

export function insightRowToMetricSample(
  row: MetaCampaignInsight | MetaAdsetInsight | MetaAdInsight,
  phase: 'campaign_insights' | 'adset_insights' | 'ad_insights',
): {
  name: string;
  ts: number;
  value: number;
  attributes: Record<string, string | number | null>;
} {
  const attributes = buildInsightAttributes(row);
  attributes['campaignId'] = row.campaign_id;
  attributes['campaignName'] = row.campaign_name ?? null;
  if (phase !== 'campaign_insights') {
    const ar = row as MetaAdsetInsight;
    attributes['adsetId'] = ar.adset_id;
    attributes['adsetName'] = ar.adset_name ?? null;
  }
  if (phase === 'ad_insights') {
    const ar = row as MetaAdInsight;
    attributes['adId'] = ar.ad_id;
    attributes['adName'] = ar.ad_name ?? null;
  }
  return {
    name: METRIC_NAME[phase],
    ts: metaDateToMs(row.date_start),
    value: parseNumber(row.spend),
    attributes,
  };
}

const CAMPAIGN_FIELDS = [
  'id',
  'name',
  'objective',
  'status',
  'effective_status',
  'daily_budget',
  'lifetime_budget',
  'created_time',
  'updated_time',
].join(',');

const COMMON_INSIGHT_FIELDS = [
  'date_start',
  'date_stop',
  'campaign_id',
  'campaign_name',
  'impressions',
  'clicks',
  'spend',
  'reach',
  'actions',
  'action_values',
];

const INSIGHT_FIELDS: Record<
  'campaign_insights' | 'adset_insights' | 'ad_insights',
  string
> = {
  campaign_insights: COMMON_INSIGHT_FIELDS.join(','),
  adset_insights: [...COMMON_INSIGHT_FIELDS, 'adset_id', 'adset_name'].join(
    ',',
  ),
  ad_insights: [
    ...COMMON_INSIGHT_FIELDS,
    'adset_id',
    'adset_name',
    'ad_id',
    'ad_name',
  ].join(','),
};

export const id = 'meta-ads';

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

export class MetaAdsConnector extends BaseConnector<
  MetaAdsSettings,
  MetaAdsCredentials
> {
  static readonly id = id;

  static readonly resources = metaAdsResources;

  static readonly schemas = schemasFromResources(metaAdsResources);

  static create(input: unknown, ctx?: ConnectorContext): MetaAdsConnector {
    const parsed = configFields.parse(input);
    return new MetaAdsConnector(
      {
        adAccountId: parsed.adAccountId,
        apiVersion: parsed.apiVersion,
        lookbackDays: parsed.lookbackDays,
        resources: parsed.resources,
      },
      { accessToken: parsed.accessToken },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = metaAdsCredentials;

  private buildHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.creds.accessToken}`,
      'User-Agent': connectorUserAgent('meta-ads'),
    };
  }

  private apiVersion(): string {
    return this.settings.apiVersion ?? DEFAULT_API_VERSION;
  }

  private accountBase(): string {
    return `${BASE_URL}/${this.apiVersion()}/${this.settings.adAccountId}`;
  }

  private singleSpec(
    options: SyncOptions,
    resource: string,
  ): FetchSpec | undefined {
    const specs = options.fetchSpecs?.[resource];
    return specs && specs.length === 1 ? specs[0] : undefined;
  }

  private async fetchCampaignsPage(
    after: string | null,
    options: SyncOptions,
    signal: AbortSignal | undefined,
  ): Promise<{ items: unknown[]; next: string | null }> {
    const url = new URL(`${this.accountBase()}/campaigns`);
    url.searchParams.set('fields', CAMPAIGN_FIELDS);
    url.searchParams.set('limit', String(PAGE_LIMIT));
    const filter = this.singleSpec(options, CAMPAIGN_ENTITY_TYPE)?.filter;
    const effectiveStatus = pushableEq(filter, 'effectiveStatus');
    if (effectiveStatus !== null) {
      url.searchParams.set(
        'effective_status',
        JSON.stringify([effectiveStatus]),
      );
    }
    if (after) {
      url.searchParams.set('after', after);
    }
    const res = await this.get<MetaPagedResponse<MetaCampaign>>(
      url.toString(),
      {
        resource: 'campaigns',
        headers: this.buildHeaders(),
        signal,
      },
    );
    return {
      items: res.body.data ?? [],
      next: res.body.paging?.cursors?.after ?? null,
    };
  }

  private async fetchInsightsPage(
    phase: 'campaign_insights' | 'adset_insights' | 'ad_insights',
    dateRange: MetaDateRange,
    after: string | null,
    signal: AbortSignal | undefined,
  ): Promise<{ items: unknown[]; next: string | null }> {
    const url = new URL(`${this.accountBase()}/insights`);
    url.searchParams.set('level', PHASE_TO_LEVEL[phase]);
    url.searchParams.set('time_increment', '1');
    url.searchParams.set('fields', INSIGHT_FIELDS[phase]);
    url.searchParams.set(
      'time_range',
      JSON.stringify({ since: dateRange.since, until: dateRange.until }),
    );
    url.searchParams.set('limit', String(PAGE_LIMIT));
    if (after) {
      url.searchParams.set('after', after);
    }
    const res = await this.get<MetaPagedResponse<unknown>>(url.toString(), {
      resource: phase,
      headers: this.buildHeaders(),
      signal,
    });
    return {
      items: res.body.data ?? [],
      next: res.body.paging?.cursors?.after ?? null,
    };
  }

  private async writeCampaigns(
    storage: StorageHandle,
    items: MetaCampaign[],
  ): Promise<void> {
    for (const row of items) {
      await storage.entity(campaignToEntity(row));
    }
  }

  private async writeInsights(
    storage: StorageHandle,
    phase: 'campaign_insights' | 'adset_insights' | 'ad_insights',
    items: Array<MetaCampaignInsight | MetaAdsetInsight | MetaAdInsight>,
  ): Promise<void> {
    for (const row of items) {
      await storage.metric(insightRowToMetricSample(row, phase));
    }
  }

  private async clearScopeOnFirstPage(
    storage: StorageHandle,
    phase: MetaAdsPhase,
    isFull: boolean,
  ): Promise<void> {
    if (INSIGHTS_PHASES.has(phase)) {
      await storage.metrics([], { names: [METRIC_NAME[phase]] });
      return;
    }
    if (!isFull) {
      return;
    }
    await storage.entities([], { types: [CAMPAIGN_ENTITY_TYPE] });
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const cursor = isMetaAdsSyncCursor(options.cursor)
      ? options.cursor
      : undefined;
    const isFull = options.mode === 'full';
    const lookbackDays = this.settings.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
    const dateRange = getDateRange(options, lookbackDays);

    const phases = selectActivePhases<MetaAdsResource, MetaAdsPhase>(
      (r) => r,
      PHASE_ORDER,
      this.settings.resources,
    );

    return paginateChunked<MetaAdsPhase, string>({
      phases,
      cursor,
      signal,
      logger: this.logger,
      fetchPage: async (phase, page, sig) => {
        if (phase === 'campaigns') {
          return this.fetchCampaignsPage(page, options, sig);
        }
        return this.fetchInsightsPage(phase, dateRange, page, sig);
      },
      writeBatch: async (phase, items, page) => {
        if (page === null) {
          await this.clearScopeOnFirstPage(storage, phase, isFull);
        }
        if (phase === 'campaigns') {
          await this.writeCampaigns(storage, items as MetaCampaign[]);
          return;
        }
        await this.writeInsights(
          storage,
          phase,
          items as Array<
            MetaCampaignInsight | MetaAdsetInsight | MetaAdInsight
          >,
        );
      },
    });
  }
}
