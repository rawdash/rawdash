import { GcpAccessTokenProvider } from '@rawdash/connector-gcp-shared';
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
    customerId: z
      .string()
      .trim()
      .regex(
        /^\d{10}$/,
        'customerId must be the 10-digit Google Ads ID, digits only (no dashes)',
      )
      .meta({
        label: 'Customer ID',
        description:
          'Google Ads customer ID for the account to sync, digits only (the dashed form 123-456-7890 with the dashes removed).',
        placeholder: '1234567890',
      }),
    loginCustomerId: z
      .string()
      .trim()
      .regex(
        /^\d{10}$/,
        'loginCustomerId must be a 10-digit Google Ads ID, digits only',
      )
      .optional()
      .meta({
        label: 'Login Customer ID (MCC)',
        description:
          'Manager (MCC) account ID, digits only. Set this when the OAuth credential authenticates against an MCC that owns the customer account.',
        placeholder: '1234567890',
      }),
    clientId: z.string().min(1).meta({
      label: 'OAuth Client ID',
      description:
        'OAuth 2.0 client ID from a Google Cloud project that has the Google Ads API enabled.',
      placeholder: '…apps.googleusercontent.com',
    }),
    clientSecret: z.object({ $secret: z.string() }).meta({
      label: 'OAuth Client Secret',
      description: 'OAuth 2.0 client secret paired with the client ID above.',
      secret: true,
    }),
    refreshToken: z.object({ $secret: z.string() }).meta({
      label: 'OAuth Refresh Token',
      description:
        'Google OAuth 2.0 refresh token issued for the https://www.googleapis.com/auth/adwords scope.',
      secret: true,
    }),
    developerToken: z.object({ $secret: z.string() }).meta({
      label: 'Developer Token',
      description:
        'Google Ads API developer token from the manager account that owns API access (Tools → API Center).',
      secret: true,
    }),
    lookbackDays: z.number().int().positive().optional().meta({
      label: 'Lookback days (full sync)',
      description:
        'How many calendar days of metric history to fetch on a full sync. Defaults to 90.',
      placeholder: '90',
    }),
    resources: z
      .array(
        z.enum([
          'campaigns',
          'campaign_metrics',
          'ad_group_metrics',
          'keyword_metrics',
        ]),
      )
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          'Which Google Ads resources to sync. Omit to sync everything; pin a subset to avoid pulling keyword-level metrics on a quota-limited token.',
      }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'Google Ads',
  category: 'marketing',
  brandColor: '#4285F4',
  tagline:
    'Sync Google Ads campaigns plus daily campaign, ad-group, and keyword performance (impressions, clicks, cost, conversions) via GAQL.',
  vendor: {
    name: 'Google Ads',
    domain: 'ads.google.com',
    apiDocs: 'https://developers.google.com/google-ads/api/docs/start',
    website: 'https://ads.google.com',
  },
  auth: {
    summary:
      'OAuth 2.0 refresh token against an account with read access to the Google Ads customer, plus a developer token from the manager account that owns API access.',
    setup: [
      'Apply for Google Ads API access from your manager account (Tools → API Center). Copy the developer token - it lives on the manager, not the child account.',
      'In Google Cloud Console, enable the Google Ads API on a project, create an OAuth 2.0 client ID, and complete the OAuth consent flow for the adwords scope to obtain a refresh token. The official walkthrough is at https://developers.google.com/google-ads/api/docs/oauth/overview.',
      'Find the Google Ads customer ID at the top of the Ads UI (e.g. 123-456-7890) and store it without dashes (e.g. 1234567890).',
      'If the OAuth credential authenticates against an MCC that owns the customer, set `loginCustomerId` to the MCC id (digits only). For a direct-access account, omit it.',
      'Store the client secret, refresh token, and developer token as secrets, then reference them as `clientSecret: secret("GADS_CLIENT_SECRET")`, `refreshToken: secret("GADS_REFRESH_TOKEN")`, and `developerToken: secret("GADS_DEVELOPER_TOKEN")`.',
    ],
  },
  rateLimit:
    'Google Ads API basic-access tokens get a 15,000 operations / day quota per developer token; the connector treats 429 (RESOURCE_EXHAUSTED) as a transient error and the host backs off.',
  limitations: [
    'Cost values are stored in account currency units (cost_micros ÷ 1,000,000); the original micro-precision integer is also exposed in attributes.',
    'Keyword metrics use the historical (per-day) quality score from `metrics.historical_quality_score`; criteria with no impressions on a day will report a null quality score.',
    'Incremental syncs trail the last 3 days because Google Ads can attribute conversions to a click up to 3 days after the event.',
    'Audience-, asset-, and recommendation-level reporting are out of scope; this connector covers campaign / ad-group / keyword performance only.',
  ],
});

export interface GoogleAdsSettings {
  customerId: string;
  loginCustomerId?: string;
  lookbackDays?: number;
  resources?: readonly GoogleAdsResource[];
}

const googleAdsCredentials = {
  clientId: {
    description: 'Google OAuth 2.0 client ID (public, not a secret)',
    auth: 'required' as const,
  },
  clientSecret: {
    description: 'Google OAuth 2.0 client secret',
    auth: 'required' as const,
  },
  refreshToken: {
    description: 'Google OAuth 2.0 refresh token with the adwords scope',
    auth: 'required' as const,
  },
  developerToken: {
    description: 'Google Ads API developer token',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type GoogleAdsCredentials = typeof googleAdsCredentials;

const PHASE_ORDER = [
  'campaigns',
  'campaign_metrics',
  'ad_group_metrics',
  'keyword_metrics',
] as const;

type GoogleAdsPhase = (typeof PHASE_ORDER)[number];

export type GoogleAdsResource = GoogleAdsPhase;

const isGoogleAdsSyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

const API_VERSION = 'v18';
const PAGE_SIZE = 10_000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_LOOKBACK_DAYS = 90;
const INCREMENTAL_LOOKBACK_DAYS = 3;
const MICROS_PER_UNIT = 1_000_000;

const ENTITY_TYPE_CAMPAIGN = 'google_ads_campaign';
const METRIC_NAME: Record<GoogleAdsPhase, string> = {
  campaigns: ENTITY_TYPE_CAMPAIGN,
  campaign_metrics: 'google_ads_campaign_metrics',
  ad_group_metrics: 'google_ads_ad_group_metrics',
  keyword_metrics: 'google_ads_keyword_metrics',
};

const int64String = z.union([z.string().min(1), z.number()]);

const segmentsSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const campaignFieldsSchema = z.object({
  id: int64String,
  name: z.string().nullish(),
  status: z.string().nullish(),
  biddingStrategyType: z.string().nullish(),
  startDate: dateString.nullish(),
  endDate: dateString.nullish(),
  resourceName: z.string().nullish(),
});

const metricsSchema = z.object({
  impressions: int64String.nullish(),
  clicks: int64String.nullish(),
  costMicros: int64String.nullish(),
  conversions: z.number().nullish(),
  conversionsValue: z.number().nullish(),
  historicalQualityScore: int64String.nullish(),
});

const campaignRowSchema = z.object({
  campaign: campaignFieldsSchema,
});

const campaignMetricRowSchema = z.object({
  segments: segmentsSchema,
  campaign: z.object({
    id: int64String,
    name: z.string().nullish(),
    resourceName: z.string().nullish(),
  }),
  metrics: metricsSchema,
});

const adGroupMetricRowSchema = z.object({
  segments: segmentsSchema,
  campaign: z.object({ id: int64String }).nullish(),
  adGroup: z.object({
    id: int64String,
    name: z.string().nullish(),
    resourceName: z.string().nullish(),
  }),
  metrics: metricsSchema,
});

const keywordMetricRowSchema = z.object({
  segments: segmentsSchema,
  adGroup: z.object({ id: int64String }).nullish(),
  adGroupCriterion: z.object({
    criterionId: int64String,
    keyword: z
      .object({
        text: z.string().nullish(),
        matchType: z.string().nullish(),
      })
      .nullish(),
    resourceName: z.string().nullish(),
  }),
  metrics: metricsSchema,
});

const campaignsResponseSchema = z.array(campaignRowSchema);
const campaignMetricsResponseSchema = z.array(campaignMetricRowSchema);
const adGroupMetricsResponseSchema = z.array(adGroupMetricRowSchema);
const keywordMetricsResponseSchema = z.array(keywordMetricRowSchema);

type CampaignRow = z.infer<typeof campaignRowSchema>;
type CampaignMetricRow = z.infer<typeof campaignMetricRowSchema>;
type AdGroupMetricRow = z.infer<typeof adGroupMetricRowSchema>;
type KeywordMetricRow = z.infer<typeof keywordMetricRowSchema>;

export const googleAdsResources = defineResources({
  [ENTITY_TYPE_CAMPAIGN]: {
    shape: 'entity',
    filterable: [
      {
        field: 'status',
        ops: ['eq'],
        values: ['ENABLED', 'PAUSED', 'REMOVED'],
      },
    ],
    description:
      'Google Ads campaigns with id, name, status, bidding strategy type, and start / end dates.',
    endpoint: 'POST /v18/customers/{customerId}/googleAds:search',
    fields: [
      { name: 'id', description: 'Numeric Google Ads campaign id.' },
      { name: 'name', description: 'Campaign display name.' },
      {
        name: 'status',
        description:
          'Campaign status (ENABLED, PAUSED, REMOVED, UNKNOWN, UNSPECIFIED).',
      },
      {
        name: 'biddingStrategyType',
        description:
          'Bidding strategy in use (e.g. MAXIMIZE_CONVERSIONS, MANUAL_CPC).',
      },
      { name: 'startDate', description: 'Campaign start date (YYYY-MM-DD).' },
      {
        name: 'endDate',
        description: 'Campaign end date (YYYY-MM-DD), if set.',
      },
    ],
    responses: {
      oauth_token: z.object({
        access_token: z.string().min(1),
        expires_in: z.number().int().positive().optional(),
      }),
      campaigns: campaignsResponseSchema,
    },
  },
  google_ads_campaign_metrics: {
    shape: 'metric',
    description:
      'Daily campaign performance - impressions, clicks, cost, conversions, and conversion value per (date, campaignId).',
    endpoint: 'POST /v18/customers/{customerId}/googleAds:search',
    unit: 'USD',
    granularity: 'day',
    dimensions: [
      { name: 'date', description: 'Calendar day of the metric sample.' },
      { name: 'campaignId', description: 'Numeric Google Ads campaign id.' },
      {
        name: 'campaignName',
        description: 'Campaign display name at sync time.',
      },
      { name: 'impressions', description: 'Ad impressions served on the day.' },
      { name: 'clicks', description: 'Clicks recorded on the day.' },
      {
        name: 'cost',
        description:
          'Cost in account currency units (cost_micros ÷ 1,000,000).',
      },
      {
        name: 'costMicros',
        description: 'Raw cost in micros, as returned by the API.',
      },
      {
        name: 'conversions',
        description: 'Counted conversions attributed to the day.',
      },
      {
        name: 'conversionsValue',
        description: 'Total value of conversions for the day.',
      },
    ],
    notes:
      'Sample value is `cost` (account currency units). All other fields are mirrored in attributes for filtering and ratio metrics (CPA = cost / conversions, ROAS = conversionsValue / cost).',
    responses: { campaign_metrics: campaignMetricsResponseSchema },
  },
  google_ads_ad_group_metrics: {
    shape: 'metric',
    description:
      'Daily ad-group performance - impressions, clicks, cost, and conversions per (date, adGroupId).',
    endpoint: 'POST /v18/customers/{customerId}/googleAds:search',
    unit: 'USD',
    granularity: 'day',
    dimensions: [
      { name: 'date', description: 'Calendar day of the metric sample.' },
      { name: 'adGroupId', description: 'Numeric Google Ads ad-group id.' },
      {
        name: 'adGroupName',
        description: 'Ad-group display name at sync time.',
      },
      { name: 'campaignId', description: 'Parent campaign id.' },
      { name: 'impressions', description: 'Ad impressions served on the day.' },
      { name: 'clicks', description: 'Clicks recorded on the day.' },
      { name: 'cost', description: 'Cost in account currency units.' },
      {
        name: 'costMicros',
        description: 'Raw cost in micros, as returned by the API.',
      },
      {
        name: 'conversions',
        description: 'Counted conversions attributed to the day.',
      },
    ],
    responses: { ad_group_metrics: adGroupMetricsResponseSchema },
  },
  google_ads_keyword_metrics: {
    shape: 'metric',
    description:
      'Daily keyword performance - impressions, clicks, cost, and historical quality score per (date, criterionId).',
    endpoint: 'POST /v18/customers/{customerId}/googleAds:search',
    unit: 'USD',
    granularity: 'day',
    dimensions: [
      { name: 'date', description: 'Calendar day of the metric sample.' },
      {
        name: 'criterionId',
        description: 'Numeric keyword (ad-group criterion) id.',
      },
      { name: 'keywordText', description: 'Keyword text.' },
      {
        name: 'matchType',
        description: 'Match type (EXACT, PHRASE, BROAD, …).',
      },
      { name: 'adGroupId', description: 'Parent ad-group id.' },
      { name: 'impressions', description: 'Ad impressions served on the day.' },
      { name: 'clicks', description: 'Clicks recorded on the day.' },
      { name: 'cost', description: 'Cost in account currency units.' },
      {
        name: 'costMicros',
        description: 'Raw cost in micros, as returned by the API.',
      },
      {
        name: 'qualityScore',
        description:
          'Historical quality score for the day (1-10), null when no impressions.',
      },
    ],
    notes:
      'Driven by `keyword_view`; the cost / impression columns roll up to the criterion-day pair.',
    responses: { keyword_metrics: keywordMetricsResponseSchema },
  },
});

function toDateString(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function dateStringToMs(yyyyMmDd: string): number {
  const m = DATE_RE.exec(yyyyMmDd);
  if (!m) {
    return 0;
  }
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(ms) ? ms : 0;
}

interface DateRange {
  startDate: string;
  endDate: string;
}

function dateRangeToReplaceWindow(
  range: DateRange,
): { start: number; end: number } | undefined {
  const start = dateStringToMs(range.startDate);
  const end = dateStringToMs(range.endDate) + MS_PER_DAY - 1;
  if (start > end) {
    return undefined;
  }
  return { start, end };
}

export function getDateRange(
  options: SyncOptions,
  lookbackDays: number,
  now: number = Date.now(),
): DateRange {
  const endDate = toDateString(new Date(now));
  if (options.mode === 'latest') {
    const startMs = now - (INCREMENTAL_LOOKBACK_DAYS - 1) * MS_PER_DAY;
    return { startDate: toDateString(new Date(startMs)), endDate };
  }
  if (options.since) {
    const sinceMs = new Date(options.since).getTime();
    if (Number.isFinite(sinceMs)) {
      const days = Math.max(1, Math.ceil((now - sinceMs) / MS_PER_DAY));
      const cappedDays = Math.min(days, lookbackDays);
      const startMs = now - (cappedDays - 1) * MS_PER_DAY;
      return { startDate: toDateString(new Date(startMs)), endDate };
    }
  }
  const startMs = now - (lookbackDays - 1) * MS_PER_DAY;
  return { startDate: toDateString(new Date(startMs)), endDate };
}

function coerceInt(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === 'string' && value !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function coerceIntOrNull(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const n = coerceInt(value);
  return n;
}

function microsToUnits(micros: unknown): number {
  return coerceInt(micros) / MICROS_PER_UNIT;
}

const CAMPAIGN_STATUS_VALUES = new Set(['ENABLED', 'PAUSED', 'REMOVED']);

function singleSpec(specs: FetchSpec[] | undefined): FetchSpec | undefined {
  return specs && specs.length === 1 ? specs[0] : undefined;
}

function gaqlStringLiteral(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function pushableEq(
  filter: FilterClause[] | undefined,
  field: string,
): string | undefined {
  if (!filter) {
    return undefined;
  }
  for (const clause of filter) {
    if (!('field' in clause) || clause.field !== field || clause.op !== 'eq') {
      continue;
    }
    if (typeof clause.value === 'string') {
      return clause.value;
    }
  }
  return undefined;
}

function campaignsQuery(spec?: FetchSpec): string {
  const parts = [
    'SELECT',
    '  campaign.id,',
    '  campaign.name,',
    '  campaign.status,',
    '  campaign.bidding_strategy_type,',
    '  campaign.start_date,',
    '  campaign.end_date',
    'FROM campaign',
  ];
  const status = pushableEq(spec?.filter, 'status');
  if (status && CAMPAIGN_STATUS_VALUES.has(status)) {
    parts.push(`WHERE campaign.status = ${gaqlStringLiteral(status)}`);
  }
  return parts.join(' ');
}

function campaignMetricsQuery(range: DateRange): string {
  return [
    'SELECT',
    '  segments.date,',
    '  campaign.id,',
    '  campaign.name,',
    '  metrics.impressions,',
    '  metrics.clicks,',
    '  metrics.cost_micros,',
    '  metrics.conversions,',
    '  metrics.conversions_value',
    'FROM campaign',
    `WHERE segments.date BETWEEN '${range.startDate}' AND '${range.endDate}'`,
  ].join(' ');
}

function adGroupMetricsQuery(range: DateRange): string {
  return [
    'SELECT',
    '  segments.date,',
    '  campaign.id,',
    '  ad_group.id,',
    '  ad_group.name,',
    '  metrics.impressions,',
    '  metrics.clicks,',
    '  metrics.cost_micros,',
    '  metrics.conversions',
    'FROM ad_group',
    `WHERE segments.date BETWEEN '${range.startDate}' AND '${range.endDate}'`,
  ].join(' ');
}

function keywordMetricsQuery(range: DateRange): string {
  return [
    'SELECT',
    '  segments.date,',
    '  ad_group.id,',
    '  ad_group_criterion.criterion_id,',
    '  ad_group_criterion.keyword.text,',
    '  ad_group_criterion.keyword.match_type,',
    '  metrics.impressions,',
    '  metrics.clicks,',
    '  metrics.cost_micros,',
    '  metrics.historical_quality_score',
    'FROM keyword_view',
    `WHERE segments.date BETWEEN '${range.startDate}' AND '${range.endDate}'`,
  ].join(' ');
}

function queryForPhase(
  phase: GoogleAdsPhase,
  range: DateRange,
  campaignSpec?: FetchSpec,
): string {
  switch (phase) {
    case 'campaigns':
      return campaignsQuery(campaignSpec);
    case 'campaign_metrics':
      return campaignMetricsQuery(range);
    case 'ad_group_metrics':
      return adGroupMetricsQuery(range);
    case 'keyword_metrics':
      return keywordMetricsQuery(range);
  }
}

export function campaignToEntity(row: CampaignRow): {
  type: string;
  id: string;
  attributes: Record<string, string | number | null>;
  updated_at: number;
} {
  const c = row.campaign;
  const startMs = c.startDate ? dateStringToMs(c.startDate) : 0;
  return {
    type: ENTITY_TYPE_CAMPAIGN,
    id: String(c.id),
    attributes: {
      name: c.name ?? null,
      status: c.status ?? null,
      biddingStrategyType: c.biddingStrategyType ?? null,
      startDate: c.startDate ?? null,
      endDate: c.endDate ?? null,
      resourceName: c.resourceName ?? null,
    },
    updated_at: startMs,
  };
}

export function campaignMetricRowToSample(row: CampaignMetricRow): {
  name: string;
  ts: number;
  value: number;
  attributes: Record<string, string | number | null>;
} {
  const m = row.metrics;
  const cost = microsToUnits(m.costMicros);
  return {
    name: METRIC_NAME.campaign_metrics,
    ts: dateStringToMs(row.segments.date),
    value: cost,
    attributes: {
      date: row.segments.date,
      campaignId: String(row.campaign.id),
      campaignName: row.campaign.name ?? null,
      impressions: coerceInt(m.impressions),
      clicks: coerceInt(m.clicks),
      cost,
      costMicros: coerceInt(m.costMicros),
      conversions: typeof m.conversions === 'number' ? m.conversions : 0,
      conversionsValue:
        typeof m.conversionsValue === 'number' ? m.conversionsValue : 0,
    },
  };
}

export function adGroupMetricRowToSample(row: AdGroupMetricRow): {
  name: string;
  ts: number;
  value: number;
  attributes: Record<string, string | number | null>;
} {
  const m = row.metrics;
  const cost = microsToUnits(m.costMicros);
  return {
    name: METRIC_NAME.ad_group_metrics,
    ts: dateStringToMs(row.segments.date),
    value: cost,
    attributes: {
      date: row.segments.date,
      adGroupId: String(row.adGroup.id),
      adGroupName: row.adGroup.name ?? null,
      campaignId: row.campaign?.id != null ? String(row.campaign.id) : null,
      impressions: coerceInt(m.impressions),
      clicks: coerceInt(m.clicks),
      cost,
      costMicros: coerceInt(m.costMicros),
      conversions: typeof m.conversions === 'number' ? m.conversions : 0,
    },
  };
}

export function keywordMetricRowToSample(row: KeywordMetricRow): {
  name: string;
  ts: number;
  value: number;
  attributes: Record<string, string | number | null>;
} {
  const m = row.metrics;
  const cost = microsToUnits(m.costMicros);
  return {
    name: METRIC_NAME.keyword_metrics,
    ts: dateStringToMs(row.segments.date),
    value: cost,
    attributes: {
      date: row.segments.date,
      criterionId: String(row.adGroupCriterion.criterionId),
      keywordText: row.adGroupCriterion.keyword?.text ?? null,
      matchType: row.adGroupCriterion.keyword?.matchType ?? null,
      adGroupId: row.adGroup?.id != null ? String(row.adGroup.id) : null,
      impressions: coerceInt(m.impressions),
      clicks: coerceInt(m.clicks),
      cost,
      costMicros: coerceInt(m.costMicros),
      qualityScore: coerceIntOrNull(m.historicalQualityScore),
    },
  };
}

interface SearchResponse<TRow> {
  results?: TRow[];
  nextPageToken?: string;
}

export const id = 'google-ads';

export class GoogleAdsConnector extends BaseConnector<
  GoogleAdsSettings,
  GoogleAdsCredentials
> {
  static readonly id = id;

  static readonly resources = googleAdsResources;

  static readonly schemas = schemasFromResources(googleAdsResources);

  static create(input: unknown, ctx?: ConnectorContext): GoogleAdsConnector {
    const parsed = configFields.parse(input);
    return new GoogleAdsConnector(
      {
        customerId: parsed.customerId,
        loginCustomerId: parsed.loginCustomerId,
        lookbackDays: parsed.lookbackDays,
        resources: parsed.resources,
      },
      {
        clientId: parsed.clientId,
        clientSecret: parsed.clientSecret,
        refreshToken: parsed.refreshToken,
        developerToken: parsed.developerToken,
      },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = googleAdsCredentials;

  private tokenProvider?: GcpAccessTokenProvider;

  private getAccessToken(signal?: AbortSignal): Promise<string> {
    this.tokenProvider ??= new GcpAccessTokenProvider({
      connectorId: this.id,
      scope: 'https://www.googleapis.com/auth/adwords',
      getServiceAccountJson: () => undefined,
      getRefreshTokenCredentials: () => ({
        refreshToken: this.creds.refreshToken,
        clientId: this.creds.clientId,
        clientSecret: this.creds.clientSecret,
      }),
      post: (url, opts) =>
        this.post<{ access_token: string; expires_in?: number }>(url, opts),
    });
    return this.tokenProvider.getToken(signal);
  }

  private buildHeaders(accessToken: string): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'developer-token': this.creds.developerToken,
      'User-Agent': connectorUserAgent('google-ads'),
    };
    if (this.settings.loginCustomerId) {
      headers['login-customer-id'] = this.settings.loginCustomerId;
    }
    return headers;
  }

  private async searchPage<TRow>(
    phase: GoogleAdsPhase,
    range: DateRange,
    pageToken: string | null,
    campaignSpec: FetchSpec | undefined,
    signal?: AbortSignal,
  ): Promise<{ items: TRow[]; next: string | null }> {
    const token = await this.getAccessToken(signal);
    const url = `https://googleads.googleapis.com/${API_VERSION}/customers/${this.settings.customerId}/googleAds:search`;
    const body: Record<string, unknown> = {
      query: queryForPhase(phase, range, campaignSpec),
      pageSize: PAGE_SIZE,
    };
    if (pageToken) {
      body.pageToken = pageToken;
    }
    const res = await this.post<SearchResponse<TRow>>(url, {
      resource: phase,
      headers: this.buildHeaders(token),
      body: JSON.stringify(body),
      signal,
    });
    return {
      items: res.body.results ?? [],
      next: res.body.nextPageToken ?? null,
    };
  }

  private async writePhase(
    phase: GoogleAdsPhase,
    items: unknown[],
    storage: StorageHandle,
  ): Promise<void> {
    switch (phase) {
      case 'campaigns': {
        for (const row of items as CampaignRow[]) {
          await storage.entity(campaignToEntity(row));
        }
        return;
      }
      case 'campaign_metrics': {
        for (const row of items as CampaignMetricRow[]) {
          await storage.metric(campaignMetricRowToSample(row));
        }
        return;
      }
      case 'ad_group_metrics': {
        for (const row of items as AdGroupMetricRow[]) {
          await storage.metric(adGroupMetricRowToSample(row));
        }
        return;
      }
      case 'keyword_metrics': {
        for (const row of items as KeywordMetricRow[]) {
          await storage.metric(keywordMetricRowToSample(row));
        }
        return;
      }
    }
  }

  private async clearScopeOnFirstPage(
    phase: GoogleAdsPhase,
    storage: StorageHandle,
    isFull: boolean,
    replaceWindow: { start: number; end: number } | undefined,
  ): Promise<void> {
    if (phase === 'campaigns') {
      if (isFull) {
        await storage.entities([], { types: [ENTITY_TYPE_CAMPAIGN] });
      }
      return;
    }
    await storage.metrics([], {
      names: [METRIC_NAME[phase]],
      ...(replaceWindow ? { replaceWindow } : {}),
    });
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const lookbackDays = this.settings.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
    const range = getDateRange(options, lookbackDays);
    const replaceWindow = dateRangeToReplaceWindow(range);
    const isFull = options.mode === 'full';

    const phases = selectActivePhases<GoogleAdsResource, GoogleAdsPhase>(
      (r) => r,
      PHASE_ORDER,
      this.settings.resources,
    );

    const cursor = isGoogleAdsSyncCursor(options.cursor)
      ? options.cursor
      : undefined;

    const campaignSpec = singleSpec(options.fetchSpecs?.[ENTITY_TYPE_CAMPAIGN]);

    return paginateChunked<GoogleAdsPhase, string>({
      phases,
      cursor,
      signal,
      logger: this.logger,
      fetchPage: (phase, page, sig) =>
        this.searchPage<unknown>(phase, range, page, campaignSpec, sig),
      writeBatch: async (phase, items, page) => {
        if (page === null) {
          await this.clearScopeOnFirstPage(
            phase,
            storage,
            isFull,
            replaceWindow,
          );
        }
        await this.writePhase(phase, items, storage);
      },
    });
  }
}
