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
    'Sync Branch install attribution metrics (installs, opens, conversions) and deep-link click events from the Cross-Platform Analytics API for mobile attribution dashboards.',
  vendor: {
    name: 'Branch',
    domain: 'branch.io',
    apiDocs: 'https://help.branch.io/developers-hub/reference',
    website: 'https://www.branch.io',
  },
  auth: {
    summary:
      'A Branch app key and secret, used together to authenticate Cross-Platform Analytics API requests.',
    setup: [
      'In the Branch dashboard, open Account Settings -> Profile and copy the Branch Key (starts with `key_live_`).',
      'On the same screen, reveal and copy the Branch Secret (starts with `secret_live_`). Both values are app-scoped; keep them in a secret store.',
      'Reference them from the connector config as `branchKey: secret("BRANCH_KEY")` and `branchSecret: secret("BRANCH_SECRET")`.',
    ],
  },
  rateLimit:
    'Branch enforces a per-app request quota on the Cross-Platform Analytics API (roughly 1 request/second). The connector issues one POST per data source per resource per sync and respects 429 + Retry-After backoff via the shared HTTP client.',
  limitations: [
    'Daily granularity only - the connector requests `granularity=day` from the Branch Aggregate API to keep result cardinality bounded.',
    'Cost attribution is best-effort - Branch only exposes `cost_in_local_currency` for ad-network-integrated channels. Rows without cost data carry `costEstimated: 0`.',
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

const INSTALL_METRIC_NAME = 'branch_install_metrics';
const DEEP_LINK_EVENT_NAME = 'branch_deep_link_event';

const CHANNEL_DIMENSION = 'last_attributed_touch_data_tilde_channel';
const CAMPAIGN_DIMENSION = 'last_attributed_touch_data_tilde_campaign';
const FEATURE_DIMENSION = 'last_attributed_touch_data_tilde_feature';

const INSTALL_DATA_SOURCES = ['eo_install', 'eo_open', 'eo_event'] as const;
type InstallDataSource = (typeof INSTALL_DATA_SOURCES)[number];

const COUNT_FIELD_BY_DATA_SOURCE: Record<InstallDataSource, string> = {
  eo_install: 'installs',
  eo_open: 'opens',
  eo_event: 'conversions',
};

const isoDateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const numericLike = z.union([z.number(), z.string(), z.null()]).optional();

const installResultRowSchema = z.object({
  unique_count: numericLike,
  result: z.object({
    timestamp: isoDateString,
    [CHANNEL_DIMENSION]: z.string().nullish(),
    [CAMPAIGN_DIMENSION]: z.string().nullish(),
    cost_in_local_currency: numericLike,
  }),
});

const installResponseSchema = z.object({
  results: z.array(installResultRowSchema),
});

const clickResultRowSchema = z.object({
  unique_count: numericLike,
  result: z.object({
    timestamp: isoDateString,
    [CHANNEL_DIMENSION]: z.string().nullish(),
    [CAMPAIGN_DIMENSION]: z.string().nullish(),
    [FEATURE_DIMENSION]: z.string().nullish(),
  }),
});

const clickResponseSchema = z.object({
  results: z.array(clickResultRowSchema),
});

export const branchResources = defineResources({
  [INSTALL_METRIC_NAME]: {
    shape: 'metric',
    description:
      'Daily Branch attribution metrics bucketed by channel and campaign. Primary value is `installs`; `opens`, `conversions`, and `costEstimated` are carried as attributes.',
    endpoint: 'POST /v1/query/analytics',
    unit: 'installs',
    granularity: 'day',
    notes:
      'Merges three Aggregate API calls (data_source=eo_install, eo_open, eo_event) keyed by (date, channel, campaign). Rows with missing channel or campaign are recorded as `null` for that attribute.',
    dimensions: [
      { name: 'date', description: 'Calendar day of the metric sample (UTC).' },
      { name: 'channel', description: 'Branch last-attributed channel.' },
      { name: 'campaign', description: 'Branch last-attributed campaign.' },
      { name: 'installs', description: 'Attributed installs on the day.' },
      { name: 'opens', description: 'Attributed app opens on the day.' },
      {
        name: 'conversions',
        description: 'Attributed in-app conversion events on the day.',
      },
      {
        name: 'costEstimated',
        description:
          'Estimated cost in the app local currency (only populated for ad-network-integrated channels; 0 otherwise).',
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
  costEstimated: number;
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
      const date = normalizeDateBucket(row.result.timestamp);
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
          costEstimated: 0,
        };
        buckets.set(key, bucket);
      }
      const count = parseNumber(row.unique_count);
      if (field === 'installs') {
        bucket.installs += count;
      } else if (field === 'opens') {
        bucket.opens += count;
      } else {
        bucket.conversions += count;
      }
      if (dataSource === 'eo_install') {
        bucket.costEstimated += parseNumber(row.result.cost_in_local_currency);
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
      costEstimated: bucket.costEstimated,
    },
  };
}

export function clickRowToEventRecord(row: BranchClickResultRow): Event {
  const date = normalizeDateBucket(row.result.timestamp);
  const channel =
    (row.result[CHANNEL_DIMENSION] as string | null | undefined) ?? null;
  const campaign =
    (row.result[CAMPAIGN_DIMENSION] as string | null | undefined) ?? null;
  const feature =
    (row.result[FEATURE_DIMENSION] as string | null | undefined) ?? null;
  const ts = isoDateToMs(date);
  const clicks = parseNumber(row.unique_count);
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
    });
  }

  private async fetchAggregate<T>(
    resource: string,
    dataSource: string,
    dimensions: string[],
    window: BranchWindow,
    signal?: AbortSignal,
  ): Promise<{ results?: T[] }> {
    const res = await this.post<{ results?: T[] }>(ANALYTICS_API_URL, {
      resource,
      headers: this.buildHeaders(),
      body: this.buildBody(dataSource, dimensions, window),
      signal,
    });
    return res.body;
  }

  private async fetchInstallBuckets(
    window: BranchWindow,
    signal?: AbortSignal,
  ): Promise<InstallBucket[]> {
    const dims = [CHANNEL_DIMENSION, CAMPAIGN_DIMENSION];
    const rowsByDataSource = {
      eo_install: [] as BranchInstallResultRow[],
      eo_open: [] as BranchInstallResultRow[],
      eo_event: [] as BranchInstallResultRow[],
    };
    for (const dataSource of INSTALL_DATA_SOURCES) {
      const field = COUNT_FIELD_BY_DATA_SOURCE[dataSource];
      const tag = `install_metrics_${field}`;
      const body = await this.fetchAggregate<BranchInstallResultRow>(
        tag,
        dataSource,
        dims,
        window,
        signal,
      );
      rowsByDataSource[dataSource] = body.results ?? [];
    }
    return mergeInstallBuckets(rowsByDataSource);
  }

  private async fetchClickRows(
    window: BranchWindow,
    signal?: AbortSignal,
  ): Promise<BranchClickResultRow[]> {
    const body = await this.fetchAggregate<BranchClickResultRow>(
      'deep_link_events',
      'eo_click',
      [CHANNEL_DIMENSION, CAMPAIGN_DIMENSION, FEATURE_DIMENSION],
      window,
      signal,
    );
    return body.results ?? [];
  }

  private async writePhase(
    storage: StorageHandle,
    phase: BranchPhase,
    window: BranchWindow,
    signal?: AbortSignal,
  ): Promise<void> {
    if (phase === 'install_metrics') {
      const buckets = await this.fetchInstallBuckets(window, signal);
      await storage.metrics([], { names: [INSTALL_METRIC_NAME] });
      for (const bucket of buckets) {
        await storage.metric(installBucketToMetricSample(bucket));
      }
      return;
    }
    const rows = await this.fetchClickRows(window, signal);
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
