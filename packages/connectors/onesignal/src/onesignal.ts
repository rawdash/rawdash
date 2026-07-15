import { connectorUserAgent, parseEpoch } from '@rawdash/connector-shared';
import {
  BaseConnector,
  type ChunkedSyncCursor,
  type ConnectorContext,
  type ConnectorDoc,
  type CredentialsSchema,
  type Entity,
  type JSONValue,
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
    apiKey: z.object({ $secret: z.string() }).meta({
      label: 'REST API key',
      description:
        'A OneSignal REST API key with read access to your app. Find it in the OneSignal dashboard under Settings > Keys & IDs.',
      placeholder: 'os_v2_app_xxxxxxxxxxxxxxxxxxxxxxxxxx',
      secret: true,
    }),
    appId: z.string().min(1).meta({
      label: 'App ID',
      description:
        'The OneSignal App ID (a UUID) the key belongs to. Find it alongside the REST API key under Settings > Keys & IDs.',
      placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
    }),
    lookbackDays: z.number().int().positive().optional().meta({
      label: 'Lookback days (full sync)',
      description:
        'How many days of message history to page back through on a full sync. OneSignal lists notifications newest first, so the connector stops paging once it reaches notifications older than this window. Defaults to 90.',
      placeholder: '90',
    }),
    resources: z
      .array(z.enum(['notifications', 'notification_stats']))
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          'Which OneSignal resources to sync. Omit to sync all of them.',
      }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'OneSignal',
  category: 'marketing',
  brandColor: '#E44A49',
  tagline:
    'Sync OneSignal push and messaging campaigns as entities and daily delivery stats as metrics to chart send volume, delivery rate, and conversions on a dashboard.',
  vendor: {
    name: 'OneSignal',
    domain: 'onesignal.com',
    apiDocs: 'https://documentation.onesignal.com/reference/rest-api-overview',
    website: 'https://onesignal.com',
  },
  auth: {
    summary:
      'A OneSignal REST API key plus the App ID it belongs to. The key is sent in the Authorization header as `Key <REST_API_KEY>` and every request is scoped to a single app via the app_id query parameter.',
    setup: [
      'In the OneSignal dashboard open your app and go to Settings > Keys & IDs.',
      'Copy the REST API Key and the App ID (a UUID). Each key is scoped to one app, so run one connector instance per OneSignal app.',
      'Store the REST API Key as a secret and reference it from config as `apiKey: secret("ONESIGNAL_REST_API_KEY")`, and set `appId` to the App ID.',
    ],
  },
  rateLimit:
    'OneSignal rate-limits the view endpoints to roughly 1 request/second per app and returns 429 with a Retry-After header when exceeded; the connector issues sequential paginated requests and relies on the shared HTTP client to honor 429 backoff.',
  limitations: [
    'Daily stats are derived from the message list (each message carries its own successful, failed, converted, and received counters) rather than read from a dedicated analytics endpoint, and are bucketed by queued day in UTC.',
    'A REST API key is scoped to one OneSignal app, so each connector instance covers a single app. Cross-app aggregation is out of scope.',
    'Message counters reflect the delivery state as of the sync that captured the message. A message whose counters advance after it was first synced is revisited on incremental syncs only while it stays within the lookback window.',
    'Full syncs page newest-first until they reach the lookback window; message history older than the configured lookback is not backfilled.',
    'Subscriber (player) records and per-message outcome breakdowns are out of scope.',
  ],
});

export interface OneSignalSettings {
  appId: string;
  lookbackDays?: number;
  resources?: readonly OneSignalResource[];
}

const onesignalCredentials = {
  apiKey: {
    description: 'OneSignal REST API key',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type OneSignalCredentials = typeof onesignalCredentials;

const PHASE_ORDER = ['notifications', 'notification_stats'] as const;

type OneSignalPhase = (typeof PHASE_ORDER)[number];

export type OneSignalResource = OneSignalPhase;

type OneSignalSyncCursor = ChunkedSyncCursor<OneSignalPhase, string>;

const isOneSignalSyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

const BASE_URL = 'https://api.onesignal.com';
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_LOOKBACK_DAYS = 90;
const INCREMENTAL_LOOKBACK_DAYS = 14;
const PAGE_SIZE = 50;

const NOTIFICATION_ENTITY = 'onesignal_notification';
const STATS_METRIC = 'onesignal_notification_stats';

const localizedTextSchema = z.record(z.string(), z.string()).nullish();

const notificationSchema = z.object({
  id: z.string().min(1),
  name: z.string().nullish(),
  contents: localizedTextSchema,
  headings: localizedTextSchema,
  url: z.string().nullish(),
  successful: z.number().nullish(),
  failed: z.number().nullish(),
  errored: z.number().nullish(),
  converted: z.number().nullish(),
  received: z.number().nullish(),
  remaining: z.number().nullish(),
  canceled: z.boolean().nullish(),
  queued_at: z.number().nullish(),
  send_after: z.number().nullish(),
  completed_at: z.number().nullish(),
});

const notificationsResponseSchema = z.object({
  total_count: z.number().nullish(),
  offset: z.number().nullish(),
  limit: z.number().nullish(),
  notifications: z.array(notificationSchema),
});

export const onesignalResources = defineResources({
  [NOTIFICATION_ENTITY]: {
    shape: 'entity',
    description:
      'Push and messaging campaigns sent through OneSignal, each carrying its delivery counters (successful, failed, errored, converted, received), derived delivery and conversion rates, and queued/completed timestamps.',
    endpoint: 'GET /notifications',
    notes:
      'Paged newest-first; full syncs stop at the lookback window and incremental syncs stop once a page predates the last sync. Counters reflect the delivery state captured at sync time.',
    fields: [
      { name: 'name', description: 'Internal campaign/message name, if set.' },
      {
        name: 'message',
        description: 'Message body (English content when available).',
      },
      {
        name: 'heading',
        description: 'Message heading/title (English content when available).',
      },
      { name: 'url', description: 'Launch URL attached to the message.' },
      {
        name: 'successful',
        description: 'Number of recipients the message was delivered to.',
      },
      {
        name: 'failed',
        description: 'Number of recipients delivery failed for.',
      },
      {
        name: 'errored',
        description: 'Number of recipients that errored during send.',
      },
      {
        name: 'converted',
        description: 'Number of recipients that converted (clicked/opened).',
      },
      {
        name: 'received',
        description: 'Number of recipients confirmed to have received it.',
      },
      {
        name: 'remaining',
        description: 'Recipients still pending delivery, or null when done.',
      },
      {
        name: 'recipients',
        description:
          'Total targeted recipients (successful + failed + errored).',
      },
      {
        name: 'deliveryRate',
        description: 'successful divided by recipients (0 when none targeted).',
      },
      {
        name: 'conversionRate',
        description: 'converted divided by successful (0 when none delivered).',
      },
      { name: 'canceled', description: 'Whether the message was canceled.' },
      {
        name: 'queuedAt',
        description: 'When the message was queued, in epoch milliseconds.',
      },
      {
        name: 'sendAfter',
        description:
          'Scheduled send time, in epoch milliseconds, if scheduled.',
      },
      {
        name: 'completedAt',
        description: 'When sending completed, in epoch milliseconds.',
      },
    ],
    filterable: [{ field: 'canceled', ops: ['eq'] }],
    responses: { notifications: notificationsResponseSchema },
  },
  [STATS_METRIC]: {
    shape: 'metric',
    description:
      'Daily messaging delivery stats bucketed by queued day: total recipients targeted (the metric value) plus delivered, failed, errored, converted, and received counters aggregated across all messages that day.',
    endpoint: 'GET /notifications',
    unit: 'sends',
    granularity: 'day',
    notes:
      'Aggregated from the message list over the lookback window and rewritten per window on each sync, so resyncs are idempotent. The metric value is total targeted recipients (successful + failed + errored).',
    dimensions: [
      {
        name: 'date',
        description: 'Calendar day (UTC) the messages were queued.',
      },
    ],
    measures: [
      {
        name: 'notifications',
        description: 'Number of messages queued that day.',
      },
      { name: 'delivered', description: 'Total successful deliveries.' },
      { name: 'failed', description: 'Total failed deliveries.' },
      { name: 'errored', description: 'Total errored sends.' },
      { name: 'converted', description: 'Total conversions (clicks/opens).' },
      { name: 'received', description: 'Total confirmed receipts.' },
      {
        name: 'deliveryRate',
        description: 'Delivered divided by recipients (0 when none targeted).',
      },
      {
        name: 'conversionRate',
        description: 'Converted divided by delivered (0 when none delivered).',
      },
    ],
    responses: { notification_stats: notificationsResponseSchema },
  },
});

export type OneSignalNotification = z.infer<typeof notificationSchema>;

function counterValue(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function firstLocalizedValue(
  value: Record<string, string> | null | undefined,
): string | null {
  if (!value) {
    return null;
  }
  if (typeof value.en === 'string') {
    return value.en;
  }
  for (const text of Object.values(value)) {
    if (typeof text === 'string') {
      return text;
    }
  }
  return null;
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

export function notificationToEntity(n: OneSignalNotification): Entity {
  const queuedMs = parseEpoch(n.queued_at, 's');
  const completedMs = parseEpoch(n.completed_at, 's');
  const sendAfterMs = parseEpoch(n.send_after, 's');
  const successful = counterValue(n.successful);
  const failed = counterValue(n.failed);
  const errored = counterValue(n.errored);
  const converted = counterValue(n.converted);
  const received = counterValue(n.received);
  const recipients = successful + failed + errored;
  const deliveryRate = recipients > 0 ? successful / recipients : 0;
  const conversionRate = successful > 0 ? converted / successful : 0;
  const attributes: Record<string, JSONValue> = {
    name: n.name ?? null,
    message: firstLocalizedValue(n.contents),
    heading: firstLocalizedValue(n.headings),
    url: n.url ?? null,
    successful,
    failed,
    errored,
    converted,
    received,
    remaining: n.remaining ?? null,
    recipients,
    deliveryRate,
    conversionRate,
    canceled: n.canceled ?? null,
    queuedAt: queuedMs ?? null,
    sendAfter: sendAfterMs ?? null,
    completedAt: completedMs ?? null,
  };
  return {
    type: NOTIFICATION_ENTITY,
    id: n.id,
    attributes,
    updated_at: completedMs ?? queuedMs ?? 0,
  };
}

interface StatsBucket {
  notifications: number;
  successful: number;
  failed: number;
  errored: number;
  converted: number;
  received: number;
}

function emptyBucket(): StatsBucket {
  return {
    notifications: 0,
    successful: 0,
    failed: 0,
    errored: 0,
    converted: 0,
    received: 0,
  };
}

export function bucketNotificationsByDay(
  records: OneSignalNotification[],
): Map<string, StatsBucket> {
  const byDate = new Map<string, StatsBucket>();
  for (const n of records) {
    const queuedMs = parseEpoch(n.queued_at, 's');
    if (queuedMs === null) {
      continue;
    }
    const date = toIsoDate(startOfUtcDay(queuedMs));
    let bucket = byDate.get(date);
    if (!bucket) {
      bucket = emptyBucket();
      byDate.set(date, bucket);
    }
    bucket.notifications += 1;
    bucket.successful += counterValue(n.successful);
    bucket.failed += counterValue(n.failed);
    bucket.errored += counterValue(n.errored);
    bucket.converted += counterValue(n.converted);
    bucket.received += counterValue(n.received);
  }
  return byDate;
}

export function bucketToMetricSample(
  date: string,
  bucket: StatsBucket,
): MetricSample {
  const ts = isoDateToMs(date);
  const recipients = bucket.successful + bucket.failed + bucket.errored;
  const deliveryRate = recipients > 0 ? bucket.successful / recipients : 0;
  const conversionRate =
    bucket.successful > 0 ? bucket.converted / bucket.successful : 0;
  return metricSample(onesignalResources, STATS_METRIC, {
    ts: Number.isFinite(ts) ? ts : 0,
    value: recipients,
    attributes: {
      date,
      notifications: bucket.notifications,
      delivered: bucket.successful,
      failed: bucket.failed,
      errored: bucket.errored,
      converted: bucket.converted,
      received: bucket.received,
      deliveryRate,
      conversionRate,
    },
  });
}

export const id = 'onesignal';

export class OneSignalConnector extends BaseConnector<
  OneSignalSettings,
  OneSignalCredentials
> {
  static readonly id = id;

  static readonly resources = onesignalResources;

  static readonly schemas = schemasFromResources(onesignalResources);

  static create(input: unknown, ctx?: ConnectorContext): OneSignalConnector {
    const parsed = configFields.parse(input);
    return new OneSignalConnector(
      {
        appId: parsed.appId,
        lookbackDays: parsed.lookbackDays,
        resources: parsed.resources,
      },
      { apiKey: parsed.apiKey },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = onesignalCredentials;

  private buildHeaders(): Record<string, string> {
    return {
      Accept: 'application/json',
      Authorization: `Key ${this.creds.apiKey}`,
      'User-Agent': connectorUserAgent('onesignal'),
    };
  }

  private cutoffMs(options: SyncOptions, now: number): number {
    if (options.mode === 'latest') {
      const sinceMs = options.since ? new Date(options.since).getTime() : NaN;
      if (Number.isFinite(sinceMs)) {
        return sinceMs;
      }
      return now - INCREMENTAL_LOOKBACK_DAYS * MS_PER_DAY;
    }
    const lookbackDays = this.settings.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
    const base = now - lookbackDays * MS_PER_DAY;
    if (options.since) {
      const sinceMs = new Date(options.since).getTime();
      if (Number.isFinite(sinceMs)) {
        return Math.max(base, sinceMs);
      }
    }
    return base;
  }

  private async fetchNotificationsPage(
    offset: number,
    cutoff: number,
    resource: string,
    signal?: AbortSignal,
  ): Promise<{ items: OneSignalNotification[]; next: number | null }> {
    const url = new URL(`${BASE_URL}/notifications`);
    url.searchParams.set('app_id', this.settings.appId);
    url.searchParams.set('limit', String(PAGE_SIZE));
    url.searchParams.set('offset', String(offset));
    const res = await this.get<z.infer<typeof notificationsResponseSchema>>(
      url.toString(),
      { resource, headers: this.buildHeaders(), signal },
    );
    const all = res.body.notifications ?? [];
    const kept: OneSignalNotification[] = [];
    let reachedCutoff = false;
    for (const n of all) {
      const ts = parseEpoch(n.queued_at, 's');
      if (ts !== null && ts <= cutoff) {
        reachedCutoff = true;
        break;
      }
      kept.push(n);
    }
    const total = res.body.total_count ?? null;
    const nextOffset = offset + PAGE_SIZE;
    const hasMore =
      all.length === PAGE_SIZE && (total === null || nextOffset < total);
    const next = !reachedCutoff && hasMore ? nextOffset : null;
    return { items: kept, next };
  }

  private async fetchAllNotifications(
    cutoff: number,
    resource: string,
    signal?: AbortSignal,
  ): Promise<OneSignalNotification[]> {
    const records: OneSignalNotification[] = [];
    let offset = 0;
    for (;;) {
      const page = await this.fetchNotificationsPage(
        offset,
        cutoff,
        resource,
        signal,
      );
      records.push(...page.items);
      if (page.next === null) {
        return records;
      }
      offset = page.next;
    }
  }

  private async writeNotifications(
    storage: StorageHandle,
    records: OneSignalNotification[],
    page: string | null,
    isFull: boolean,
  ): Promise<void> {
    if (isFull && page === null) {
      await storage.entities([], { types: [NOTIFICATION_ENTITY] });
    }
    for (const record of records) {
      await storage.entity(notificationToEntity(record));
    }
  }

  private async writeStats(
    storage: StorageHandle,
    options: SyncOptions,
    now: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const cutoff = this.cutoffMs(options, now);
    const records = await this.fetchAllNotifications(
      cutoff,
      'notification_stats',
      signal,
    );
    const buckets = bucketNotificationsByDay(records);
    const samples = Array.from(buckets.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([date, bucket]) => bucketToMetricSample(date, bucket));
    const startMs = startOfUtcDay(cutoff);
    const endMs = startOfUtcDay(now) + MS_PER_DAY - 1;
    await storage.metrics(samples, {
      names: [STATS_METRIC],
      replaceWindow: { start: startMs, end: endMs },
    });
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const cursor: OneSignalSyncCursor | undefined = isOneSignalSyncCursor(
      options.cursor,
    )
      ? options.cursor
      : undefined;
    const isFull = options.mode === 'full';
    const now = Date.now();
    const cutoff = this.cutoffMs(options, now);

    const phases = selectActivePhases<OneSignalResource, OneSignalPhase>(
      (r) => r,
      PHASE_ORDER,
      this.settings.resources,
    ).filter(
      (phase) =>
        options.resources === undefined || options.resources.has(phase),
    );

    return paginateChunked<OneSignalPhase, string>({
      phases,
      cursor,
      signal,
      logger: this.logger,
      fetchPage: async (phase, page, sig) => {
        if (phase === 'notifications') {
          const offset = page ? Number(page) : 0;
          const result = await this.fetchNotificationsPage(
            offset,
            cutoff,
            'notifications',
            sig,
          );
          return {
            items: result.items,
            next: result.next === null ? null : String(result.next),
          };
        }
        return { items: [null], next: null };
      },
      writeBatch: async (phase, items, page) => {
        if (phase === 'notifications') {
          await this.writeNotifications(
            storage,
            items as OneSignalNotification[],
            page,
            isFull,
          );
          return;
        }
        await this.writeStats(storage, options, now, signal);
      },
    });
  }
}
