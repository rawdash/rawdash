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
      siteUrl: z.string().trim().min(1).meta({
        label: 'Site URL',
        description:
          'Verified Search Console property. URL-prefix properties look like "https://example.com/"; Domain properties look like "sc-domain:example.com".',
        placeholder: 'https://example.com/',
      }),
      serviceAccountJson: z.object({ $secret: z.string() }).optional().meta({
        label: 'Service Account JSON (recommended)',
        description:
          'Contents of the JSON key file for a Google service account that has been added as a Search Console user (Owner or Full user) on the property. Create one at Google Cloud -> IAM & Admin -> Service Accounts.',
        secret: true,
      }),
      refreshToken: z.object({ $secret: z.string() }).optional().meta({
        label: 'OAuth Refresh Token',
        description:
          'Google OAuth 2.0 refresh token with webmasters.readonly scope. Required if not using serviceAccountJson.',
        secret: true,
      }),
      clientId: z.string().optional().meta({
        label: 'OAuth Client ID',
        description:
          'OAuth 2.0 client ID from Google Cloud Console. Required when using refreshToken auth.',
        placeholder: '...apps.googleusercontent.com',
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
  displayName: 'Google Search Console',
  category: 'marketing',
  brandColor: '#458CF5',
  tagline:
    'Sync daily Search Console SEO metrics - clicks, impressions, CTR, and average position - by date, query, page, and country.',
  vendor: {
    name: 'Google Search Console',
    apiDocs:
      'https://developers.google.com/webmaster-tools/v1/api_reference_index',
    website: 'https://search.google.com/search-console',
  },
  auth: {
    summary:
      'Authenticate against the Search Console API with either a Google service account JSON key (recommended) or an OAuth 2.0 refresh-token tuple. The identity must be added as a user on the Search Console property (Owner or Full user).',
    setup: [
      'Identify the property to sync. URL-prefix properties use the full origin (e.g. https://example.com/); Domain properties use the sc-domain:example.com format.',
      'Recommended: create a service account at Google Cloud -> IAM & Admin -> Service Accounts, generate a JSON key, then in Search Console add the service account email as a user on the property. Store the JSON as a secret and reference it as serviceAccountJson: secret("GSC_SERVICE_ACCOUNT_JSON").',
      'Alternative: provide an OAuth 2.0 refresh token with the webmasters.readonly scope together with its clientId and clientSecret from the Google Cloud Console.',
    ],
  },
  rateLimit:
    'Search Console API quota is 1,200 queries per minute per project (default); 429 responses are retried automatically with exponential backoff.',
  limitations: [
    'Search Console aggregates data with a 2-3 day lag, so incremental syncs refetch the trailing 3 days.',
    'Each query is paginated 25,000 rows per page; a phase that yields more than that paginates by startRow.',
  ],
});

// ---------------------------------------------------------------------------
// Settings / credentials
// ---------------------------------------------------------------------------

export interface GSCSettings {
  siteUrl: string;
  lookbackDays?: number;
}

const gscCredentials = {
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

type GSCCredentials = typeof gscCredentials;

// ---------------------------------------------------------------------------
// Sync phases + cursor
// ---------------------------------------------------------------------------

const PHASE_ORDER = [
  'search_analytics_by_day',
  'top_queries',
  'top_pages',
  'top_countries',
] as const;

type GSCPhase = (typeof PHASE_ORDER)[number];

interface GSCDateRange {
  startDate: string;
  endDate: string;
}

interface GSCSyncCursor {
  phase: GSCPhase;
  dateRange: GSCDateRange;
}

const GSC_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isGSCDateString(value: unknown): value is string {
  return typeof value === 'string' && GSC_DATE_RE.test(value);
}

function isGSCDateRange(value: unknown): value is GSCDateRange {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const v = value as { startDate?: unknown; endDate?: unknown };
  return isGSCDateString(v.startDate) && isGSCDateString(v.endDate);
}

function isGSCSyncCursor(value: unknown): value is GSCSyncCursor {
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
  return isGSCDateRange(v.dateRange);
}

// ---------------------------------------------------------------------------
// Phase configs - dimensions for each resource
// ---------------------------------------------------------------------------

interface PhaseConfig {
  dimensions: string[];
  metricName: string;
}

const PHASE_CONFIGS: Record<GSCPhase, PhaseConfig> = {
  search_analytics_by_day: {
    dimensions: ['date'],
    metricName: 'gsc_search_analytics_by_day',
  },
  top_queries: {
    dimensions: ['date', 'query'],
    metricName: 'gsc_top_queries',
  },
  top_pages: {
    dimensions: ['date', 'page'],
    metricName: 'gsc_top_pages',
  },
  top_countries: {
    dimensions: ['date', 'country'],
    metricName: 'gsc_top_countries',
  },
};

const ROWS_PER_PAGE = 25_000;
const METRIC_FIELDS = ['clicks', 'impressions', 'ctr', 'position'] as const;

// ---------------------------------------------------------------------------
// GSC Search Analytics API types
// ---------------------------------------------------------------------------

export interface GSCReportRow {
  keys?: string[];
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
}

interface GSCReportResponse {
  rows?: GSCReportRow[];
  responseAggregationType?: string;
}

// ---------------------------------------------------------------------------
// Service account / OAuth token helpers
// ---------------------------------------------------------------------------

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

interface TokenResponse {
  access_token: string;
  expires_in?: number;
}

function base64urlFromBytes(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64urlFromString(str: string): string {
  return base64urlFromBytes(new TextEncoder().encode(str));
}

async function signRS256JWT(
  payload: Record<string, unknown>,
  privateKeyPem: string,
): Promise<string> {
  const header = { alg: 'RS256', typ: 'JWT' };
  const headerB64 = base64urlFromString(JSON.stringify(header));
  const payloadB64 = base64urlFromString(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  const pemContent = privateKeyPem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s/g, '');
  const der = Uint8Array.from(atob(pemContent), (c) => c.charCodeAt(0));

  const key = await globalThis.crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signature = await globalThis.crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput),
  );

  return `${signingInput}.${base64urlFromBytes(new Uint8Array(signature))}`;
}

function parseServiceAccountJson(value: string): ServiceAccountKey {
  const trimmed = value.trim();
  if (trimmed.startsWith('{')) {
    return JSON.parse(trimmed) as ServiceAccountKey;
  }
  const binary = atob(trimmed);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const decoded = new TextDecoder().decode(bytes);
  return JSON.parse(decoded) as ServiceAccountKey;
}

async function buildServiceAccountJwt(
  serviceAccountJson: string,
): Promise<{ url: string; body: string }> {
  const sa = parseServiceAccountJson(serviceAccountJson);
  const now = Math.floor(Date.now() / 1000);
  const jwt = await signRS256JWT(
    {
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/webmasters.readonly',
      aud: sa.token_uri ?? 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now,
    },
    sa.private_key,
  );

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: jwt,
  }).toString();

  return {
    url: sa.token_uri ?? 'https://oauth2.googleapis.com/token',
    body,
  };
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function toGSCDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function gscDateToMs(gscDate: string): number {
  // GSC date dimension comes back as 'YYYY-MM-DD'
  const y = gscDate.slice(0, 4);
  const m = gscDate.slice(5, 7);
  const d = gscDate.slice(8, 10);
  return Date.UTC(Number(y), Number(m) - 1, Number(d));
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const INCREMENTAL_LOOKBACK_DAYS = 3;

function getDateRange(
  options: SyncOptions,
  lookbackDays: number,
): GSCDateRange {
  const now = Date.now();
  const endDate = toGSCDate(new Date(now));
  if (options.mode === 'latest' && options.since) {
    const startMs = now - (INCREMENTAL_LOOKBACK_DAYS - 1) * MS_PER_DAY;
    return { startDate: toGSCDate(new Date(startMs)), endDate };
  }
  if (options.since) {
    const sinceMs = new Date(options.since).getTime();
    if (Number.isFinite(sinceMs)) {
      const days = Math.max(1, Math.ceil((now - sinceMs) / MS_PER_DAY));
      const cappedDays = Math.min(days, lookbackDays);
      const startMs = now - (cappedDays - 1) * MS_PER_DAY;
      return { startDate: toGSCDate(new Date(startMs)), endDate };
    }
  }
  const startMs = now - (lookbackDays - 1) * MS_PER_DAY;
  return { startDate: toGSCDate(new Date(startMs)), endDate };
}

// ---------------------------------------------------------------------------
// Row conversion
// ---------------------------------------------------------------------------

export function rowToMetricSample(
  row: GSCReportRow,
  dimensions: string[],
  metricName: string,
): {
  name: string;
  ts: number;
  value: number;
  attributes: Record<string, string | number>;
} {
  const attributes: Record<string, string | number> = {};
  const keys = row.keys ?? [];
  for (let i = 0; i < dimensions.length; i++) {
    attributes[dimensions[i]!] = keys[i] ?? '';
  }

  for (const field of METRIC_FIELDS) {
    const raw = row[field];
    attributes[field] =
      typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
  }

  const dateStr =
    typeof attributes['date'] === 'string' ? attributes['date'] : '1970-01-01';
  const ts = gscDateToMs(dateStr);
  const primaryValue = attributes['clicks'] as number;

  return {
    name: metricName,
    ts,
    value: primaryValue,
    attributes,
  };
}

// ---------------------------------------------------------------------------
// Schemas - describe the per-resource API response shape consumed by request()
// ---------------------------------------------------------------------------

const dateKey = z
  .string()
  .regex(/^(19|20)\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
const stringKey = z.string();
const numericField = z.number();

function reportSchema(dimensionCount: number) {
  const keys =
    dimensionCount === 1
      ? z.tuple([dateKey])
      : z.tuple([dateKey, ...Array(dimensionCount - 1).fill(stringKey)] as [
          typeof dateKey,
          ...z.ZodType[],
        ]);
  return z.object({
    rows: z
      .array(
        z.object({
          keys,
          clicks: numericField.optional(),
          impressions: numericField.optional(),
          ctr: numericField.optional(),
          position: numericField.optional(),
        }),
      )
      .optional(),
  });
}

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive().optional(),
});

const googleSearchConsoleResources = defineResources({
  gsc_search_analytics_by_day: {
    shape: 'metric',
    description:
      'Daily site totals - clicks, impressions, CTR, and average position across all queries and pages.',
    unit: 'clicks',
    granularity: 'day',
    endpoint: 'POST /webmasters/v3/sites/{siteUrl}/searchAnalytics/query',
    dimensions: [
      { name: 'date', description: 'Calendar day of the metric sample.' },
    ],
    responses: {
      oauth_token: tokenResponseSchema,
      search_analytics_by_day: reportSchema(1),
    },
  },
  gsc_top_queries: {
    shape: 'metric',
    description:
      'Daily clicks, impressions, CTR, and average position broken down by search query.',
    unit: 'clicks',
    granularity: 'day',
    endpoint: 'POST /webmasters/v3/sites/{siteUrl}/searchAnalytics/query',
    dimensions: [
      { name: 'date', description: 'Calendar day of the metric sample.' },
      {
        name: 'query',
        description: 'Search term that surfaced a result for the property.',
      },
    ],
    responses: { top_queries: reportSchema(2) },
  },
  gsc_top_pages: {
    shape: 'metric',
    description:
      'Daily clicks, impressions, CTR, and average position broken down by landing page URL.',
    unit: 'clicks',
    granularity: 'day',
    endpoint: 'POST /webmasters/v3/sites/{siteUrl}/searchAnalytics/query',
    dimensions: [
      { name: 'date', description: 'Calendar day of the metric sample.' },
      {
        name: 'page',
        description: 'Canonical URL of the page that surfaced in search.',
      },
    ],
    responses: { top_pages: reportSchema(2) },
  },
  gsc_top_countries: {
    shape: 'metric',
    description:
      'Daily clicks, impressions, CTR, and average position broken down by visitor country.',
    unit: 'clicks',
    granularity: 'day',
    endpoint: 'POST /webmasters/v3/sites/{siteUrl}/searchAnalytics/query',
    dimensions: [
      { name: 'date', description: 'Calendar day of the metric sample.' },
      {
        name: 'country',
        description: 'ISO 3166-1 alpha-3 country code of the searcher.',
      },
    ],
    responses: { top_countries: reportSchema(2) },
  },
});

export class GSCConnector extends BaseConnector<GSCSettings, GSCCredentials> {
  static readonly id = 'google-search-console';

  static readonly resources = googleSearchConsoleResources;

  static readonly schemas = schemasFromResources(googleSearchConsoleResources);

  static create(input: unknown, ctx?: ConnectorContext): GSCConnector {
    const parsed = configFields.parse(input);
    return new GSCConnector(
      {
        siteUrl: parsed.siteUrl,
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

  readonly id = 'google-search-console';
  override readonly credentials = gscCredentials;

  private cachedToken: { token: string; expiresAt: number } | null = null;

  private async fetchOAuthToken(
    url: string,
    body: string,
    signal: AbortSignal | undefined,
  ): Promise<{ token: string; expiresAt: number }> {
    const res = await this.post<TokenResponse>(url, {
      resource: 'oauth_token',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal,
    });
    const expiresIn = res.body.expires_in ?? 3600;
    return {
      token: res.body.access_token,
      expiresAt: Date.now() + (expiresIn - 60) * 1000,
    };
  }

  private async getAccessToken(signal?: AbortSignal): Promise<string> {
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAt) {
      return this.cachedToken.token;
    }

    const { serviceAccountJson, refreshToken, clientId, clientSecret } =
      this.creds;

    if (serviceAccountJson) {
      const { url, body } = await buildServiceAccountJwt(serviceAccountJson);
      this.cachedToken = await this.fetchOAuthToken(url, body, signal);
      return this.cachedToken.token;
    }

    if (refreshToken && clientId && clientSecret) {
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString();
      this.cachedToken = await this.fetchOAuthToken(
        'https://oauth2.googleapis.com/token',
        body,
        signal,
      );
      return this.cachedToken.token;
    }

    throw new Error(
      'GSC connector: provide either serviceAccountJson or (refreshToken + clientId + clientSecret)',
    );
  }

  private async runReport(
    accessToken: string,
    phase: GSCPhase,
    dateRange: GSCDateRange,
    startRow: number,
    signal?: AbortSignal,
  ): Promise<GSCReportResponse> {
    const { dimensions } = PHASE_CONFIGS[phase];
    const url = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(this.settings.siteUrl)}/searchAnalytics/query`;

    const body: Record<string, unknown> = {
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      dimensions,
      rowLimit: ROWS_PER_PAGE,
      startRow,
    };

    const res = await this.post<GSCReportResponse>(url, {
      resource: phase,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': connectorUserAgent('google-search-console'),
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

    const cursor = isGSCSyncCursor(options.cursor) ? options.cursor : undefined;
    // Restore the originally-computed window on resume so phases stay aligned
    // across midnight rollovers and lookbackDays changes between runs.
    const dateRange = cursor?.dateRange ?? getDateRange(options, lookbackDays);

    let accessToken: string | null = null;
    const getToken = async (sig?: AbortSignal): Promise<string> => {
      if (!accessToken) {
        accessToken = await this.getAccessToken(sig);
      }
      return accessToken;
    };

    const runReportWithRetry = async (
      phase: GSCPhase,
      startRow: number,
      sig: AbortSignal | undefined,
    ): Promise<GSCReportResponse> => {
      const token = await getToken(sig);
      try {
        return await this.runReport(token, phase, dateRange, startRow, sig);
      } catch (err) {
        console.warn(
          `[gsc] runReport failed, refreshing token and retrying once`,
          err,
        );
        accessToken = null;
        const freshToken = await getToken(sig);
        return this.runReport(freshToken, phase, dateRange, startRow, sig);
      }
    };

    const drainPhase = async (phase: GSCPhase): Promise<GSCReportRow[]> => {
      const allRows: GSCReportRow[] = [];
      let startRow = 0;
      for (;;) {
        const response = await runReportWithRetry(phase, startRow, signal);
        const rows = response.rows ?? [];
        allRows.push(...rows);
        startRow += rows.length;
        // GSC has no totalRowCount field on responses, so a short page is the
        // terminating signal. Empty page also breaks out (covers the rare
        // "exact multiple of rowLimit" case where one extra request is fine).
        if (rows.length < ROWS_PER_PAGE) {
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

      // Drain every page of this phase in-memory before writing so the commit
      // is one atomic call. A mid-phase failure restarts this phase from
      // scratch on the next sync; the clear-and-replace below wipes partial
      // state. If the abort signal trips mid-drain, surface a resumable
      // cursor instead of throwing the AbortError up to the caller.
      let rows: GSCReportRow[];
      try {
        rows = await drainPhase(phase);
      } catch (err) {
        if (signal?.aborted) {
          return { done: false, cursor: { phase, dateRange } };
        }
        throw err;
      }
      const cfg = PHASE_CONFIGS[phase];
      const samples = rows.map((row) =>
        rowToMetricSample(row, cfg.dimensions, cfg.metricName),
      );
      // Scoping by name ensures stale rows are wiped even when samples is empty.
      await storage.metrics(samples, { names: [cfg.metricName] });
    }

    return { done: true };
  }
}
