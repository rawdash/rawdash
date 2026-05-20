import { type HttpRequest, request } from '@rawdash/connector-shared';
import {
  BaseConnector,
  type ChunkedSyncCursor,
  type CredentialsSchema,
  type StorageHandle,
  type SyncOptions,
  type SyncResult,
  defineConfigFields,
  paginateChunked,
} from '@rawdash/core';
import { z } from 'zod';

export const configFields = defineConfigFields(
  z.object({
    propertyId: z.string().meta({
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
  }),
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

type GA4SyncCursor = ChunkedSyncCursor<GA4Phase, number>;

function isGA4SyncCursor(value: unknown): value is GA4SyncCursor {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const v = value as { phase?: unknown; page?: unknown };
  if (typeof v.phase !== 'string') {
    return false;
  }
  if (!(PHASE_ORDER as readonly string[]).includes(v.phase)) {
    return false;
  }
  if (v.page !== null && typeof v.page !== 'number') {
    return false;
  }
  return true;
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

async function fetchServiceAccountToken(
  serviceAccountJson: string,
  signal?: AbortSignal,
): Promise<{ token: string; expiresAt: number }> {
  const sa = JSON.parse(serviceAccountJson) as ServiceAccountKey;
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

  const res = await request<TokenResponse>({
    url: sa.token_uri ?? 'https://oauth2.googleapis.com/token',
    method: 'POST',
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

async function fetchRefreshToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
  signal?: AbortSignal,
): Promise<{ token: string; expiresAt: number }> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  }).toString();

  const res = await request<TokenResponse>({
    url: 'https://oauth2.googleapis.com/token',
    method: 'POST',
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

function getDateRange(
  options: SyncOptions,
  lookbackDays: number,
): { startDate: string; endDate: string } {
  const endDate = toGA4Date(new Date());
  let startMs: number;

  if (options.mode === 'latest' && options.since) {
    // Incremental: last 30 days (covers 3-day attribution lag)
    startMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
  } else {
    startMs = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
  }

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

  private async getAccessToken(signal?: AbortSignal): Promise<string> {
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAt) {
      return this.cachedToken.token;
    }

    const { serviceAccountJson, refreshToken, clientId, clientSecret } =
      this.creds;

    if (serviceAccountJson) {
      this.cachedToken = await fetchServiceAccountToken(
        serviceAccountJson,
        signal,
      );
      return this.cachedToken.token;
    }

    if (refreshToken && clientId && clientSecret) {
      this.cachedToken = await fetchRefreshToken(
        refreshToken,
        clientId,
        clientSecret,
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

    const req: HttpRequest = {
      url,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent':
          'rawdash/connector-google-analytics (+https://rawdash.dev)',
      },
      body: JSON.stringify(body),
      signal,
    };

    const res = await request<GA4ReportResponse>(req);
    return res.body;
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const lookbackDays = this.settings.lookbackDays ?? 90;
    const dateRange = getDateRange(options, lookbackDays);

    const cursor = isGA4SyncCursor(options.cursor) ? options.cursor : undefined;

    // Lazily resolve access token once per sync (re-fetched if expired mid-run)
    let accessToken: string | null = null;
    const getToken = async (sig?: AbortSignal): Promise<string> => {
      if (!accessToken) {
        accessToken = await this.getAccessToken(sig);
      }
      return accessToken;
    };

    const clearedPhases = new Set<GA4Phase>();

    return paginateChunked<GA4Phase, number>({
      phases: PHASE_ORDER,
      cursor,
      signal,
      fetchPage: async (phase, page, sig) => {
        const token = await getToken(sig);
        const offset = page ?? 0;
        let response: GA4ReportResponse;
        try {
          response = await this.runReport(token, phase, dateRange, offset, sig);
        } catch {
          // Token may have expired mid-run; clear cache and retry once
          accessToken = null;
          const freshToken = await getToken(sig);
          response = await this.runReport(
            freshToken,
            phase,
            dateRange,
            offset,
            sig,
          );
        }
        const rows = response.rows ?? [];
        const totalRows = response.rowCount ?? 0;
        const nextOffset = offset + rows.length;
        const next =
          rows.length > 0 && nextOffset < totalRows ? nextOffset : null;
        return { items: rows, next };
      },
      writeBatch: async (phase, items, page) => {
        const cfg = PHASE_CONFIGS[phase];

        // On the first page of each phase, wipe existing metric data for this
        // phase so re-runs don't accumulate duplicate rows for the same dates.
        if (page === null && !clearedPhases.has(phase)) {
          clearedPhases.add(phase);
          await storage.metrics([], { names: [cfg.metricName] });
        }

        const rows = items as GA4ReportRow[];
        for (const row of rows) {
          const sample = rowToMetricSample(
            row,
            cfg.dimensions,
            cfg.metrics,
            cfg.metricName,
          );
          await storage.metric(sample);
        }
      },
    });
  }
}
