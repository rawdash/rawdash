import { connectorUserAgent } from '@rawdash/connector-shared';
import {
  BaseConnector,
  type ChunkedSyncCursor,
  type ConnectorContext,
  type ConnectorDoc,
  type CredentialsSchema,
  type Event,
  type MetricSample,
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
    branchKey: z.object({ $secret: z.string() }).meta({
      label: 'Branch key',
      description:
        'Your Branch app key (starts with `key_live_`). Find it in the Branch dashboard under Account Settings -> Profile.',
      placeholder: 'key_live_xxxxxxxxxxxxxxxxxxxxxxxxxx',
      secret: true,
    }),
    branchSecret: z.object({ $secret: z.string() }).meta({
      label: 'Branch secret',
      description:
        'Your Branch app secret (starts with `secret_live_`). Find it next to the key in the Branch dashboard.',
      placeholder: 'secret_live_xxxxxxxxxxxxxxxxxxxxxxxxxx',
      secret: true,
    }),
    lookbackDays: z.number().int().positive().optional().meta({
      label: 'Lookback days (full sync)',
      description:
        'How many calendar days of metrics/events to fetch on a full sync. Defaults to 90.',
      placeholder: '90',
    }),
    resources: z
      .array(z.enum(['install_metrics', 'deep_link_events']))
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          'Which Branch resources to sync. Omit to sync all of them.',
      }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'Branch',
  category: 'marketing',
  brandColor: '#7CB833',
  tagline:
    'Sync Branch install attribution metrics (installs, opens, conversions) and deep-link click events from the Query API for mobile attribution dashboards.',
  vendor: {
    name: 'Branch',
    domain: 'branch.io',
    apiDocs: 'https://help.branch.io/developers-hub/reference',
    website: 'https://www.branch.io',
  },
  auth: {
    summary:
      'A Branch app key and secret, sent together in the Query API request body to authenticate each call.',
    setup: [
      'In the Branch dashboard, open Account Settings -> Profile and copy the Branch Key (starts with `key_live_`).',
      'On the same screen, reveal and copy the Branch Secret (starts with `secret_live_`). Both values are app-scoped; keep them in a secret store.',
      'Reference them from the connector config as `branchKey: secret("BRANCH_KEY")` and `branchSecret: secret("BRANCH_SECRET")`.',
    ],
  },
  rateLimit:
    'The Branch Query API allows roughly 5 requests/second, 20/minute, and 150/hour per app. Because each sync splits its window into <=7-day segments and paginates, a wide window fans out to many requests; the connector relies on the shared HTTP client to honor 429 responses and the `Retry-After` header with backoff.',
  limitations: [
    'Daily granularity only - the connector requests `granularity=day` from the Branch Query API to keep result cardinality bounded.',
    'Branch rejects windows wider than 7 days, so each requested range is split into <=7-day segments and fetched one segment at a time.',
    'Deep-link events are aggregated daily click counts per (date, channel, campaign, feature). Individual click-level records require the Branch Daily Export API which is intentionally out of scope.',
  ],
});

export interface BranchSettings {
  lookbackDays?: number;
  resources?: readonly BranchResource[];
}

const branchCredentials = {
  branchKey: {
    description: 'Branch app key (key_live_...)',
    auth: 'required' as const,
  },
  branchSecret: {
    description: 'Branch app secret (secret_live_...)',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type BranchCredentials = typeof branchCredentials;

const PHASE_ORDER = ['install_metrics', 'deep_link_events'] as const;

type BranchPhase = (typeof PHASE_ORDER)[number];

export type BranchResource = BranchPhase;

type BranchSyncCursor = ChunkedSyncCursor<BranchPhase, string>;

const isBranchSyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

const ANALYTICS_API_URL = 'https://api2.branch.io/v1/query/analytics';
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_LOOKBACK_DAYS = 90;
const INCREMENTAL_LOOKBACK_DAYS = 14;
const MAX_WINDOW_DAYS = 7;
const PAGE_LIMIT = 1000;

const INSTALL_METRIC_NAME = 'branch_install_metrics';
const DEEP_LINK_EVENT_NAME = 'branch_deep_link_event';

const CHANNEL_DIMENSION = 'last_attributed_touch_data_tilde_channel';
const CAMPAIGN_DIMENSION = 'last_attributed_touch_data_tilde_campaign';
const FEATURE_DIMENSION = 'last_attributed_touch_data_tilde_feature';

const INSTALL_DATA_SOURCES = [
  'eo_install',
  'eo_open',
  'eo_custom_event',
] as const;
type InstallDataSource = (typeof INSTALL_DATA_SOURCES)[number];

const COUNT_FIELD_BY_DATA_SOURCE: Record<InstallDataSource, string> = {
  eo_install: 'installs',
  eo_open: 'opens',
  eo_custom_event: 'conversions',
};

const isoTimestampString = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/,
  );
const numericLike = z.union([z.number(), z.string(), z.null()]).optional();
const pagingSchema = z.object({ next_url: z.string().nullish() }).nullish();

const installResultRowSchema = z.object({
  timestamp: isoTimestampString,
  result: z.object({
    [CHANNEL_DIMENSION]: z.string().nullish(),
    [CAMPAIGN_DIMENSION]: z.string().nullish(),
    unique_count: numericLike,
  }),
});

const installResponseSchema = z.object({
  results: z.array(installResultRowSchema),
  paging: pagingSchema,
});

const clickResultRowSchema = z.object({
  timestamp: isoTimestampString,
  result: z.object({
    [CHANNEL_DIMENSION]: z.string().nullish(),
    [CAMPAIGN_DIMENSION]: z.string().nullish(),
    [FEATURE_DIMENSION]: z.string().nullish(),
    unique_count: numericLike,
  }),
});

const clickResponseSchema = z.object({
  results: z.array(clickResultRowSchema),
  paging: pagingSchema,
});

export const branchResources = defineResources({
  [INSTALL_METRIC_NAME]: {
    shape: 'metric',
    description:
      'Daily Branch attribution metrics bucketed by channel and campaign. Primary value is `installs`; `opens` and `conversions` are carried as attributes.',
    endpoint: 'POST /v1/query/analytics',
    unit: 'installs',
    granularity: 'day',
    notes:
      'Merges three Query API calls (data_source=eo_install, eo_open, eo_custom_event) keyed by (date, channel, campaign). Rows with missing channel or campaign are recorded as `null` for that attribute.',
    dimensions: [
      { name: 'date', description: 'Calendar day of the metric sample (UTC).' },
      { name: 'channel', description: 'Branch last-attributed channel.' },
      { name: 'campaign', description: 'Branch last-attributed campaign.' },
      { name: 'installs', description: 'Attributed installs on the day.' },
      { name: 'opens', description: 'Attributed app opens on the day.' },
      {
        name: 'conversions',
        description: 'Attributed in-app custom-event conversions on the day.',
      },
    ],
    responses: {
      install_metrics_installs: installResponseSchema,
      install_metrics_opens: installResponseSchema,
      install_metrics_conversions: installResponseSchema,
    },
  },
  [DEEP_LINK_EVENT_NAME]: {
    shape: 'event',
    description:
      'Daily aggregated Branch deep-link click events bucketed by channel, campaign, and feature. One event per (date, channel, campaign, feature) row carrying the daily click count.',
    endpoint: 'POST /v1/query/analytics',
    notes:
      'Sourced from data_source=eo_click. Event id encodes the bucket so resyncs are idempotent.',
    fields: [
      { name: 'date', description: 'Calendar day of the click bucket (UTC).' },
      { name: 'channel', description: 'Branch last-attributed channel.' },
      { name: 'campaign', description: 'Branch last-attributed campaign.' },
      {
        name: 'feature',
        description: 'Branch last-attributed feature (e.g. `sharing`).',
      },
      { name: 'clicks', description: 'Click count for the bucket.' },
    ],
    filterable: [],
    responses: { deep_link_events: clickResponseSchema },
  },
});

export type BranchInstallResultRow = z.infer<typeof installResultRowSchema>;
export type BranchClickResultRow = z.infer<typeof clickResultRowSchema>;

interface BranchWindow {
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

export function getWindow(
  options: SyncOptions,
  lookbackDays: number,
  now: number = Date.now(),
): BranchWindow {
  const today = startOfUtcDay(now);
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
        Math.ceil((today - startOfUtcDay(sinceMs)) / MS_PER_DAY) + 1,
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

export function splitWindow(window: BranchWindow): BranchWindow[] {
  const fromMs = isoDateToMs(window.from);
  const toMs = isoDateToMs(window.to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs) {
    return [window];
  }
  const segments: BranchWindow[] = [];
  let startMs = fromMs;
  while (startMs <= toMs) {
    const endMs = Math.min(startMs + (MAX_WINDOW_DAYS - 1) * MS_PER_DAY, toMs);
    segments.push({ from: toIsoDate(startMs), to: toIsoDate(endMs) });
    startMs = endMs + MS_PER_DAY;
  }
  return segments;
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

function normalizeDateBucket(timestamp: string): string {
  return timestamp.slice(0, 10);
}

interface InstallBucket {
  date: string;
  channel: string | null;
  campaign: string | null;
  installs: number;
  opens: number;
  conversions: number;
}

function bucketKey(
  date: string,
  channel: string | null,
  campaign: string | null,
): string {
  return `${date}|${channel ?? ''}|${campaign ?? ''}`;
}

export function mergeInstallBuckets(
  rowsByDataSource: Record<InstallDataSource, BranchInstallResultRow[]>,
): InstallBucket[] {
  const buckets = new Map<string, InstallBucket>();
  for (const dataSource of INSTALL_DATA_SOURCES) {
    const field = COUNT_FIELD_BY_DATA_SOURCE[dataSource];
    for (const row of rowsByDataSource[dataSource]) {
      const date = normalizeDateBucket(row.timestamp);
      const channel =
        (row.result[CHANNEL_DIMENSION] as string | null | undefined) ?? null;
      const campaign =
        (row.result[CAMPAIGN_DIMENSION] as string | null | undefined) ?? null;
      const key = bucketKey(date, channel, campaign);
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          date,
          channel,
          campaign,
          installs: 0,
          opens: 0,
          conversions: 0,
        };
        buckets.set(key, bucket);
      }
      const count = parseNumber(row.result.unique_count);
      if (field === 'installs') {
        bucket.installs += count;
      } else if (field === 'opens') {
        bucket.opens += count;
      } else {
        bucket.conversions += count;
      }
    }
  }
  return Array.from(buckets.values()).sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );
}

export function installBucketToMetricSample(
  bucket: InstallBucket,
): MetricSample {
  const ts = isoDateToMs(bucket.date);
  return {
    name: INSTALL_METRIC_NAME,
    ts: Number.isFinite(ts) ? ts : 0,
    value: bucket.installs,
    attributes: {
      date: bucket.date,
      channel: bucket.channel,
      campaign: bucket.campaign,
      installs: bucket.installs,
      opens: bucket.opens,
      conversions: bucket.conversions,
    },
  };
}

export function clickRowToEventRecord(row: BranchClickResultRow): Event {
  const date = normalizeDateBucket(row.timestamp);
  const channel =
    (row.result[CHANNEL_DIMENSION] as string | null | undefined) ?? null;
  const campaign =
    (row.result[CAMPAIGN_DIMENSION] as string | null | undefined) ?? null;
  const feature =
    (row.result[FEATURE_DIMENSION] as string | null | undefined) ?? null;
  const ts = isoDateToMs(date);
  const clicks = parseNumber(row.result.unique_count);
  const startTs = Number.isFinite(ts) ? ts : 0;
  return {
    name: DEEP_LINK_EVENT_NAME,
    start_ts: startTs,
    end_ts: startTs,
    attributes: {
      bucketKey: `${date}|${channel ?? ''}|${campaign ?? ''}|${feature ?? ''}`,
      date,
      channel,
      campaign,
      feature,
      clicks,
    },
  };
}

export const id = 'branch';

export class BranchConnector extends BaseConnector<
  BranchSettings,
  BranchCredentials
> {
  static readonly id = id;

  static readonly resources = branchResources;

  static readonly schemas = schemasFromResources(branchResources);

  static create(input: unknown, ctx?: ConnectorContext): BranchConnector {
    const parsed = configFields.parse(input);
    return new BranchConnector(
      { lookbackDays: parsed.lookbackDays, resources: parsed.resources },
      { branchKey: parsed.branchKey, branchSecret: parsed.branchSecret },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = branchCredentials;

  private buildHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': connectorUserAgent('branch'),
    };
  }

  private buildBody(
    dataSource: string,
    dimensions: string[],
    window: BranchWindow,
  ): string {
    return JSON.stringify({
      branch_key: this.creds.branchKey,
      branch_secret: this.creds.branchSecret,
      start_date: window.from,
      end_date: window.to,
      data_source: dataSource,
      dimensions,
      granularity: 'day',
      aggregation: 'unique_count',
      ordered: 'ascending',
      ordered_by: 'timestamp',
      limit: PAGE_LIMIT,
    });
  }

  private async fetchAggregate<T>(
    resource: string,
    dataSource: string,
    dimensions: string[],
    window: BranchWindow,
    signal?: AbortSignal,
  ): Promise<T[]> {
    const body = this.buildBody(dataSource, dimensions, window);
    const results: T[] = [];
    const visited = new Set<string>();
    let url = ANALYTICS_API_URL;
    while (!visited.has(url)) {
      visited.add(url);
      const res = await this.post<{
        results?: T[];
        paging?: { next_url?: string | null } | null;
      }>(url, {
        resource,
        headers: this.buildHeaders(),
        body,
        signal,
      });
      results.push(...(res.body.results ?? []));
      const next = res.body.paging?.next_url;
      if (!next) {
        break;
      }
      url = next;
    }
    return results;
  }

  private async fetchInstallBuckets(
    segments: BranchWindow[],
    signal?: AbortSignal,
  ): Promise<InstallBucket[]> {
    const dims = [CHANNEL_DIMENSION, CAMPAIGN_DIMENSION];
    const rowsByDataSource: Record<
      InstallDataSource,
      BranchInstallResultRow[]
    > = {
      eo_install: [],
      eo_open: [],
      eo_custom_event: [],
    };
    for (const segment of segments) {
      for (const dataSource of INSTALL_DATA_SOURCES) {
        const field = COUNT_FIELD_BY_DATA_SOURCE[dataSource];
        const tag = `install_metrics_${field}`;
        const rows = await this.fetchAggregate<BranchInstallResultRow>(
          tag,
          dataSource,
          dims,
          segment,
          signal,
        );
        rowsByDataSource[dataSource].push(...rows);
      }
    }
    return mergeInstallBuckets(rowsByDataSource);
  }

  private async fetchClickRows(
    segments: BranchWindow[],
    signal?: AbortSignal,
  ): Promise<BranchClickResultRow[]> {
    const rows: BranchClickResultRow[] = [];
    for (const segment of segments) {
      const segmentRows = await this.fetchAggregate<BranchClickResultRow>(
        'deep_link_events',
        'eo_click',
        [CHANNEL_DIMENSION, CAMPAIGN_DIMENSION, FEATURE_DIMENSION],
        segment,
        signal,
      );
      rows.push(...segmentRows);
    }
    return rows;
  }

  private async writePhase(
    storage: StorageHandle,
    phase: BranchPhase,
    window: BranchWindow,
    signal?: AbortSignal,
  ): Promise<void> {
    const segments = splitWindow(window);
    if (phase === 'install_metrics') {
      const buckets = await this.fetchInstallBuckets(segments, signal);
      await storage.metrics([], { names: [INSTALL_METRIC_NAME] });
      for (const bucket of buckets) {
        await storage.metric(installBucketToMetricSample(bucket));
      }
      return;
    }
    const rows = await this.fetchClickRows(segments, signal);
    for (const row of rows) {
      await storage.event(clickRowToEventRecord(row));
    }
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const cursor: BranchSyncCursor | undefined = isBranchSyncCursor(
      options.cursor,
    )
      ? options.cursor
      : undefined;
    const lookbackDays = this.settings.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
    const window = getWindow(options, lookbackDays);

    const phases = selectActivePhases<BranchResource, BranchPhase>(
      (r) => r,
      PHASE_ORDER,
      this.settings.resources,
    );

    return paginateChunked<BranchPhase, string>({
      phases,
      cursor,
      signal,
      logger: this.logger,
      fetchPage: async (_phase, _page, _sig) => ({ items: [null], next: null }),
      writeBatch: async (phase, _items, _page) => {
        await this.writePhase(storage, phase, window, signal);
      },
    });
  }
}
