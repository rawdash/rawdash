import { connectorUserAgent, parseEpoch } from '@rawdash/connector-shared';
import {
  BaseConnector,
  type ChunkedSyncCursor,
  type ConnectorContext,
  type ConnectorDoc,
  type CredentialsSchema,
  type Event,
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
    serverToken: z.object({ $secret: z.string() }).meta({
      label: 'Server API token',
      description:
        'A Postmark server API token (read access). Find it in the Postmark app under your server, on the API Tokens tab.',
      placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
      secret: true,
    }),
    messageStream: z.string().min(1).optional().meta({
      label: 'Message stream',
      description:
        'Optional message stream id to scope stats and bounces to a single stream (e.g. `outbound`, `broadcast`). Omit to aggregate across all streams on the server.',
      placeholder: 'outbound',
    }),
    lookbackDays: z.number().int().positive().optional().meta({
      label: 'Lookback days (full sync)',
      description:
        'How many calendar days of stats and bounces to fetch on a full sync. Defaults to 90.',
      placeholder: '90',
    }),
    resources: z
      .array(z.enum(['email_stats', 'bounces']))
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          'Which Postmark resources to sync. Omit to sync all of them.',
      }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'Postmark',
  category: 'engineering',
  brandColor: '#FFCC00',
  tagline:
    'Sync Postmark daily outbound email stats (sent, delivered, bounces, spam complaints, opens) and individual bounce records for transactional email deliverability dashboards.',
  vendor: {
    name: 'Postmark',
    domain: 'postmarkapp.com',
    apiDocs: 'https://postmarkapp.com/developer/api/overview',
    website: 'https://postmarkapp.com',
  },
  auth: {
    summary:
      'A Postmark server API token. Each token is scoped to a single Postmark server and is sent in the X-Postmark-Server-Token header.',
    setup: [
      'In the Postmark app, open the server you want to sync and go to the API Tokens tab.',
      'Copy the Server API Token (it is a UUID). Each token is scoped to one server, so run one connector instance per Postmark server.',
      'Store the token as a secret and reference it from config as `serverToken: secret("POSTMARK_SERVER_TOKEN")`.',
    ],
  },
  rateLimit:
    'Postmark does not publish a fixed per-token request rate limit; the connector issues a small number of sequential requests per sync (four daily-stats endpoints plus paginated bounces) and relies on the shared HTTP client to honor 429 responses with backoff.',
  limitations: [
    'Daily granularity only - stats are bucketed per calendar day (UTC).',
    'Delivered is derived as sent minus total bounces (hard, soft, SMTP API errors, and transient) for the day, clamped at zero, because Postmark does not expose a direct delivered counter.',
    'A server token is scoped to one Postmark server, so each connector instance covers a single server. Cross-server aggregation via an account token is out of scope.',
    'Bounce events are retained as a rolling window (lookbackDays) and rewritten on every sync; bounces older than the window age out. Stats history beyond the window is preserved across incremental syncs.',
  ],
});

export interface PostmarkSettings {
  messageStream?: string;
  lookbackDays?: number;
  resources?: readonly PostmarkResource[];
}

const postmarkCredentials = {
  serverToken: {
    description: 'Postmark server API token',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type PostmarkCredentials = typeof postmarkCredentials;

const PHASE_ORDER = ['email_stats', 'bounces'] as const;

type PostmarkPhase = (typeof PHASE_ORDER)[number];

export type PostmarkResource = PostmarkPhase;

type PostmarkSyncCursor = ChunkedSyncCursor<PostmarkPhase, string>;

const isPostmarkSyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

const BASE_URL = 'https://api.postmarkapp.com';
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_LOOKBACK_DAYS = 90;
const INCREMENTAL_LOOKBACK_DAYS = 14;
const BOUNCE_PAGE_SIZE = 500;
const BOUNCE_MAX_OFFSET = 10000;

const EMAIL_STATS_METRIC = 'postmark_email_stats';
const BOUNCE_EVENT = 'postmark_bounce';

const dateString = z
  .string()
  .regex(/^(19|20)\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);

const isoTimestampString = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/,
  );

const sendsResponseSchema = z.object({
  Sent: z.number().nullish(),
  Days: z.array(
    z.object({
      Date: dateString,
      Sent: z.number().nullish(),
    }),
  ),
});

const bounceStatsResponseSchema = z.object({
  HardBounce: z.number().nullish(),
  SoftBounce: z.number().nullish(),
  SMTPApiError: z.number().nullish(),
  Transient: z.number().nullish(),
  Days: z.array(
    z.object({
      Date: dateString,
      HardBounce: z.number().nullish(),
      SoftBounce: z.number().nullish(),
      SMTPApiError: z.number().nullish(),
      Transient: z.number().nullish(),
    }),
  ),
});

const spamResponseSchema = z.object({
  SpamComplaint: z.number().nullish(),
  Days: z.array(
    z.object({
      Date: dateString,
      SpamComplaint: z.number().nullish(),
    }),
  ),
});

const opensResponseSchema = z.object({
  Opens: z.number().nullish(),
  Unique: z.number().nullish(),
  Days: z.array(
    z.object({
      Date: dateString,
      Opens: z.number().nullish(),
      Unique: z.number().nullish(),
    }),
  ),
});

const bounceRecordSchema = z.object({
  ID: z.number(),
  Type: z.string().nullish(),
  TypeCode: z.number().nullish(),
  Name: z.string().nullish(),
  Tag: z.string().nullish(),
  MessageID: z.string().nullish(),
  ServerID: z.number().nullish(),
  MessageStream: z.string().nullish(),
  Description: z.string().nullish(),
  Details: z.string().nullish(),
  Email: z.string().nullish(),
  From: z.string().nullish(),
  BouncedAt: isoTimestampString,
  DumpAvailable: z.boolean().nullish(),
  Inactive: z.boolean().nullish(),
  CanActivate: z.boolean().nullish(),
  Subject: z.string().nullish(),
});

const bouncesResponseSchema = z.object({
  TotalCount: z.number().nullish(),
  Bounces: z.array(bounceRecordSchema),
});

export const postmarkResources = defineResources({
  [EMAIL_STATS_METRIC]: {
    shape: 'metric',
    description:
      'Daily outbound email stats per calendar day: sent (the metric value), plus delivered, bounce, spam-complaint, and open counters.',
    endpoint: 'GET /stats/outbound/{sends,bounces,spam,opens}',
    unit: 'emails',
    granularity: 'day',
    notes:
      'Merges four Postmark outbound-stats endpoints (sends, bounces, spam, opens) keyed by date. The metric value is the daily sent count; delivered is sent minus total bounces clamped at zero.',
    dimensions: [
      { name: 'date', description: 'Calendar day of the stats sample (UTC).' },
      {
        name: 'stream',
        description:
          'Message stream the stats are scoped to, or `all` when aggregated across streams.',
      },
    ],
    measures: [
      { name: 'delivered', description: 'Sent minus total bounces (>= 0).' },
      { name: 'bounced', description: 'Total bounces (all bounce types).' },
      { name: 'hardBounces', description: 'Hard bounce count.' },
      { name: 'softBounces', description: 'Soft bounce count.' },
      { name: 'smtpApiErrors', description: 'SMTP API error count.' },
      { name: 'transient', description: 'Transient bounce count.' },
      { name: 'spamComplaints', description: 'Spam complaint count.' },
      { name: 'opens', description: 'Total opens.' },
      { name: 'uniqueOpens', description: 'Unique opens.' },
      {
        name: 'bounceRate',
        description: 'Total bounces divided by sent (0 when sent is 0).',
      },
    ],
    responses: {
      email_stats_sends: sendsResponseSchema,
      email_stats_bounces: bounceStatsResponseSchema,
      email_stats_spam: spamResponseSchema,
      email_stats_opens: opensResponseSchema,
    },
  },
  [BOUNCE_EVENT]: {
    shape: 'event',
    description:
      'Individual bounce records (one event per bounce) timestamped at the bounce time, carrying type, recipient, stream, and activation state.',
    endpoint: 'GET /bounces',
    notes:
      'Fetched over a rolling lookback window and rewritten on every sync, so resyncs are idempotent.',
    fields: [
      {
        name: 'bounceId',
        description: 'Postmark bounce id.',
      },
      {
        name: 'type',
        description: 'Bounce type (e.g. HardBounce, Transient).',
      },
      { name: 'typeCode', description: 'Numeric bounce type code.' },
      { name: 'email', description: 'Recipient email address.' },
      { name: 'from', description: 'Sender address the bounce is for.' },
      { name: 'tag', description: 'Tag attached to the original message.' },
      { name: 'messageStream', description: 'Message stream id.' },
      { name: 'messageId', description: 'Original message id.' },
      { name: 'serverId', description: 'Postmark server id.' },
      { name: 'subject', description: 'Subject of the bounced message.' },
      { name: 'name', description: 'Human-readable bounce name.' },
      { name: 'description', description: 'Bounce description.' },
      { name: 'inactive', description: 'Whether the address was deactivated.' },
      {
        name: 'canActivate',
        description: 'Whether the address can be reactivated.',
      },
      {
        name: 'dumpAvailable',
        description: 'Whether the raw SMTP dump is available.',
      },
    ],
    filterable: [],
    responses: { bounces: bouncesResponseSchema },
  },
});

export type PostmarkBounceRecord = z.infer<typeof bounceRecordSchema>;

interface StatsWindow {
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

export function getStatsWindow(
  options: SyncOptions,
  lookbackDays: number,
  now: number = Date.now(),
): StatsWindow {
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

function counterValue(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

interface DayBucket {
  date: string;
  sent: number;
  hardBounces: number;
  softBounces: number;
  smtpApiErrors: number;
  transient: number;
  spamComplaints: number;
  opens: number;
  uniqueOpens: number;
}

function emptyBucket(date: string): DayBucket {
  return {
    date,
    sent: 0,
    hardBounces: 0,
    softBounces: 0,
    smtpApiErrors: 0,
    transient: 0,
    spamComplaints: 0,
    opens: 0,
    uniqueOpens: 0,
  };
}

export function mergeDayBuckets(input: {
  sends: z.infer<typeof sendsResponseSchema>;
  bounces: z.infer<typeof bounceStatsResponseSchema>;
  spam: z.infer<typeof spamResponseSchema>;
  opens: z.infer<typeof opensResponseSchema>;
}): DayBucket[] {
  const byDate = new Map<string, DayBucket>();
  const bucketFor = (date: string): DayBucket => {
    let bucket = byDate.get(date);
    if (!bucket) {
      bucket = emptyBucket(date);
      byDate.set(date, bucket);
    }
    return bucket;
  };
  for (const day of input.sends.Days) {
    bucketFor(day.Date).sent += counterValue(day.Sent);
  }
  for (const day of input.bounces.Days) {
    const bucket = bucketFor(day.Date);
    bucket.hardBounces += counterValue(day.HardBounce);
    bucket.softBounces += counterValue(day.SoftBounce);
    bucket.smtpApiErrors += counterValue(day.SMTPApiError);
    bucket.transient += counterValue(day.Transient);
  }
  for (const day of input.spam.Days) {
    bucketFor(day.Date).spamComplaints += counterValue(day.SpamComplaint);
  }
  for (const day of input.opens.Days) {
    const bucket = bucketFor(day.Date);
    bucket.opens += counterValue(day.Opens);
    bucket.uniqueOpens += counterValue(day.Unique);
  }
  return Array.from(byDate.values()).sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );
}

export function dayBucketToMetricSample(
  bucket: DayBucket,
  stream: string,
): MetricSample {
  const ts = isoDateToMs(bucket.date);
  const bounced =
    bucket.hardBounces +
    bucket.softBounces +
    bucket.smtpApiErrors +
    bucket.transient;
  const delivered = Math.max(0, bucket.sent - bounced);
  const bounceRate = bucket.sent > 0 ? bounced / bucket.sent : 0;
  return metricSample(postmarkResources, EMAIL_STATS_METRIC, {
    ts: Number.isFinite(ts) ? ts : 0,
    value: bucket.sent,
    attributes: {
      date: bucket.date,
      stream,
      delivered,
      bounced,
      hardBounces: bucket.hardBounces,
      softBounces: bucket.softBounces,
      smtpApiErrors: bucket.smtpApiErrors,
      transient: bucket.transient,
      spamComplaints: bucket.spamComplaints,
      opens: bucket.opens,
      uniqueOpens: bucket.uniqueOpens,
      bounceRate,
    },
  });
}

export function bounceToEvent(record: PostmarkBounceRecord): Event {
  const ts = parseEpoch(record.BouncedAt, 'iso') ?? 0;
  const attributes: Record<string, JSONValue> = {
    bounceId: record.ID,
    type: record.Type ?? null,
    typeCode: record.TypeCode ?? null,
    email: record.Email ?? null,
    from: record.From ?? null,
    tag: record.Tag ?? null,
    messageStream: record.MessageStream ?? null,
    messageId: record.MessageID ?? null,
    serverId: record.ServerID ?? null,
    subject: record.Subject ?? null,
    name: record.Name ?? null,
    description: record.Description ?? null,
    inactive: record.Inactive ?? null,
    canActivate: record.CanActivate ?? null,
    dumpAvailable: record.DumpAvailable ?? null,
  };
  return {
    name: BOUNCE_EVENT,
    start_ts: ts,
    end_ts: ts,
    attributes,
  };
}

export const id = 'postmark';

export class PostmarkConnector extends BaseConnector<
  PostmarkSettings,
  PostmarkCredentials
> {
  static readonly id = id;

  static readonly resources = postmarkResources;

  static readonly schemas = schemasFromResources(postmarkResources);

  static create(input: unknown, ctx?: ConnectorContext): PostmarkConnector {
    const parsed = configFields.parse(input);
    return new PostmarkConnector(
      {
        messageStream: parsed.messageStream,
        lookbackDays: parsed.lookbackDays,
        resources: parsed.resources,
      },
      { serverToken: parsed.serverToken },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = postmarkCredentials;

  private buildHeaders(): Record<string, string> {
    return {
      Accept: 'application/json',
      'X-Postmark-Server-Token': this.creds.serverToken,
      'User-Agent': connectorUserAgent('postmark'),
    };
  }

  private async fetchStats<T>(
    path: string,
    resource: string,
    window: StatsWindow,
    signal?: AbortSignal,
  ): Promise<T> {
    const url = new URL(`${BASE_URL}${path}`);
    url.searchParams.set('fromdate', window.from);
    url.searchParams.set('todate', window.to);
    if (this.settings.messageStream) {
      url.searchParams.set('messagestream', this.settings.messageStream);
    }
    const res = await this.get<T>(url.toString(), {
      resource,
      headers: this.buildHeaders(),
      signal,
    });
    return res.body;
  }

  private async writeEmailStats(
    storage: StorageHandle,
    window: StatsWindow,
    signal?: AbortSignal,
  ): Promise<void> {
    const [sends, bounces, spam, opens] = await Promise.all([
      this.fetchStats<z.infer<typeof sendsResponseSchema>>(
        '/stats/outbound/sends',
        'email_stats_sends',
        window,
        signal,
      ),
      this.fetchStats<z.infer<typeof bounceStatsResponseSchema>>(
        '/stats/outbound/bounces',
        'email_stats_bounces',
        window,
        signal,
      ),
      this.fetchStats<z.infer<typeof spamResponseSchema>>(
        '/stats/outbound/spam',
        'email_stats_spam',
        window,
        signal,
      ),
      this.fetchStats<z.infer<typeof opensResponseSchema>>(
        '/stats/outbound/opens',
        'email_stats_opens',
        window,
        signal,
      ),
    ]);
    const buckets = mergeDayBuckets({
      sends: { Days: sends.Days ?? [] },
      bounces: { Days: bounces.Days ?? [] },
      spam: { Days: spam.Days ?? [] },
      opens: { Days: opens.Days ?? [] },
    });
    const stream = this.settings.messageStream ?? 'all';
    const samples = buckets.map((bucket) =>
      dayBucketToMetricSample(bucket, stream),
    );
    const startMs = isoDateToMs(window.from);
    const endMs = isoDateToMs(window.to);
    const replaceWindow =
      Number.isFinite(startMs) && Number.isFinite(endMs)
        ? { start: startMs, end: endMs + MS_PER_DAY - 1 }
        : undefined;
    await storage.metrics(samples, {
      names: [EMAIL_STATS_METRIC],
      ...(replaceWindow ? { replaceWindow } : {}),
    });
  }

  private async fetchBounces(
    window: StatsWindow,
    signal?: AbortSignal,
  ): Promise<PostmarkBounceRecord[]> {
    const records: PostmarkBounceRecord[] = [];
    let offset = 0;
    for (;;) {
      const url = new URL(`${BASE_URL}/bounces`);
      url.searchParams.set('count', String(BOUNCE_PAGE_SIZE));
      url.searchParams.set('offset', String(offset));
      url.searchParams.set('fromdate', window.from);
      url.searchParams.set('todate', window.to);
      if (this.settings.messageStream) {
        url.searchParams.set('messagestream', this.settings.messageStream);
      }
      const res = await this.get<z.infer<typeof bouncesResponseSchema>>(
        url.toString(),
        {
          resource: 'bounces',
          headers: this.buildHeaders(),
          signal,
        },
      );
      const page = res.body.Bounces ?? [];
      records.push(...page);
      offset += BOUNCE_PAGE_SIZE;
      if (page.length < BOUNCE_PAGE_SIZE) {
        break;
      }
      if (offset >= BOUNCE_MAX_OFFSET) {
        this.logger?.warn?.(
          `[postmark] bounces hit the ${BOUNCE_MAX_OFFSET}-record API window cap; older bounces in this window were not fetched`,
        );
        break;
      }
    }
    return records;
  }

  private async writeBounces(
    storage: StorageHandle,
    window: StatsWindow,
    signal?: AbortSignal,
  ): Promise<void> {
    const records = await this.fetchBounces(window, signal);
    const events = records.map((record) => bounceToEvent(record));
    await storage.events(events, { names: [BOUNCE_EVENT] });
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const cursor: PostmarkSyncCursor | undefined = isPostmarkSyncCursor(
      options.cursor,
    )
      ? options.cursor
      : undefined;
    const lookbackDays = this.settings.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
    const statsWindow = getStatsWindow(options, lookbackDays);
    const bounceWindow: StatsWindow = {
      from: toIsoDate(
        startOfUtcDay(Date.now()) - (lookbackDays - 1) * MS_PER_DAY,
      ),
      to: toIsoDate(startOfUtcDay(Date.now())),
    };

    const phases = selectActivePhases<PostmarkResource, PostmarkPhase>(
      (r) => r,
      PHASE_ORDER,
      this.settings.resources,
    );

    return paginateChunked<PostmarkPhase, string>({
      phases,
      cursor,
      signal,
      logger: this.logger,
      fetchPage: async (_phase, _page, _sig) => ({ items: [null], next: null }),
      writeBatch: async (phase, _items, _page) => {
        if (phase === 'email_stats') {
          await this.writeEmailStats(storage, statsWindow, signal);
          return;
        }
        await this.writeBounces(storage, bounceWindow, signal);
      },
    });
  }
}
