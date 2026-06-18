import { connectorUserAgent } from '@rawdash/connector-shared';
import {
  BaseConnector,
  type ChunkedSyncCursor,
  type ConnectorContext,
  type ConnectorDoc,
  type CredentialsSchema,
  type MetricSample,
  type StorageHandle,
  type SyncOptions,
  type SyncResult,
  defineConfigFields,
  defineConnectorDoc,
  defineResources,
  makeChunkedCursorGuard,
  metricSample,
  paginateChunked,
  schemasFromResources,
  selectActivePhases,
} from '@rawdash/core';
import { z } from 'zod';

export const configFields = defineConfigFields(
  z.object({
    appId: z
      .string()
      .trim()
      .min(1)
      .regex(
        /^(id\d+|[A-Za-z][\w.]*)$/,
        'App ID is the iOS bundle id (e.g. `id1234567890`) or the Android package name (e.g. `com.example.app`).',
      )
      .meta({
        label: 'App ID',
        description:
          'AppsFlyer app identifier: iOS apps use `id<numericId>` (the App Store ID with an `id` prefix); Android apps use the package name (e.g. `com.example.app`).',
        placeholder: 'id1234567890',
      }),
    apiToken: z.object({ $secret: z.string() }).meta({
      label: 'API token (V2.0)',
      description:
        'AppsFlyer V2.0 API token with Pull/Master API permissions for the app. Generate it in AppsFlyer → Settings → API tokens.',
      placeholder: 'eyJ...',
      secret: true,
    }),
    lookbackDays: z.number().int().positive().optional().meta({
      label: 'Lookback days (full sync)',
      description:
        'How many calendar days of metrics to fetch on a full sync. Defaults to 90.',
      placeholder: '90',
    }),
    timezone: z.string().trim().min(1).optional().meta({
      label: 'Timezone',
      description:
        'IANA timezone to use for daily bucketing (e.g. `America/New_York`). Defaults to AppsFlyer’s preferred timezone on the app.',
      placeholder: 'preferred',
    }),
    currency: z
      .string()
      .trim()
      .regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter ISO code like USD.')
      .optional()
      .meta({
        label: 'Currency',
        description:
          'ISO currency code for cost/revenue KPIs. Defaults to AppsFlyer’s preferred currency on the app.',
        placeholder: 'USD',
      }),
    resources: z
      .array(z.enum(['install_metrics', 'retention_metrics']))
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          'Which AppsFlyer resources to sync. Omit to sync all of them.',
      }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'AppsFlyer',
  category: 'marketing',
  brandColor: '#00C2C2',
  tagline:
    'Sync AppsFlyer install attribution metrics (installs, cost, revenue, loyal users) and retention from the Master API for mobile paid-acquisition dashboards.',
  vendor: {
    name: 'AppsFlyer',
    domain: 'appsflyer.com',
    apiDocs: 'https://dev.appsflyer.com/hc/reference/master-api',
    website: 'https://www.appsflyer.com',
  },
  auth: {
    summary:
      'An AppsFlyer V2.0 API token with Pull/Master API access scoped to the target app.',
    setup: [
      'In AppsFlyer, open Settings → API tokens and create a V2.0 token (or reuse one). Grant it access to the app you intend to sync.',
      'Copy the generated token. AppsFlyer V2.0 tokens are long-lived bearer tokens; rotate them on your normal cadence.',
      'Find the app ID: iOS apps use `id<numericAppStoreId>` and Android apps use the package name (e.g. `com.example.app`). The same identifier is shown at the top of every AppsFlyer dashboard page.',
      'Store the token as a secret and reference it from the connector config as `apiToken: secret("APPSFLYER_API_TOKEN")` alongside `appId: "id<id>"` or `appId: "com.example.app"`.',
    ],
  },
  rateLimit:
    'The AppsFlyer Master/aggregate API quota is window-dependent: short date ranges (<=2 days) allow roughly 1 request per minute per app per report, while ranges of 3 days or more are capped at roughly 120 requests/day per account and 24/day per app. The connector issues one request per resource per sync and backs off on HTTP 429 via the shared HTTP client (honoring Retry-After when the response provides it).',
  limitations: [
    'Daily granularity only - the AppsFlyer Master API does not expose sub-daily buckets.',
    'Re-attribution and re-engagement KPIs are out of scope (the connector only requests install KPIs to keep the cardinality bounded). Add them in a follow-up if you need them.',
    'Retention uses the Master API install-day cohort (grouped by install date and media source) for retention days 1, 7, and 30 (the Master API caps retention at day 30). True acquisition-date cohorts would require the separate Cohort reporting API, which is out of scope here.',
    'AppsFlyer finalizes attribution data 24-48h after the fact. The connector re-fetches a trailing lookback window on every incremental sync and overwrites the metric scope, so late-finalized days are corrected on the next run.',
  ],
});

export interface AppsflyerSettings {
  appId: string;
  lookbackDays?: number;
  timezone?: string;
  currency?: string;
  resources?: readonly AppsflyerResource[];
}

const appsflyerCredentials = {
  apiToken: {
    description: 'AppsFlyer V2.0 API token',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type AppsflyerCredentials = typeof appsflyerCredentials;

const PHASE_ORDER = ['install_metrics', 'retention_metrics'] as const;

type AppsflyerPhase = (typeof PHASE_ORDER)[number];

export type AppsflyerResource = AppsflyerPhase;

type AppsflyerSyncCursor = ChunkedSyncCursor<AppsflyerPhase, string>;

const isAppsflyerSyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

const MASTER_API_BASE = 'https://hq1.appsflyer.com/api/master-agg-data/v4/app';
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_LOOKBACK_DAYS = 90;
const INCREMENTAL_LOOKBACK_DAYS = 14;
const RETENTION_PERIODS = [1, 7, 30] as const;

const INSTALL_METRIC_NAME = 'appsflyer_install_metrics';
const RETENTION_METRIC_NAME = 'appsflyer_retention_metrics';

const METRIC_NAME_BY_PHASE: Record<AppsflyerPhase, string> = {
  install_metrics: INSTALL_METRIC_NAME,
  retention_metrics: RETENTION_METRIC_NAME,
};

const isoDateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const numericLike = z.union([z.number(), z.string(), z.null()]).optional();

const installRowSchema = z.object({
  af_date: isoDateString,
  pid: z.string().nullish(),
  c: z.string().nullish(),
  installs: numericLike,
  cost: numericLike,
  revenue: numericLike,
  loyal_users: numericLike,
});

const retentionRowSchema = z.object({
  af_date: isoDateString,
  pid: z.string().nullish(),
  retention_day_1: numericLike,
  retention_day_7: numericLike,
  retention_day_30: numericLike,
});

const installResponseSchema = z.object({
  data: z.array(installRowSchema),
});

const retentionResponseSchema = z.object({
  data: z.array(retentionRowSchema),
});

export const appsflyerResources = defineResources({
  [INSTALL_METRIC_NAME]: {
    shape: 'metric',
    description:
      'Daily AppsFlyer install metrics bucketed by media source and campaign. Primary value is attributed installs; cost, revenue, and loyal users are carried as measures.',
    endpoint: 'GET /api/master-agg-data/v4/app/{app_id}',
    unit: 'installs',
    granularity: 'day',
    notes:
      'Master API request uses `groupings=af_date,pid,c` (`pid` is the media source, `c` the campaign) and `kpis=installs,cost,revenue,loyal_users`. Rows with missing media source or campaign are recorded as `null` for that attribute.',
    dimensions: [
      {
        name: 'date',
        description:
          'Calendar day of the metric sample (in the configured timezone, else UTC).',
      },
      { name: 'mediaSource', description: 'AppsFlyer media source / partner.' },
      { name: 'campaign', description: 'AppsFlyer campaign name.' },
    ],
    measures: [
      { name: 'cost', description: 'Media spend on the day (cost currency).' },
      {
        name: 'revenue',
        description: 'Attributed revenue on the day (cost currency).',
      },
      {
        name: 'loyalUsers',
        description:
          'Users who reached the AppsFlyer loyal-user threshold on the day.',
      },
    ],
    responses: { install_metrics: installResponseSchema },
  },
  [RETENTION_METRIC_NAME]: {
    shape: 'metric',
    description:
      'Install-day cohort retention from AppsFlyer, bucketed by install date and media source for retention day 1, 7, and 30. Primary value is the number of users from the cohort still active on the retention day.',
    endpoint: 'GET /api/master-agg-data/v4/app/{app_id}',
    unit: 'users',
    granularity: 'day',
    notes:
      'Master API request uses `groupings=af_date,pid` and `kpis=retention_day_1,retention_day_7,retention_day_30` (the Master API treats the install day as the cohort and caps retention at day 30). One sample per (install date, media source, retention period).',
    dimensions: [
      {
        name: 'cohortDate',
        description:
          'Install day that defines the retention cohort (in the configured timezone, else UTC).',
      },
      { name: 'mediaSource', description: 'AppsFlyer media source / partner.' },
      {
        name: 'period',
        description: 'Retention day relative to the install day (1, 7, 30).',
      },
    ],
    responses: { retention_metrics: retentionResponseSchema },
  },
});

export type AppsflyerInstallRow = z.infer<typeof installRowSchema>;
export type AppsflyerRetentionRow = z.infer<typeof retentionRowSchema>;

interface AppsflyerWindow {
  from: string;
  to: string;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toIsoDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function startOfUtcDay(ms: number): number {
  return Math.floor(ms / MS_PER_DAY) * MS_PER_DAY;
}

export function normalizeTimezone(timezone?: string): string | undefined {
  if (!timezone || timezone === 'preferred') {
    return undefined;
  }
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone });
    return timezone;
  } catch (e) {
    console.warn(
      `appsflyer: invalid timezone "${timezone}", falling back to AppsFlyer's preferred timezone (UTC bucketing, omitted from the request)`,
      e,
    );
    return undefined;
  }
}

function startOfDayInTimezone(ms: number, timezone?: string): number {
  if (!timezone) {
    return startOfUtcDay(ms);
  }
  const localDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
  const anchored = isoDateToMs(localDate);
  return Number.isFinite(anchored) ? anchored : startOfUtcDay(ms);
}

export function getWindow(
  options: SyncOptions,
  lookbackDays: number,
  timezone?: string,
  now: number = Date.now(),
): AppsflyerWindow {
  const today = startOfDayInTimezone(now, timezone);
  if (options.mode === 'latest') {
    return {
      from: toIsoDate(today - (INCREMENTAL_LOOKBACK_DAYS - 1) * MS_PER_DAY),
      to: toIsoDate(today),
    };
  }
  if (options.since) {
    const sinceMs = new Date(options.since).getTime();
    if (Number.isFinite(sinceMs)) {
      const requested = Math.max(
        1,
        Math.ceil(
          (today - startOfDayInTimezone(sinceMs, timezone)) / MS_PER_DAY,
        ) + 1,
      );
      const capped = Math.min(requested, lookbackDays);
      return {
        from: toIsoDate(today - (capped - 1) * MS_PER_DAY),
        to: toIsoDate(today),
      };
    }
  }
  return {
    from: toIsoDate(today - (lookbackDays - 1) * MS_PER_DAY),
    to: toIsoDate(today),
  };
}

function isoDateToMs(date: string): number {
  const [y, m, d] = date.split('-').map((part) => Number(part));
  if (
    y === undefined ||
    m === undefined ||
    d === undefined ||
    !Number.isFinite(y) ||
    !Number.isFinite(m) ||
    !Number.isFinite(d)
  ) {
    return NaN;
  }
  return Date.UTC(y, m - 1, d);
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

export function installRowToMetricSample(
  row: AppsflyerInstallRow,
): MetricSample {
  const ts = isoDateToMs(row.af_date);
  const installs = parseNumber(row.installs);
  return metricSample(appsflyerResources, INSTALL_METRIC_NAME, {
    ts: Number.isFinite(ts) ? ts : 0,
    value: installs,
    attributes: {
      date: row.af_date,
      mediaSource: row.pid ?? null,
      campaign: row.c ?? null,
      cost: parseNumber(row.cost),
      revenue: parseNumber(row.revenue),
      loyalUsers: parseNumber(row.loyal_users),
    },
  });
}

export function retentionRowToMetricSamples(
  row: AppsflyerRetentionRow,
): MetricSample[] {
  const ts = isoDateToMs(row.af_date);
  const safeTs = Number.isFinite(ts) ? ts : 0;
  const valueByPeriod: Record<(typeof RETENTION_PERIODS)[number], number> = {
    1: parseNumber(row.retention_day_1),
    7: parseNumber(row.retention_day_7),
    30: parseNumber(row.retention_day_30),
  };
  return RETENTION_PERIODS.map((period) =>
    metricSample(appsflyerResources, RETENTION_METRIC_NAME, {
      ts: safeTs,
      value: valueByPeriod[period],
      attributes: {
        cohortDate: row.af_date,
        mediaSource: row.pid ?? null,
        period,
      },
    }),
  );
}

export const id = 'appsflyer';

export class AppsflyerConnector extends BaseConnector<
  AppsflyerSettings,
  AppsflyerCredentials
> {
  static readonly id = id;

  static readonly resources = appsflyerResources;

  static readonly schemas = schemasFromResources(appsflyerResources);

  static create(input: unknown, ctx?: ConnectorContext): AppsflyerConnector {
    const parsed = configFields.parse(input);
    return new AppsflyerConnector(
      {
        appId: parsed.appId,
        lookbackDays: parsed.lookbackDays,
        timezone: parsed.timezone,
        currency: parsed.currency,
        resources: parsed.resources,
      },
      { apiToken: parsed.apiToken },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = appsflyerCredentials;

  private buildHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.creds.apiToken}`,
      Accept: 'application/json',
      'User-Agent': connectorUserAgent('appsflyer'),
    };
  }

  private buildUrl(
    phase: AppsflyerPhase,
    window: AppsflyerWindow,
    timezone: string | undefined,
  ): string {
    const url = new URL(
      `${MASTER_API_BASE}/${encodeURIComponent(this.settings.appId)}`,
    );
    url.searchParams.set('from', window.from);
    url.searchParams.set('to', window.to);
    url.searchParams.set('format', 'json');
    if (timezone) {
      url.searchParams.set('timezone', timezone);
    }
    if (this.settings.currency) {
      url.searchParams.set('currency', this.settings.currency);
    }
    if (phase === 'install_metrics') {
      url.searchParams.set('groupings', 'af_date,pid,c');
      url.searchParams.set('kpis', 'installs,cost,revenue,loyal_users');
    } else {
      url.searchParams.set('groupings', 'af_date,pid');
      url.searchParams.set(
        'kpis',
        RETENTION_PERIODS.map((p) => `retention_day_${p}`).join(','),
      );
    }
    return url.toString();
  }

  private async fetchPhase(
    phase: AppsflyerPhase,
    window: AppsflyerWindow,
    timezone: string | undefined,
    signal?: AbortSignal,
  ): Promise<unknown[]> {
    const url = this.buildUrl(phase, window, timezone);
    const res = await this.get<{ data?: unknown[] }>(url, {
      resource: phase,
      headers: this.buildHeaders(),
      signal,
    });
    return res.body.data ?? [];
  }

  private async writePhase(
    storage: StorageHandle,
    phase: AppsflyerPhase,
    items: unknown[],
  ): Promise<void> {
    if (phase === 'install_metrics') {
      for (const row of items as AppsflyerInstallRow[]) {
        await storage.metric(installRowToMetricSample(row));
      }
      return;
    }
    for (const row of items as AppsflyerRetentionRow[]) {
      for (const sample of retentionRowToMetricSamples(row)) {
        await storage.metric(sample);
      }
    }
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const cursor: AppsflyerSyncCursor | undefined = isAppsflyerSyncCursor(
      options.cursor,
    )
      ? options.cursor
      : undefined;
    const lookbackDays = this.settings.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
    const timezone = normalizeTimezone(this.settings.timezone);
    const window = getWindow(options, lookbackDays, timezone);

    const phases = selectActivePhases<AppsflyerResource, AppsflyerPhase>(
      (r) => r,
      PHASE_ORDER,
      this.settings.resources,
    );

    return paginateChunked<AppsflyerPhase, string>({
      phases,
      cursor,
      signal,
      logger: this.logger,
      fetchPage: async (phase, _page, sig) => {
        const items = await this.fetchPhase(phase, window, timezone, sig);
        return { items, next: null };
      },
      writeBatch: async (phase, items, page) => {
        if (page === null) {
          await storage.metrics([], { names: [METRIC_NAME_BY_PHASE[phase]] });
        }
        await this.writePhase(storage, phase, items);
      },
    });
  }
}
