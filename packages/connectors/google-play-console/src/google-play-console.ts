import { connectorUserAgent } from '@rawdash/connector-shared';
import {
  BaseConnector,
  type ConnectorContext,
  type ConnectorDoc,
  type CredentialsSchema,
  type Entity,
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
  z.object({
    packageName: z
      .string()
      .trim()
      .regex(/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/, {
        message:
          'packageName must be a reverse-DNS application id (e.g. com.example.app).',
      })
      .meta({
        label: 'Package name',
        description:
          'Reverse-DNS application id of the Android app (e.g. com.example.app). Visible in the Play Console URL and on Google Play under "About".',
        placeholder: 'com.example.app',
      }),
    serviceAccountJson: z.object({ $secret: z.string().trim().min(1) }).meta({
      label: 'Service Account JSON',
      description:
        'Contents of the JSON key file for a Google service account that has been granted access to your Play Console developer account with at least the "View app information and download bulk reports" permission. Create one at Google Cloud -> IAM & Admin -> Service Accounts.',
      secret: true,
    }),
    lookbackDays: z.number().int().positive().optional().meta({
      label: 'Lookback days (full sync)',
      description:
        'How many calendar days to fetch on a full sync. Defaults to 30. The Play Developer Reporting API exposes daily metrics with a typical 2-3 day reporting lag.',
      placeholder: '30',
    }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'Google Play Console',
  category: 'engineering',
  brandColor: '#34A853',
  tagline:
    'Sync daily Android app vitals from the Play Developer Reporting API - crash rate, ANR rate, ratings, and error counts.',
  vendor: {
    name: 'Google Play Console',
    domain: 'play.google.com',
    apiDocs: 'https://developers.google.com/play/developer/reporting',
    website: 'https://play.google.com/console/',
  },
  auth: {
    summary:
      'Authenticate against the Play Developer Reporting API and the Android Publisher API with a Google service account JSON key. The service account must be linked to your Play Console developer account.',
    setup: [
      'In Google Cloud, create a service account at IAM & Admin -> Service Accounts and download a JSON key.',
      'Enable both the "Google Play Android Developer API" and the "Google Play Developer Reporting API" on the Cloud project.',
      'In Google Play Console open Setup -> API access, link the same Cloud project, then invite the service account email and grant it at least the "View app information and download bulk reports" permission for the app you want to sync.',
      'Store the service account JSON as a secret and reference it as serviceAccountJson: secret("GPLAY_SA_JSON").',
      'Set packageName to the reverse-DNS application id of the app (e.g. com.example.app).',
    ],
  },
  rateLimit:
    'The Play Developer Reporting API enforces a per-project quota (default 60 requests per minute); 429 responses are retried with exponential backoff.',
  limitations: [
    'Daily vitals (crash rate, ANR rate, ratings, error counts) have a 2-3 day reporting lag on the Play Developer Reporting API; incremental syncs refetch the trailing 3 days.',
    'Install counts and earnings are not exposed through the Reporting API - Google delivers them only as monthly CSV reports in a private Cloud Storage bucket. Those metrics are out of scope for this connector and will land in a follow-up.',
  ],
});

export interface GooglePlayConsoleSettings {
  packageName: string;
  lookbackDays?: number;
}

const gplayCredentials = {
  serviceAccountJson: {
    description: 'Google service account JSON key (base64 or raw JSON)',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type GplayCredentials = typeof gplayCredentials;

const PHASE_ORDER = [
  'apps',
  'crash_rate',
  'anr_rate',
  'ratings',
  'errors',
] as const;

type GplayPhase = (typeof PHASE_ORDER)[number];

interface GplayDateRange {
  startDate: string;
  endDate: string;
}

interface GplaySyncCursor {
  phase: GplayPhase;
  dateRange: GplayDateRange;
}

const GPLAY_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isGplayDateString(value: unknown): value is string {
  return typeof value === 'string' && GPLAY_DATE_RE.test(value);
}

function isGplayDateRange(value: unknown): value is GplayDateRange {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const v = value as { startDate?: unknown; endDate?: unknown };
  return isGplayDateString(v.startDate) && isGplayDateString(v.endDate);
}

function isGplaySyncCursor(value: unknown): value is GplaySyncCursor {
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
  return isGplayDateRange(v.dateRange);
}

interface MetricPhaseConfig {
  metricSet: string;
  metrics: string[];
  metricName: string;
  primaryMetric: string;
}

const METRIC_PHASE_CONFIGS: Record<
  Exclude<GplayPhase, 'apps'>,
  MetricPhaseConfig
> = {
  crash_rate: {
    metricSet: 'crashRateMetricSet',
    metrics: ['crashRate', 'distinctUsers'],
    metricName: 'gplay_crash_rate_by_day',
    primaryMetric: 'crashRate',
  },
  anr_rate: {
    metricSet: 'anrRateMetricSet',
    metrics: ['anrRate', 'distinctUsers'],
    metricName: 'gplay_anr_rate_by_day',
    primaryMetric: 'anrRate',
  },
  ratings: {
    metricSet: 'ratingsMetricSet',
    metrics: ['averageRating', 'ratingsCount'],
    metricName: 'gplay_ratings_by_day',
    primaryMetric: 'averageRating',
  },
  errors: {
    metricSet: 'errorCountMetricSet',
    metrics: ['errorReportCount', 'distinctUsers'],
    metricName: 'gplay_error_count_by_day',
    primaryMetric: 'errorReportCount',
  },
};

const SCOPES = [
  'https://www.googleapis.com/auth/playdeveloperreporting',
  'https://www.googleapis.com/auth/androidpublisher',
].join(' ');

const REPORTING_BASE = 'https://playdeveloperreporting.googleapis.com';
const PUBLISHER_BASE = 'https://androidpublisher.googleapis.com';

export interface GplayTimelineDate {
  year?: number;
  month?: number;
  day?: number;
}

export interface GplayTimelinePoint {
  startTime?: { year?: number; month?: number; day?: number };
}

export interface GplayMetricValue {
  metric?: string;
  decimalValue?: { value?: string };
  decimalValueConfidenceInterval?: unknown;
}

export interface GplayMetricRow {
  startTime?: { year?: number; month?: number; day?: number };
  metrics?: GplayMetricValue[];
}

interface GplayMetricResponse {
  rows?: GplayMetricRow[];
  nextPageToken?: string;
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

interface PublisherListingResponse {
  defaultLanguage?: string;
  listings?: Array<{
    language?: string;
    title?: string;
    fullDescription?: string;
    shortDescription?: string;
  }>;
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
      scope: SCOPES,
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

function toGplayDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function gplayDateToMs(gplayDate: string): number {
  const y = gplayDate.slice(0, 4);
  const m = gplayDate.slice(5, 7);
  const d = gplayDate.slice(8, 10);
  return Date.UTC(Number(y), Number(m) - 1, Number(d));
}

function partsToGplayDate(parts: {
  year?: number;
  month?: number;
  day?: number;
}): string | null {
  const { year, month, day } = parts;
  if (
    typeof year !== 'number' ||
    typeof month !== 'number' ||
    typeof day !== 'number' ||
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    year < 1970 ||
    year > 2999 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }
  const y = String(year).padStart(4, '0');
  const m = String(month).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const INCREMENTAL_LOOKBACK_DAYS = 3;

function getDateRange(
  options: SyncOptions,
  lookbackDays: number,
): GplayDateRange {
  const now = Date.now();
  const endDate = toGplayDate(new Date(now));
  if (options.mode === 'latest') {
    const startMs = now - (INCREMENTAL_LOOKBACK_DAYS - 1) * MS_PER_DAY;
    return { startDate: toGplayDate(new Date(startMs)), endDate };
  }
  if (options.since) {
    const sinceMs = new Date(options.since).getTime();
    if (Number.isFinite(sinceMs)) {
      const days = Math.max(1, Math.ceil((now - sinceMs) / MS_PER_DAY));
      const cappedDays = Math.min(days, lookbackDays);
      const startMs = now - (cappedDays - 1) * MS_PER_DAY;
      return { startDate: toGplayDate(new Date(startMs)), endDate };
    }
  }
  const startMs = now - (lookbackDays - 1) * MS_PER_DAY;
  return { startDate: toGplayDate(new Date(startMs)), endDate };
}

export function rowToMetricSample(
  row: GplayMetricRow,
  metricsToCollect: string[],
  metricName: string,
  primaryMetric: string,
  packageName: string,
): {
  name: string;
  ts: number;
  value: number;
  attributes: Record<string, string | number>;
} | null {
  const dateStr = partsToGplayDate(row.startTime ?? {});
  if (!dateStr) {
    return null;
  }
  const attributes: Record<string, string | number> = {
    date: dateStr,
    package_name: packageName,
  };

  for (const m of metricsToCollect) {
    attributes[m] = 0;
  }
  for (const m of row.metrics ?? []) {
    if (!m.metric) {
      continue;
    }
    const raw = m.decimalValue?.value;
    const parsed = typeof raw === 'string' ? Number(raw) : NaN;
    attributes[m.metric] = Number.isFinite(parsed) ? parsed : 0;
  }

  const primary = attributes[primaryMetric];
  const value = typeof primary === 'number' ? primary : 0;

  return {
    name: metricName,
    ts: gplayDateToMs(dateStr),
    value,
    attributes,
  };
}

const dateOnlyTimeline = z.object({
  startTime: z.object({
    year: z.number().int(),
    month: z.number().int(),
    day: z.number().int(),
  }),
});

const metricEntry = z.object({
  metric: z.string(),
  decimalValue: z
    .object({
      value: z.string(),
    })
    .optional(),
});

function metricSetSchema() {
  return z.object({
    rows: z
      .array(
        dateOnlyTimeline.extend({
          metrics: z.array(metricEntry).optional(),
        }),
      )
      .optional(),
    nextPageToken: z.string().optional(),
  });
}

const publisherListingSchema = z.object({
  defaultLanguage: z.string().optional(),
  listings: z
    .array(
      z.object({
        language: z.string(),
        title: z.string().optional(),
        shortDescription: z.string().optional(),
        fullDescription: z.string().optional(),
      }),
    )
    .optional(),
});

export const googlePlayConsoleResources = defineResources({
  apps: {
    shape: 'entity',
    filterable: [],
    description:
      'Android app the connector is syncing. One entity per configured packageName.',
    endpoint: 'GET /androidpublisher/v3/applications/{packageName}/listings',
    fields: [
      {
        name: 'package_name',
        description: 'Reverse-DNS application id (e.g. com.example.app).',
      },
      {
        name: 'title',
        description:
          'Play Store listing title in the default language. Empty if the listing has not been fetched yet.',
      },
      {
        name: 'default_language',
        description:
          'Default language code (BCP-47) configured for the Play Store listings.',
      },
    ],
    responses: { listings: publisherListingSchema },
  },
  gplay_crash_rate_by_day: {
    shape: 'metric',
    description:
      'Daily crash rate reported by the Play Developer Reporting API. Primary value is the crashRate metric (fraction of distinct users that experienced a crash).',
    unit: 'crashRate',
    granularity: 'day',
    endpoint: 'POST /v1beta1/apps/{packageName}/crashRateMetricSet:query',
    dimensions: [
      { name: 'date', description: 'Calendar day of the metric sample (UTC).' },
      {
        name: 'package_name',
        description:
          'Reverse-DNS application id this sample is reported against.',
      },
    ],
    responses: { crash_rate: metricSetSchema() },
  },
  gplay_anr_rate_by_day: {
    shape: 'metric',
    description:
      'Daily ANR (Application Not Responding) rate. Primary value is the anrRate metric (fraction of distinct users that experienced an ANR).',
    unit: 'anrRate',
    granularity: 'day',
    endpoint: 'POST /v1beta1/apps/{packageName}/anrRateMetricSet:query',
    dimensions: [
      { name: 'date', description: 'Calendar day of the metric sample (UTC).' },
      {
        name: 'package_name',
        description:
          'Reverse-DNS application id this sample is reported against.',
      },
    ],
    responses: { anr_rate: metricSetSchema() },
  },
  gplay_ratings_by_day: {
    shape: 'metric',
    description:
      'Daily average user rating and rating count from the Play Developer Reporting API.',
    unit: 'stars',
    granularity: 'day',
    endpoint: 'POST /v1beta1/apps/{packageName}/ratingsMetricSet:query',
    dimensions: [
      { name: 'date', description: 'Calendar day of the metric sample (UTC).' },
      {
        name: 'package_name',
        description:
          'Reverse-DNS application id this sample is reported against.',
      },
    ],
    responses: { ratings: metricSetSchema() },
  },
  gplay_error_count_by_day: {
    shape: 'metric',
    description:
      'Daily count of error reports (crashes + ANRs + handled errors) from the Play Developer Reporting API.',
    unit: 'reports',
    granularity: 'day',
    endpoint: 'POST /v1beta1/apps/{packageName}/errorCountMetricSet:query',
    dimensions: [
      { name: 'date', description: 'Calendar day of the metric sample (UTC).' },
      {
        name: 'package_name',
        description:
          'Reverse-DNS application id this sample is reported against.',
      },
    ],
    responses: { errors: metricSetSchema() },
  },
});

export const id = 'google-play-console';

export class GooglePlayConsoleConnector extends BaseConnector<
  GooglePlayConsoleSettings,
  GplayCredentials
> {
  static readonly id = id;

  static readonly resources = googlePlayConsoleResources;

  static readonly schemas = schemasFromResources(googlePlayConsoleResources);

  static create(
    input: unknown,
    ctx?: ConnectorContext,
  ): GooglePlayConsoleConnector {
    const parsed = configFields.parse(input);
    return new GooglePlayConsoleConnector(
      {
        packageName: parsed.packageName,
        lookbackDays: parsed.lookbackDays,
      },
      {
        serviceAccountJson: parsed.serviceAccountJson,
      },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = gplayCredentials;

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

    const { serviceAccountJson } = this.creds;
    if (!serviceAccountJson) {
      throw new Error(
        'Google Play Console connector: serviceAccountJson credential is required',
      );
    }

    const { url, body } = await buildServiceAccountJwt(serviceAccountJson);
    this.cachedToken = await this.fetchOAuthToken(url, body, signal);
    return this.cachedToken.token;
  }

  private async fetchListings(
    accessToken: string,
    signal?: AbortSignal,
  ): Promise<PublisherListingResponse> {
    const url = `${PUBLISHER_BASE}/androidpublisher/v3/applications/${encodeURIComponent(this.settings.packageName)}/listings`;
    const res = await this.get<PublisherListingResponse>(url, {
      resource: 'listings',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': connectorUserAgent('google-play-console'),
      },
      signal,
    });
    return res.body;
  }

  private async runMetricQuery(
    accessToken: string,
    cfg: MetricPhaseConfig,
    dateRange: GplayDateRange,
    pageToken: string | undefined,
    signal?: AbortSignal,
  ): Promise<GplayMetricResponse> {
    const url = `${REPORTING_BASE}/v1beta1/apps/${encodeURIComponent(this.settings.packageName)}/${cfg.metricSet}:query`;

    const [sy, sm, sd] = dateRange.startDate.split('-').map(Number) as [
      number,
      number,
      number,
    ];
    const [ey, em, ed] = dateRange.endDate.split('-').map(Number) as [
      number,
      number,
      number,
    ];

    const body: Record<string, unknown> = {
      metrics: cfg.metrics,
      timelineSpec: {
        aggregationPeriod: 'DAILY',
        startTime: {
          year: sy,
          month: sm,
          day: sd,
          timeZone: { id: 'UTC' },
        },
        endTime: {
          year: ey,
          month: em,
          day: ed,
          timeZone: { id: 'UTC' },
        },
      },
    };
    if (pageToken) {
      body['pageToken'] = pageToken;
    }

    const res = await this.post<GplayMetricResponse>(url, {
      resource: cfg.metricSet,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': connectorUserAgent('google-play-console'),
      },
      body: JSON.stringify(body),
      signal,
    });
    return res.body;
  }

  private async syncApps(
    accessToken: string,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<void> {
    let title = '';
    let defaultLanguage = '';
    try {
      const listings = await this.fetchListings(accessToken, signal);
      defaultLanguage = listings.defaultLanguage ?? '';
      const list = listings.listings ?? [];
      const def = list.find((l) => l.language === defaultLanguage) ?? list[0];
      title = def?.title ?? '';
    } catch (err) {
      this.logger.warn(
        'Failed to fetch Play Console listings; emitting app entity with empty title',
        { error: (err as Error).message },
      );
    }

    const entity: Entity = {
      type: 'apps',
      id: this.settings.packageName,
      attributes: {
        package_name: this.settings.packageName,
        title,
        default_language: defaultLanguage,
      },
      updated_at: Date.now(),
    };
    await storage.entities([entity], { types: ['apps'] });
  }

  private async drainMetricPhase(
    accessToken: string,
    cfg: MetricPhaseConfig,
    dateRange: GplayDateRange,
    signal?: AbortSignal,
  ): Promise<GplayMetricRow[]> {
    const rows: GplayMetricRow[] = [];
    let pageToken: string | undefined = undefined;
    for (;;) {
      const res: GplayMetricResponse = await this.runMetricQuery(
        accessToken,
        cfg,
        dateRange,
        pageToken,
        signal,
      );
      if (res.rows) {
        rows.push(...res.rows);
      }
      if (!res.nextPageToken) {
        break;
      }
      pageToken = res.nextPageToken;
    }
    return rows;
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const lookbackDays = this.settings.lookbackDays ?? 30;

    const cursor = isGplaySyncCursor(options.cursor)
      ? options.cursor
      : undefined;
    const dateRange = cursor?.dateRange ?? getDateRange(options, lookbackDays);

    let accessToken: string | null = null;
    const getToken = async (sig?: AbortSignal): Promise<string> => {
      if (!accessToken) {
        accessToken = await this.getAccessToken(sig);
      }
      return accessToken;
    };

    const resumeIdx = cursor ? PHASE_ORDER.indexOf(cursor.phase) : -1;
    const startIdx = resumeIdx >= 0 ? resumeIdx : 0;

    for (let i = startIdx; i < PHASE_ORDER.length; i++) {
      const phase = PHASE_ORDER[i]!;
      if (signal?.aborted) {
        return { done: false, cursor: { phase, dateRange } };
      }

      try {
        if (phase === 'apps') {
          const token = await getToken(signal);
          await this.syncApps(token, storage, signal);
          continue;
        }

        const cfg = METRIC_PHASE_CONFIGS[phase];
        const token = await getToken(signal);
        const rows = await this.drainMetricPhase(token, cfg, dateRange, signal);
        const samples = rows
          .map((row) =>
            rowToMetricSample(
              row,
              cfg.metrics,
              cfg.metricName,
              cfg.primaryMetric,
              this.settings.packageName,
            ),
          )
          .filter((s): s is NonNullable<typeof s> => s !== null);
        await storage.metrics(samples, { names: [cfg.metricName] });
      } catch (err) {
        if (signal?.aborted) {
          return { done: false, cursor: { phase, dateRange } };
        }
        throw err;
      }
    }

    return { done: true };
  }
}
