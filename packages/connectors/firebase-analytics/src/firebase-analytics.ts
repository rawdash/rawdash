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
            'Numeric ID of the GA4 property linked to your Firebase project (e.g. 123456789). Find it in Google Analytics -> Admin -> Property settings.',
          placeholder: '123456789',
        }),
      firebaseAppId: z
        .string()
        .trim()
        .min(1, 'Firebase App ID is required')
        .meta({
          label: 'Firebase App ID',
          description:
            'Firebase App ID for the app whose analytics you are syncing (e.g. 1:1234567890:web:abcdef). Find it in Firebase Console -> Project settings -> General -> Your apps. Used to label samples with the source app.',
          placeholder: '1:1234567890:web:abcdef',
        }),
      serviceAccountJson: z.object({ $secret: z.string() }).optional().meta({
        label: 'Service Account JSON (recommended)',
        description:
          'Contents of the JSON key file for a Google service account with the Firebase Viewer + Analytics Viewer roles. Create one at Google Cloud -> IAM & Admin -> Service Accounts.',
        secret: true,
      }),
      refreshToken: z.object({ $secret: z.string() }).optional().meta({
        label: 'OAuth Refresh Token',
        description:
          'Google OAuth 2.0 refresh token with the analytics.readonly scope. Required if not using serviceAccountJson.',
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
  displayName: 'Firebase Analytics',
  category: 'product',
  brandColor: '#DD2C00',
  tagline:
    'Sync DAU/WAU/MAU, per-event activity, and cohort retention from a Firebase project via the GA4 Data API.',
  vendor: {
    name: 'Firebase Analytics',
    domain: 'firebase.google.com',
    apiDocs:
      'https://developers.google.com/analytics/devguides/reporting/data/v1',
    website: 'https://firebase.google.com/products/analytics',
  },
  auth: {
    summary:
      'Firebase Analytics data is exposed through the linked GA4 property. Authenticate against the GA4 Data API with either a Google service account JSON key (recommended) or an OAuth 2.0 refresh-token tuple. The identity must have at least the Analytics Viewer role on the property.',
    setup: [
      'In Firebase Console -> Project settings -> Integrations -> Google Analytics, note the linked GA4 property and copy its numeric Property ID from Google Analytics -> Admin -> Property settings.',
      'In Firebase Console -> Project settings -> General -> Your apps, copy the Firebase App ID for the app whose analytics you want to sync.',
      'Recommended: create a service account at Google Cloud -> IAM & Admin -> Service Accounts, generate a JSON key, and grant it the Analytics Viewer role on the GA4 property. Store the JSON as a secret and reference it as serviceAccountJson: secret("FIREBASE_ANALYTICS_SA_JSON").',
      'Alternative: provide an OAuth 2.0 refresh token with the analytics.readonly scope together with its clientId and clientSecret from the Google Cloud Console.',
    ],
  },
  rateLimit:
    'GA4 Data API quota is 200,000 tokens/day per property (default); 429 responses are retried automatically with exponential backoff.',
  limitations: [
    'Incremental syncs use a 30-day window because GA4 can attribute events up to 3 days after they occur.',
    'Report pagination is 10,000 rows per page.',
    'The firebaseAppId is recorded on every sample but does not filter the report; ensure your GA4 property only contains the app you intend to sync.',
  ],
});

export interface FirebaseAnalyticsSettings {
  propertyId: string;
  firebaseAppId: string;
  lookbackDays?: number;
}

const firebaseAnalyticsCredentials = {
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

type FirebaseAnalyticsCredentials = typeof firebaseAnalyticsCredentials;

const PHASE_ORDER = ['dau_wau_mau', 'events_per_day', 'retention'] as const;

type FirebaseAnalyticsPhase = (typeof PHASE_ORDER)[number];

interface FirebaseAnalyticsDateRange {
  startDate: string;
  endDate: string;
}

interface FirebaseAnalyticsSyncCursor {
  phase: FirebaseAnalyticsPhase;
  dateRange: FirebaseAnalyticsDateRange;
}

const FA_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isFADateString(value: unknown): value is string {
  return typeof value === 'string' && FA_DATE_RE.test(value);
}

function isFADateRange(value: unknown): value is FirebaseAnalyticsDateRange {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const v = value as { startDate?: unknown; endDate?: unknown };
  return isFADateString(v.startDate) && isFADateString(v.endDate);
}

function isFASyncCursor(value: unknown): value is FirebaseAnalyticsSyncCursor {
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
  return isFADateRange(v.dateRange);
}

interface PhaseConfig {
  dimensions: string[];
  metrics: string[];
  metricName: string;
}

const PHASE_CONFIGS: Record<FirebaseAnalyticsPhase, PhaseConfig> = {
  dau_wau_mau: {
    dimensions: ['date'],
    metrics: ['active1DayUsers', 'active7DayUsers', 'active28DayUsers'],
    metricName: 'firebase_dau_wau_mau',
  },
  events_per_day: {
    dimensions: ['date', 'eventName'],
    metrics: ['eventCount', 'totalUsers'],
    metricName: 'firebase_events_per_day',
  },
  retention: {
    dimensions: ['firstSessionDate', 'date'],
    metrics: ['activeUsers'],
    metricName: 'firebase_retention',
  },
};

const ROWS_PER_PAGE = 10_000;

export interface FAReportDimensionValue {
  value: string;
}

export interface FAReportMetricValue {
  value: string;
}

export interface FAReportRow {
  dimensionValues: FAReportDimensionValue[];
  metricValues: FAReportMetricValue[];
}

interface FAReportResponse {
  rows?: FAReportRow[];
  rowCount?: number;
  dimensionHeaders?: Array<{ name: string }>;
  metricHeaders?: Array<{ name: string; type: string }>;
}

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

function getDateRange(
  options: SyncOptions,
  lookbackDays: number,
): FirebaseAnalyticsDateRange {
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
  row: FAReportRow,
  dimensionHeaders: string[],
  metricHeaders: string[],
  metricName: string,
  firebaseAppId: string,
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

  const attributes: Record<string, string | number> = {
    firebaseAppId,
    ...dims,
    ...mets,
  };

  if (dims['firstSessionDate'] && dims['date']) {
    const firstMs = ga4DateToMs(dims['firstSessionDate']);
    const dateMs = ga4DateToMs(dims['date']);
    const period = Math.max(0, Math.round((dateMs - firstMs) / MS_PER_DAY));
    attributes['period'] = period;
  }

  return {
    name: metricName,
    ts,
    value: primaryValue,
    attributes,
  };
}

const dateDimensionValue = z.object({
  value: z.string().regex(/^(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/),
});

const stringDimensionValue = z.object({ value: z.string() });
const numericMetricValue = z.object({
  value: z.string().regex(/^-?\d+(\.\d+)?$/),
});

function reportSchema(dimensionCount: number, firstIsDate = true) {
  const first = firstIsDate ? dateDimensionValue : stringDimensionValue;
  const dims =
    dimensionCount === 1
      ? z.tuple([first])
      : z.tuple([
          first,
          ...Array(dimensionCount - 1).fill(stringDimensionValue),
        ] as [typeof first, ...z.ZodType[]]);
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

const retentionReportSchema = z.object({
  rows: z
    .array(
      z.object({
        dimensionValues: z.tuple([dateDimensionValue, dateDimensionValue]),
        metricValues: z.array(numericMetricValue).nonempty(),
      }),
    )
    .optional(),
});

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive().optional(),
});

export const firebaseAnalyticsResources = defineResources({
  firebase_dau_wau_mau: {
    shape: 'metric',
    description:
      'Daily active, weekly active, and monthly active user counts for the linked GA4 property.',
    unit: 'users',
    granularity: 'day',
    endpoint: 'POST /v1beta/properties/{propertyId}:runReport',
    dimensions: [
      { name: 'date', description: 'Calendar day of the metric sample.' },
    ],
    responses: {
      oauth_token: tokenResponseSchema,
      dau_wau_mau: reportSchema(1),
    },
  },
  firebase_events_per_day: {
    shape: 'metric',
    description:
      'Daily event counts and the active users that triggered them, bucketed by event name.',
    unit: 'events',
    granularity: 'day',
    endpoint: 'POST /v1beta/properties/{propertyId}:runReport',
    dimensions: [
      { name: 'date', description: 'Calendar day of the metric sample.' },
      {
        name: 'eventName',
        description: 'GA4 event name (e.g. session_start, first_open, login).',
      },
    ],
    responses: { events_per_day: reportSchema(2) },
  },
  firebase_retention: {
    shape: 'metric',
    description:
      'Active users on each day grouped by the date of their first session (cohort retention).',
    unit: 'users',
    granularity: 'day',
    endpoint: 'POST /v1beta/properties/{propertyId}:runReport',
    dimensions: [
      {
        name: 'firstSessionDate',
        description: 'Calendar day on which the user first opened the app.',
      },
      {
        name: 'date',
        description: 'Calendar day on which the user was active.',
      },
    ],
    notes:
      'Each sample also carries a `period` attribute equal to (date - firstSessionDate) in days, so retention curves can be built by grouping on it.',
    responses: { retention: retentionReportSchema },
  },
});

export const id = 'firebase-analytics';

export class FirebaseAnalyticsConnector extends BaseConnector<
  FirebaseAnalyticsSettings,
  FirebaseAnalyticsCredentials
> {
  static readonly id = id;

  static readonly resources = firebaseAnalyticsResources;

  static readonly schemas = schemasFromResources(firebaseAnalyticsResources);

  static create(
    input: unknown,
    ctx?: ConnectorContext,
  ): FirebaseAnalyticsConnector {
    const parsed = configFields.parse(input);
    return new FirebaseAnalyticsConnector(
      {
        propertyId: parsed.propertyId,
        firebaseAppId: parsed.firebaseAppId,
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
  override readonly credentials = firebaseAnalyticsCredentials;

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
      'Firebase Analytics connector: provide either serviceAccountJson or (refreshToken + clientId + clientSecret)',
    );
  }

  private async runReport(
    accessToken: string,
    phase: FirebaseAnalyticsPhase,
    dateRange: { startDate: string; endDate: string },
    offset: number,
    signal?: AbortSignal,
  ): Promise<FAReportResponse> {
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

    const res = await this.post<FAReportResponse>(url, {
      resource: phase,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': connectorUserAgent('firebase-analytics'),
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

    const cursor = isFASyncCursor(options.cursor) ? options.cursor : undefined;
    const dateRange = cursor?.dateRange ?? getDateRange(options, lookbackDays);

    let accessToken: string | null = null;
    const getToken = async (sig?: AbortSignal): Promise<string> => {
      if (!accessToken) {
        accessToken = await this.getAccessToken(sig);
      }
      return accessToken;
    };

    const runReportWithRetry = async (
      phase: FirebaseAnalyticsPhase,
      offset: number,
      sig: AbortSignal | undefined,
    ): Promise<FAReportResponse> => {
      const token = await getToken(sig);
      try {
        return await this.runReport(token, phase, dateRange, offset, sig);
      } catch (err) {
        this.logger.warn('runReport failed, refreshing token and retrying', {
          err: String(err),
          phase,
        });
        accessToken = null;
        const freshToken = await getToken(sig);
        return this.runReport(freshToken, phase, dateRange, offset, sig);
      }
    };

    const drainPhase = async (
      phase: FirebaseAnalyticsPhase,
    ): Promise<FAReportRow[]> => {
      const allRows: FAReportRow[] = [];
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

    const enabled = options.resources;
    const isPhaseEnabled = (phase: FirebaseAnalyticsPhase): boolean => {
      if (!enabled || enabled.size === 0) {
        return true;
      }
      return enabled.has(PHASE_CONFIGS[phase].metricName);
    };

    const resumeIdx = cursor ? PHASE_ORDER.indexOf(cursor.phase) : -1;
    const startIdx = resumeIdx >= 0 ? resumeIdx : 0;

    for (let i = startIdx; i < PHASE_ORDER.length; i++) {
      const phase = PHASE_ORDER[i]!;
      if (signal?.aborted) {
        return { done: false, cursor: { phase, dateRange } };
      }
      if (!isPhaseEnabled(phase)) {
        continue;
      }

      let rows: FAReportRow[];
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
        rowToMetricSample(
          row,
          cfg.dimensions,
          cfg.metrics,
          cfg.metricName,
          this.settings.firebaseAppId,
        ),
      );
      await storage.metrics(samples, { names: [cfg.metricName] });
    }

    return { done: true };
  }
}
