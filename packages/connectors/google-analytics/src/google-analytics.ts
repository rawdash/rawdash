import { GcpAccessTokenProvider } from '@rawdash/connector-gcp-shared';
import { connectorUserAgent } from '@rawdash/connector-shared';
import {
  BaseConnector,
  type ConnectorContext,
  type ConnectorDoc,
  type CredentialsSchema,
  type StorageHandle,
  type SyncOptions,
  type SyncResult,
  defineConfigFields,
  defineConnectorDoc,
  defineResources,
  schemasFromResources,
} from '@rawdash/core';
import { z } from 'zod';

export const configFields = defineConfigFields(
  z
    .object({
      propertyId: z
        .string()
        .trim()
        .regex(/^\d+$/, 'GA4 Property ID must be digits only')
        .meta({
          label: 'GA4 Property ID',
          description:
            'Numeric ID of your GA4 property (e.g. 123456789). Find it in Google Analytics → Admin → Property settings.',
          placeholder: '123456789',
        }),
      serviceAccountJson: z.object({ $secret: z.string() }).optional().meta({
        label: 'Service Account JSON (recommended)',
        description:
          'Contents of the JSON key file for a Google service account with the Analytics Viewer role. Create one at Google Cloud → IAM & Admin → Service Accounts.',
        secret: true,
      }),
      refreshToken: z.object({ $secret: z.string() }).optional().meta({
        label: 'OAuth Refresh Token',
        description:
          'Google OAuth 2.0 refresh token with analytics.readonly scope. Required if not using serviceAccountJson.',
        secret: true,
      }),
      clientId: z.string().optional().meta({
        label: 'OAuth Client ID',
        description:
          'OAuth 2.0 client ID from Google Cloud Console. Required when using refreshToken auth.',
        placeholder: '…apps.googleusercontent.com',
      }),
      clientSecret: z.object({ $secret: z.string() }).optional().meta({
        label: 'OAuth Client Secret',
        description:
          'OAuth 2.0 client secret from Google Cloud Console. Required when using refreshToken auth.',
        secret: true,
      }),
      lookbackDays: z.number().int().positive().optional().meta({
        label: 'Lookback days (full sync)',
        description:
          'How many calendar days to fetch on a full sync. Defaults to 90.',
        placeholder: '90',
      }),
    })
    .refine(
      (val) =>
        val.serviceAccountJson !== undefined ||
        (val.refreshToken !== undefined &&
          val.clientId !== undefined &&
          val.clientSecret !== undefined),
      {
        message:
          'Provide either serviceAccountJson or the full OAuth tuple (refreshToken + clientId + clientSecret)',
      },
    ),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'Google Analytics',
  category: 'analytics',
  brandColor: '#E37400',
  tagline:
    'Sync daily GA4 traffic, acquisition, top pages, events, conversions, and geography metrics from a Google Analytics 4 property.',
  vendor: {
    name: 'Google Analytics',
    domain: 'analytics.google.com',
    apiDocs:
      'https://developers.google.com/analytics/devguides/reporting/data/v1',
    website: 'https://analytics.google.com',
  },
  auth: {
    summary:
      'Authenticate against the GA4 Data API with either a Google service account JSON key (recommended) or an OAuth 2.0 refresh-token tuple. The identity must have at least the Analytics Viewer role on the property.',
    setup: [
      'Find your GA4 Property ID under Google Analytics -> Admin -> Property settings (numeric, e.g. 123456789).',
      'Recommended: create a service account at Google Cloud -> IAM & Admin -> Service Accounts, generate a JSON key, and grant it the Analytics Viewer role on the property. Store the JSON as a secret and reference it as serviceAccountJson: secret("GA4_SERVICE_ACCOUNT_JSON").',
      'Alternative: provide an OAuth 2.0 refresh token with the analytics.readonly scope together with its clientId and clientSecret from the Google Cloud Console.',
    ],
  },
  rateLimit:
    'GA4 Data API quota is 200,000 tokens/day per property (default); 429 responses are retried automatically with exponential backoff.',
  limitations: [
    'Incremental syncs use a 30-day window because GA4 can attribute conversions up to 3 days after the session.',
    'Report pagination is 10,000 rows per page.',
  ],
});

export interface GA4Settings {
  propertyId: string;
  lookbackDays?: number;
}

const ga4Credentials = {
  serviceAccountJson: {
    description: 'Google service account JSON key (base64 or raw JSON)',
    auth: 'optional' as const,
  },
  refreshToken: {
    description: 'Google OAuth 2.0 refresh token',
    auth: 'optional' as const,
  },
  clientId: {
    description: 'Google OAuth 2.0 client ID',
    auth: 'optional' as const,
  },
  clientSecret: {
    description: 'Google OAuth 2.0 client secret',
    auth: 'optional' as const,
  },
} satisfies CredentialsSchema;

type GA4Credentials = typeof ga4Credentials;

const PHASE_ORDER = [
  'traffic_by_day',
  'traffic_by_source',
  'top_pages',
  'events',
  'conversions',
  'geo',
] as const;

type GA4Phase = (typeof PHASE_ORDER)[number];

interface GA4DateRange {
  startDate: string;
  endDate: string;
}

interface GA4SyncCursor {
  phase: GA4Phase;
  dateRange: GA4DateRange;
}

const GA4_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isGA4DateString(value: unknown): value is string {
  return typeof value === 'string' && GA4_DATE_RE.test(value);
}

function isGA4DateRange(value: unknown): value is GA4DateRange {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const v = value as { startDate?: unknown; endDate?: unknown };
  return isGA4DateString(v.startDate) && isGA4DateString(v.endDate);
}

function isGA4SyncCursor(value: unknown): value is GA4SyncCursor {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const v = value as { phase?: unknown; dateRange?: unknown };
  if (typeof v.phase !== 'string') {
    return false;
  }
  if (!(PHASE_ORDER as readonly string[]).includes(v.phase)) {
    return false;
  }
  return isGA4DateRange(v.dateRange);
}

interface PhaseConfig {
  dimensions: string[];
  metrics: string[];
  metricName: string;
}

const PHASE_CONFIGS: Record<GA4Phase, PhaseConfig> = {
  traffic_by_day: {
    dimensions: ['date'],
    metrics: [
      'sessions',
      'totalUsers',
      'newUsers',
      'screenPageViews',
      'engagementRate',
    ],
    metricName: 'ga4_traffic_by_day',
  },
  traffic_by_source: {
    dimensions: ['date', 'sessionSource', 'sessionMedium'],
    metrics: ['sessions', 'keyEvents'],
    metricName: 'ga4_traffic_by_source',
  },
  top_pages: {
    dimensions: ['date', 'pagePath'],
    metrics: ['screenPageViews', 'averageSessionDuration'],
    metricName: 'ga4_top_pages',
  },
  events: {
    dimensions: ['date', 'eventName'],
    metrics: ['eventCount', 'totalUsers'],
    metricName: 'ga4_events',
  },
  conversions: {
    dimensions: ['date', 'eventName'],
    metrics: ['keyEvents', 'totalRevenue'],
    metricName: 'ga4_conversions',
  },
  geo: {
    dimensions: ['date', 'country'],
    metrics: ['sessions', 'totalUsers'],
    metricName: 'ga4_geo',
  },
};

const ROWS_PER_PAGE = 10_000;

export interface GA4DimensionValue {
  value: string;
}

export interface GA4MetricValue {
  value: string;
}

export interface GA4ReportRow {
  dimensionValues: GA4DimensionValue[];
  metricValues: GA4MetricValue[];
}

interface GA4ReportResponse {
  rows?: GA4ReportRow[];
  rowCount?: number;
  dimensionHeaders?: Array<{ name: string }>;
  metricHeaders?: Array<{ name: string; type: string }>;
}

function toGA4Date(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function ga4DateToMs(ga4Date: string): number {
  const y = ga4Date.slice(0, 4);
  const m = ga4Date.slice(4, 6);
  const d = ga4Date.slice(6, 8);
  return Date.UTC(Number(y), Number(m) - 1, Number(d));
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const INCREMENTAL_LOOKBACK_DAYS = 30;

function isResourceAllowed(options: SyncOptions, resource: string): boolean {
  if (!options.resources || options.resources.size === 0) {
    return true;
  }
  return options.resources.has(resource);
}

function getDateRange(
  options: SyncOptions,
  lookbackDays: number,
): GA4DateRange {
  const now = Date.now();
  const endDate = toGA4Date(new Date(now));
  if (options.mode === 'latest' && options.since) {
    const startMs = now - (INCREMENTAL_LOOKBACK_DAYS - 1) * MS_PER_DAY;
    return { startDate: toGA4Date(new Date(startMs)), endDate };
  }
  if (options.since) {
    const sinceMs = new Date(options.since).getTime();
    if (Number.isFinite(sinceMs)) {
      const days = Math.max(1, Math.ceil((now - sinceMs) / MS_PER_DAY));
      const cappedDays = Math.min(days, lookbackDays);
      const startMs = now - (cappedDays - 1) * MS_PER_DAY;
      return { startDate: toGA4Date(new Date(startMs)), endDate };
    }
  }
  const startMs = now - (lookbackDays - 1) * MS_PER_DAY;
  return { startDate: toGA4Date(new Date(startMs)), endDate };
}

export function rowToMetricSample(
  row: GA4ReportRow,
  dimensionHeaders: string[],
  metricHeaders: string[],
  metricName: string,
): {
  name: string;
  ts: number;
  value: number;
  attributes: Record<string, string | number>;
} {
  const dims: Record<string, string> = {};
  for (let i = 0; i < dimensionHeaders.length; i++) {
    dims[dimensionHeaders[i]!] = row.dimensionValues[i]?.value ?? '';
  }

  const mets: Record<string, number> = {};
  for (let i = 0; i < metricHeaders.length; i++) {
    mets[metricHeaders[i]!] =
      parseFloat(row.metricValues[i]?.value ?? '0') || 0;
  }

  const dateStr = dims['date'] ?? '19700101';
  const ts = ga4DateToMs(dateStr);
  const primaryValue = mets[metricHeaders[0]!] ?? 0;

  return {
    name: metricName,
    ts,
    value: primaryValue,
    attributes: { ...dims, ...mets },
  };
}

const dateDimensionValue = z.object({
  value: z.string().regex(/^(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/),
});

const stringDimensionValue = z.object({ value: z.string() });
const numericMetricValue = z.object({
  value: z.string().regex(/^-?\d+(\.\d+)?$/),
});

function reportSchema(dimensionCount: number) {
  const dims =
    dimensionCount === 1
      ? z.tuple([dateDimensionValue])
      : z.tuple([
          dateDimensionValue,
          ...Array(dimensionCount - 1).fill(stringDimensionValue),
        ] as [typeof dateDimensionValue, ...z.ZodType[]]);
  return z.object({
    rows: z
      .array(
        z.object({
          dimensionValues: dims,
          metricValues: z.array(numericMetricValue).nonempty(),
        }),
      )
      .optional(),
  });
}

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive().optional(),
});

export const googleAnalyticsResources = defineResources({
  ga4_traffic_by_day: {
    shape: 'metric',
    description:
      'Daily site traffic totals - sessions, total users, new users, page views, and engagement rate.',
    unit: 'sessions',
    granularity: 'day',
    endpoint: 'POST /v1beta/properties/{propertyId}:runReport',
    dimensions: [
      { name: 'date', description: 'Calendar day of the metric sample.' },
    ],
    responses: {
      oauth_token: tokenResponseSchema,
      traffic_by_day: reportSchema(1),
    },
  },
  ga4_traffic_by_source: {
    shape: 'metric',
    description:
      'Daily sessions and key events (conversions) broken down by acquisition source and medium.',
    unit: 'sessions',
    granularity: 'day',
    endpoint: 'POST /v1beta/properties/{propertyId}:runReport',
    dimensions: [
      { name: 'date', description: 'Calendar day of the metric sample.' },
      {
        name: 'sessionSource',
        description: 'Origin of the session (e.g. google, direct, newsletter).',
      },
      {
        name: 'sessionMedium',
        description:
          'Acquisition medium of the session (e.g. organic, cpc, referral).',
      },
    ],
    responses: { traffic_by_source: reportSchema(3) },
  },
  ga4_top_pages: {
    shape: 'metric',
    description:
      'Daily page views and average session duration bucketed by page path.',
    unit: 'page_views',
    granularity: 'day',
    endpoint: 'POST /v1beta/properties/{propertyId}:runReport',
    dimensions: [
      { name: 'date', description: 'Calendar day of the metric sample.' },
      {
        name: 'pagePath',
        description: 'URL path of the page that was viewed.',
      },
    ],
    responses: { top_pages: reportSchema(2) },
  },
  ga4_events: {
    shape: 'metric',
    description:
      'Daily event counts and the users that triggered them, bucketed by event name.',
    unit: 'events',
    granularity: 'day',
    endpoint: 'POST /v1beta/properties/{propertyId}:runReport',
    dimensions: [
      { name: 'date', description: 'Calendar day of the metric sample.' },
      {
        name: 'eventName',
        description: 'GA4 event name (e.g. page_view, scroll, click).',
      },
    ],
    responses: { events: reportSchema(2) },
  },
  ga4_conversions: {
    shape: 'metric',
    description:
      'Daily key event (conversion) counts and total revenue bucketed by key event name.',
    unit: 'conversions',
    granularity: 'day',
    endpoint: 'POST /v1beta/properties/{propertyId}:runReport',
    dimensions: [
      { name: 'date', description: 'Calendar day of the metric sample.' },
      {
        name: 'eventName',
        description:
          'GA4 key event (conversion) name (e.g. purchase, generate_lead).',
      },
    ],
    responses: { conversions: reportSchema(2) },
  },
  ga4_geo: {
    shape: 'metric',
    description: 'Daily sessions and total users bucketed by visitor country.',
    unit: 'sessions',
    granularity: 'day',
    endpoint: 'POST /v1beta/properties/{propertyId}:runReport',
    dimensions: [
      { name: 'date', description: 'Calendar day of the metric sample.' },
      {
        name: 'country',
        description: 'Country the session originated from.',
      },
    ],
    responses: { geo: reportSchema(2) },
  },
});

export const id = 'google-analytics';

export class GA4Connector extends BaseConnector<GA4Settings, GA4Credentials> {
  static readonly id = id;

  static readonly resources = googleAnalyticsResources;

  static readonly schemas = schemasFromResources(googleAnalyticsResources);

  static create(input: unknown, ctx?: ConnectorContext): GA4Connector {
    const parsed = configFields.parse(input);
    return new GA4Connector(
      {
        propertyId: parsed.propertyId,
        lookbackDays: parsed.lookbackDays,
      },
      {
        serviceAccountJson: parsed.serviceAccountJson,
        refreshToken: parsed.refreshToken,
        clientId: parsed.clientId,
        clientSecret: parsed.clientSecret,
      },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = ga4Credentials;

  private tokenProvider?: GcpAccessTokenProvider;

  private getAccessToken(signal?: AbortSignal): Promise<string> {
    this.tokenProvider ??= new GcpAccessTokenProvider({
      connectorId: this.id,
      scope: 'https://www.googleapis.com/auth/analytics.readonly',
      getServiceAccountJson: () => this.creds.serviceAccountJson,
      getRefreshTokenCredentials: () => {
        const { refreshToken, clientId, clientSecret } = this.creds;
        if (refreshToken && clientId && clientSecret) {
          return { refreshToken, clientId, clientSecret };
        }
        return undefined;
      },
      post: (url, opts) =>
        this.post<{ access_token: string; expires_in?: number }>(url, opts),
    });
    return this.tokenProvider.getToken(signal);
  }

  private async runReport(
    accessToken: string,
    phase: GA4Phase,
    dateRange: { startDate: string; endDate: string },
    offset: number,
    signal?: AbortSignal,
  ): Promise<GA4ReportResponse> {
    const { dimensions, metrics } = PHASE_CONFIGS[phase];
    const url = `https://analyticsdata.googleapis.com/v1beta/properties/${this.settings.propertyId}:runReport`;

    const body: Record<string, unknown> = {
      dimensions: dimensions.map((name) => ({ name })),
      metrics: metrics.map((name) => ({ name })),
      dateRanges: [
        { startDate: dateRange.startDate, endDate: dateRange.endDate },
      ],
      limit: ROWS_PER_PAGE,
      offset,
    };

    const res = await this.post<GA4ReportResponse>(url, {
      resource: phase,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': connectorUserAgent('google-analytics'),
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
    const lookbackDays = this.settings.lookbackDays ?? 90;

    const cursor = isGA4SyncCursor(options.cursor) ? options.cursor : undefined;
    const dateRange = cursor?.dateRange ?? getDateRange(options, lookbackDays);

    let accessToken: string | null = null;
    const getToken = async (sig?: AbortSignal): Promise<string> => {
      if (!accessToken) {
        accessToken = await this.getAccessToken(sig);
      }
      return accessToken;
    };

    const runReportWithRetry = async (
      phase: GA4Phase,
      offset: number,
      sig: AbortSignal | undefined,
    ): Promise<GA4ReportResponse> => {
      const token = await getToken(sig);
      try {
        return await this.runReport(token, phase, dateRange, offset, sig);
      } catch (err) {
        console.warn(
          `[ga4] runReport failed, refreshing token and retrying once`,
          err,
        );
        accessToken = null;
        const freshToken = await getToken(sig);
        return this.runReport(freshToken, phase, dateRange, offset, sig);
      }
    };

    const drainPhase = async (phase: GA4Phase): Promise<GA4ReportRow[]> => {
      const allRows: GA4ReportRow[] = [];
      let offset = 0;
      for (;;) {
        const response = await runReportWithRetry(phase, offset, signal);
        const rows = response.rows ?? [];
        allRows.push(...rows);
        offset += rows.length;
        if (rows.length === 0) {
          break;
        }
        const done =
          typeof response.rowCount === 'number'
            ? offset >= response.rowCount
            : rows.length < ROWS_PER_PAGE;
        if (done) {
          break;
        }
      }
      return allRows;
    };

    const resumeIdx = cursor ? PHASE_ORDER.indexOf(cursor.phase) : -1;
    const startIdx = resumeIdx >= 0 ? resumeIdx : 0;

    for (let i = startIdx; i < PHASE_ORDER.length; i++) {
      const phase = PHASE_ORDER[i]!;
      if (signal?.aborted) {
        return { done: false, cursor: { phase, dateRange } };
      }

      const cfg = PHASE_CONFIGS[phase];
      if (!isResourceAllowed(options, cfg.metricName)) {
        continue;
      }

      let rows: GA4ReportRow[];
      try {
        rows = await drainPhase(phase);
      } catch (err) {
        if (signal?.aborted) {
          return { done: false, cursor: { phase, dateRange } };
        }
        throw err;
      }
      const samples = rows.map((row) =>
        rowToMetricSample(row, cfg.dimensions, cfg.metrics, cfg.metricName),
      );
      await storage.metrics(samples, { names: [cfg.metricName] });
    }

    return { done: true };
  }
}
