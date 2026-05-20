import {
  BaseConnector,
  type CredentialsSchema,
  type StorageHandle,
  type SyncOptions,
  type SyncResult,
  defineConfigFields,
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

// ---------------------------------------------------------------------------
// Settings / credentials
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Sync phases + cursor
// ---------------------------------------------------------------------------

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
  // dateRange always populated, even when we abort between phases, so a
  // resumed run uses the original window for every remaining phase.
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

// ---------------------------------------------------------------------------
// Phase configs — dimensions + metrics for each resource
// ---------------------------------------------------------------------------

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
    metrics: ['sessions', 'conversions'],
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
    metrics: ['conversions', 'totalRevenue'],
    metricName: 'ga4_conversions',
  },
  geo: {
    dimensions: ['date', 'country'],
    metrics: ['sessions', 'totalUsers'],
    metricName: 'ga4_geo',
  },
};

const ROWS_PER_PAGE = 10_000;

// ---------------------------------------------------------------------------
// GA4 Data API types
// ---------------------------------------------------------------------------

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
      scope: 'https://www.googleapis.com/auth/analytics.readonly',
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

function toGA4Date(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function ga4DateToMs(ga4Date: string): number {
  // GA4 dates arrive as 'YYYYMMDD'
  const y = ga4Date.slice(0, 4);
  const m = ga4Date.slice(4, 6);
  const d = ga4Date.slice(6, 8);
  return Date.UTC(Number(y), Number(m) - 1, Number(d));
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const INCREMENTAL_LOOKBACK_DAYS = 30;

function getDateRange(
  options: SyncOptions,
  lookbackDays: number,
): GA4DateRange {
  const now = Date.now();
  const endDate = toGA4Date(new Date(now));
  const days =
    options.mode === 'latest' && options.since
      ? INCREMENTAL_LOOKBACK_DAYS
      : lookbackDays;
  const startMs = now - (days - 1) * MS_PER_DAY;
  return { startDate: toGA4Date(new Date(startMs)), endDate };
}

// ---------------------------------------------------------------------------
// Row conversion
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// GA4Connector
// ---------------------------------------------------------------------------

export class GA4Connector extends BaseConnector<GA4Settings, GA4Credentials> {
  static readonly id = 'google-analytics';

  static create(input: unknown): { connector: GA4Connector } {
    const parsed = configFields.parse(input);
    return {
      connector: new GA4Connector(
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
      ),
    };
  }

  readonly id = 'google-analytics';
  override readonly credentials = ga4Credentials;

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
      'GA4 connector: provide either serviceAccountJson or (refreshToken + clientId + clientSecret)',
    );
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
        'User-Agent':
          'rawdash/connector-google-analytics (+https://rawdash.dev)',
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
        // Prefer the API's authoritative rowCount when available; fall back
        // to a short-page heuristic only when GA4 omits it, so a missing
        // field can't truncate a multi-page dataset to its first page.
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

      // Drain every page of this phase in-memory before writing so the commit
      // is one atomic call. A mid-phase failure restarts this phase from
      // scratch on the next sync; the clear-and-replace below wipes partial
      // state. If the abort signal trips mid-drain, surface a resumable
      // cursor instead of throwing the AbortError up to the caller.
      let rows: GA4ReportRow[];
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
        rowToMetricSample(row, cfg.dimensions, cfg.metrics, cfg.metricName),
      );
      // Scoping by name ensures stale rows are wiped even when samples is empty.
      await storage.metrics(samples, { names: [cfg.metricName] });
    }

    return { done: true };
  }
}
