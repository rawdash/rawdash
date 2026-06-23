import {
  type HttpResponse,
  connectorUserAgent,
  parseEpoch,
  standardRateLimitPolicy,
} from '@rawdash/connector-shared';
import {
  BaseConnector,
  type ChunkedSyncCursor,
  type ConnectorContext,
  type ConnectorDoc,
  type CredentialsSchema,
  type JSONValue,
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
    apiKey: z.object({ $secret: z.string().min(1) }).meta({
      label: 'API key',
      description:
        'SendGrid Web API v3 key with read access to the Stats and Suppressions APIs. Create one under Settings -> API Keys.',
      placeholder: 'SENDGRID_API_KEY',
      secret: true,
    }),
    categories: z.array(z.string().min(1)).nonempty().optional().meta({
      label: 'Categories',
      description:
        'Optional list of SendGrid categories to break email stats down by. When set, daily stats are fetched per category from the Category Stats endpoint; when omitted, account-wide global stats are fetched and tagged with the category "all".',
    }),
    backfillDays: z.number().int().positive().optional().meta({
      label: 'Backfill window (days)',
      description:
        'How many trailing days of email stats, bounces, and spam reports to pull on a full sync. Defaults to 90.',
      placeholder: '90',
    }),
    resources: z
      .array(z.enum(['email_stats', 'bounces', 'spam_reports']))
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          'Which SendGrid resources to sync. Omit to sync all of them.',
      }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'SendGrid',
  category: 'marketing',
  brandColor: '#1A82E2',
  tagline:
    'Sync daily SendGrid email stats (sends, delivery rate, bounce rate, spam complaints, opens, clicks) plus bounce and spam-report events for transactional-email dashboards.',
  vendor: {
    name: 'SendGrid',
    domain: 'sendgrid.com',
    apiDocs: 'https://docs.sendgrid.com/api-reference/',
    website: 'https://sendgrid.com',
  },
  auth: {
    summary: 'A SendGrid Web API v3 key sent as a bearer token.',
    setup: [
      'In SendGrid, open Settings -> API Keys and create a new API key.',
      'Grant it at least read access to Stats and Suppressions (Restricted Access -> Stats: Read, Suppressions: Read), or use a Full Access key.',
      'Store the key as a rawdash secret and reference it from config as `apiKey: secret("SENDGRID_API_KEY")`.',
    ],
  },
  rateLimit:
    'SendGrid returns X-RateLimit-Remaining / X-RateLimit-Reset response headers; the shared HTTP client backs off on 429 using the standard rate-limit policy.',
  limitations: [
    'Email stats are a daily aggregate series: each sync clears the metric scope and rewrites the requested window, so incremental syncs only refresh the trailing window (default 2 days) while full syncs repopulate the whole backfill window.',
    'Category-level stats require the categories to be listed in config; SendGrid has no "all categories" stats call.',
    'Bounce and spam-report events are read from the Suppressions API and are limited to addresses still present in the suppression lists; entries removed from SendGrid are not retained.',
  ],
});

export type SendgridResource = 'email_stats' | 'bounces' | 'spam_reports';

export interface SendgridSettings {
  categories?: readonly string[];
  backfillDays?: number;
  resources?: readonly SendgridResource[];
}

const sendgridCredentials = {
  apiKey: {
    description: 'SendGrid Web API v3 key',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type SendgridCredentials = typeof sendgridCredentials;

const sendgridRateLimit = standardRateLimitPolicy({
  remainingHeader: 'x-ratelimit-remaining',
  resetHeader: 'x-ratelimit-reset',
  resetUnit: 's',
});

const PHASE_ORDER = ['email_stats', 'bounces', 'spam_reports'] as const;

type SendgridPhase = (typeof PHASE_ORDER)[number];

type SendgridSyncCursor = ChunkedSyncCursor<SendgridPhase, string>;

const isSendgridSyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

const EMAIL_STATS_METRIC = 'sendgrid_email_stats';
const BOUNCE_EVENT = 'sendgrid_bounce';
const SPAM_REPORT_EVENT = 'sendgrid_spam_report';

const BASE_URL = 'https://api.sendgrid.com/v3';
const SUPPRESSION_PAGE_SIZE = 500;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_BACKFILL_DAYS = 90;
const INCREMENTAL_LOOKBACK_DAYS = 2;
const GLOBAL_CATEGORY = 'all';

const statMetricsSchema = z.object({
  blocks: z.number().nullish(),
  bounce_drops: z.number().nullish(),
  bounces: z.number().nullish(),
  clicks: z.number().nullish(),
  deferred: z.number().nullish(),
  delivered: z.number().nullish(),
  invalid_emails: z.number().nullish(),
  opens: z.number().nullish(),
  processed: z.number().nullish(),
  requests: z.number().nullish(),
  spam_report_drops: z.number().nullish(),
  spam_reports: z.number().nullish(),
  unique_clicks: z.number().nullish(),
  unique_opens: z.number().nullish(),
  unsubscribe_drops: z.number().nullish(),
  unsubscribes: z.number().nullish(),
});

const statEntrySchema = z.object({
  type: z.string().nullish(),
  name: z.string().nullish(),
  metrics: statMetricsSchema.nullish(),
});

const statsDaySchema = z.object({
  date: z.string(),
  stats: z.array(statEntrySchema).nullish(),
});

const statsResponseSchema = z.array(statsDaySchema);

const bounceSchema = z.object({
  created: z.number(),
  email: z.string(),
  reason: z.string().nullish(),
  status: z.string().nullish(),
});

const bouncesResponseSchema = z.array(bounceSchema);

const spamReportSchema = z.object({
  created: z.number(),
  email: z.string(),
  ip: z.string().nullish(),
});

const spamReportsResponseSchema = z.array(spamReportSchema);

export const sendgridResources = defineResources({
  [EMAIL_STATS_METRIC]: {
    shape: 'metric',
    description:
      'Daily email engagement stats (requests, delivered, bounces, spam reports, opens, clicks, unsubscribes) from the SendGrid Stats API, one sample per (day, category). The sample value is the number of requests (sends); every other counter is exposed as an attribute.',
    endpoint: 'GET /stats',
    unit: 'emails',
    granularity: '1d',
    notes:
      'Aggregated by day. The metric scope is cleared and rewritten on every sync because aggregate daily stats cannot be upserted by key. When categories are configured the Category Stats endpoint (GET /categories/stats) is used instead and the category dimension carries the category name.',
    dimensions: [
      {
        name: 'category',
        description:
          'SendGrid category, or "all" for account-wide global stats.',
      },
      { name: 'requests', description: 'Emails requested (sends).' },
      { name: 'delivered', description: 'Emails delivered.' },
      { name: 'bounces', description: 'Bounced emails.' },
      {
        name: 'bounceDrops',
        description: 'Emails dropped due to prior bounces.',
      },
      { name: 'blocks', description: 'Blocked emails.' },
      { name: 'deferred', description: 'Temporarily deferred emails.' },
      { name: 'invalidEmails', description: 'Invalid recipient addresses.' },
      { name: 'processed', description: 'Emails processed.' },
      { name: 'opens', description: 'Total opens.' },
      { name: 'uniqueOpens', description: 'Unique opens.' },
      { name: 'clicks', description: 'Total clicks.' },
      { name: 'uniqueClicks', description: 'Unique clicks.' },
      { name: 'spamReports', description: 'Spam complaints.' },
      {
        name: 'spamReportDrops',
        description: 'Emails dropped due to prior spam reports.',
      },
      { name: 'unsubscribes', description: 'Unsubscribes.' },
      {
        name: 'unsubscribeDrops',
        description: 'Emails dropped due to prior unsubscribes.',
      },
    ],
    responses: { email_stats: statsResponseSchema },
  },
  [BOUNCE_EVENT]: {
    shape: 'event',
    filterable: [],
    description:
      'Bounce events from the SendGrid Suppressions API. One event per bounced address, timestamped at the bounce time.',
    endpoint: 'GET /suppression/bounces',
    notes:
      'Paginated via limit / offset over the [start_time, end_time] window. Incremental syncs pull from the last sync time forward.',
    fields: [
      { name: 'email', description: 'Recipient address that bounced.' },
      {
        name: 'reason',
        description: 'Reason reported by the receiving server.',
      },
      { name: 'status', description: 'SMTP status code for the bounce.' },
    ],
    responses: { bounces: bouncesResponseSchema },
  },
  [SPAM_REPORT_EVENT]: {
    shape: 'event',
    filterable: [],
    description:
      'Spam-report (complaint) events from the SendGrid Suppressions API. One event per complaining address, timestamped at the report time.',
    endpoint: 'GET /suppression/spam_reports',
    notes:
      'Paginated via limit / offset over the [start_time, end_time] window. Incremental syncs pull from the last sync time forward.',
    fields: [
      { name: 'email', description: 'Recipient address that reported spam.' },
      {
        name: 'ip',
        description: 'Sending IP the complaint was attributed to.',
      },
    ],
    responses: { spam_reports: spamReportsResponseSchema },
  },
});

export const id = 'sendgrid';

type StatsResponse = z.infer<typeof statsResponseSchema>;
type StatsDay = z.infer<typeof statsDaySchema>;
type Bounce = z.infer<typeof bounceSchema>;
type SpamReport = z.infer<typeof spamReportSchema>;

interface StatsDateRange {
  startDate: string;
  endDate: string;
}

interface SuppressionWindow {
  startTime: number;
  endTime: number;
}

function toYmd(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function ymdToMs(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) {
    return null;
  }
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(ms) ? ms : null;
}

function counterValue(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function offsetFromPage(page: string | null): number {
  if (page === null) {
    return 0;
  }
  const n = Number(page);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export class SendgridConnector extends BaseConnector<
  SendgridSettings,
  SendgridCredentials
> {
  static readonly id = id;

  static readonly resources = sendgridResources;

  static readonly schemas = schemasFromResources(sendgridResources);

  static create(input: unknown, ctx?: ConnectorContext): SendgridConnector {
    const parsed = configFields.parse(input);
    return new SendgridConnector(
      {
        categories: parsed.categories,
        backfillDays: parsed.backfillDays,
        resources: parsed.resources,
      },
      { apiKey: parsed.apiKey },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = sendgridCredentials;

  private get backfillDays(): number {
    return this.settings.backfillDays ?? DEFAULT_BACKFILL_DAYS;
  }

  private buildHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.creds.apiKey}`,
      Accept: 'application/json',
      'User-Agent': connectorUserAgent('sendgrid'),
    };
  }

  private async apiGet<T>(
    url: string,
    resource: string,
    signal?: AbortSignal,
  ): Promise<HttpResponse<T>> {
    return this.get<T>(url, {
      resource,
      headers: this.buildHeaders(),
      rateLimit: sendgridRateLimit,
      signal,
    });
  }

  private statsDateRange(options: SyncOptions): StatsDateRange {
    const now = Date.now();
    const endDate = toYmd(now);
    if (options.mode === 'latest') {
      const startMs = now - (INCREMENTAL_LOOKBACK_DAYS - 1) * MS_PER_DAY;
      return { startDate: toYmd(startMs), endDate };
    }
    if (options.since) {
      const sinceMs = Date.parse(options.since);
      if (Number.isFinite(sinceMs)) {
        const days = Math.max(1, Math.ceil((now - sinceMs) / MS_PER_DAY));
        const capped = Math.min(days, this.backfillDays);
        const startMs = now - (capped - 1) * MS_PER_DAY;
        return { startDate: toYmd(startMs), endDate };
      }
    }
    const startMs = now - (this.backfillDays - 1) * MS_PER_DAY;
    return { startDate: toYmd(startMs), endDate };
  }

  private suppressionWindow(options: SyncOptions): SuppressionWindow {
    const nowSec = Math.floor(Date.now() / 1000);
    if (options.mode !== 'full' && options.since) {
      const sinceMs = Date.parse(options.since);
      if (Number.isFinite(sinceMs)) {
        return { startTime: Math.floor(sinceMs / 1000), endTime: nowSec };
      }
    }
    return {
      startTime: nowSec - this.backfillDays * 24 * 60 * 60,
      endTime: nowSec,
    };
  }

  private buildStatsUrl(range: StatsDateRange): string {
    const useCategories =
      this.settings.categories && this.settings.categories.length > 0;
    const u = new URL(
      `${BASE_URL}${useCategories ? '/categories/stats' : '/stats'}`,
    );
    u.searchParams.set('start_date', range.startDate);
    u.searchParams.set('end_date', range.endDate);
    u.searchParams.set('aggregated_by', 'day');
    if (useCategories) {
      for (const category of this.settings.categories!) {
        u.searchParams.append('categories', category);
      }
    }
    return u.toString();
  }

  private buildSuppressionUrl(
    path: string,
    window: SuppressionWindow,
    offset: number,
  ): string {
    const u = new URL(`${BASE_URL}${path}`);
    u.searchParams.set('start_time', String(window.startTime));
    u.searchParams.set('end_time', String(window.endTime));
    u.searchParams.set('limit', String(SUPPRESSION_PAGE_SIZE));
    u.searchParams.set('offset', String(offset));
    return u.toString();
  }

  private async fetchStats(
    page: string | null,
    options: SyncOptions,
    signal?: AbortSignal,
  ): Promise<{ items: StatsDay[]; next: string | null }> {
    if (page !== null) {
      return { items: [], next: null };
    }
    const url = this.buildStatsUrl(this.statsDateRange(options));
    const res = await this.apiGet<StatsResponse>(url, 'email_stats', signal);
    return { items: res.body, next: null };
  }

  private async fetchSuppressionPage<T>(
    path: string,
    resource: string,
    page: string | null,
    window: SuppressionWindow,
    signal?: AbortSignal,
  ): Promise<{ items: T[]; next: string | null }> {
    const offset = offsetFromPage(page);
    const url = this.buildSuppressionUrl(path, window, offset);
    const res = await this.apiGet<T[]>(url, resource, signal);
    const items = res.body;
    const next =
      items.length < SUPPRESSION_PAGE_SIZE
        ? null
        : String(offset + SUPPRESSION_PAGE_SIZE);
    return { items, next };
  }

  private async writeEmailStats(
    storage: StorageHandle,
    items: StatsDay[],
  ): Promise<void> {
    const samples: Array<{
      name: string;
      ts: number;
      value: number;
      attributes: Record<string, JSONValue>;
    }> = [];
    for (const day of items) {
      const ts = ymdToMs(day.date);
      if (ts === null) {
        continue;
      }
      for (const entry of day.stats ?? []) {
        const metrics = entry.metrics ?? {};
        const category = entry.name ?? GLOBAL_CATEGORY;
        samples.push({
          name: EMAIL_STATS_METRIC,
          ts,
          value: counterValue(metrics.requests),
          attributes: {
            category,
            requests: counterValue(metrics.requests),
            delivered: counterValue(metrics.delivered),
            bounces: counterValue(metrics.bounces),
            bounceDrops: counterValue(metrics.bounce_drops),
            blocks: counterValue(metrics.blocks),
            deferred: counterValue(metrics.deferred),
            invalidEmails: counterValue(metrics.invalid_emails),
            processed: counterValue(metrics.processed),
            opens: counterValue(metrics.opens),
            uniqueOpens: counterValue(metrics.unique_opens),
            clicks: counterValue(metrics.clicks),
            uniqueClicks: counterValue(metrics.unique_clicks),
            spamReports: counterValue(metrics.spam_reports),
            spamReportDrops: counterValue(metrics.spam_report_drops),
            unsubscribes: counterValue(metrics.unsubscribes),
            unsubscribeDrops: counterValue(metrics.unsubscribe_drops),
          },
        });
      }
    }
    await storage.metrics(samples, { names: [EMAIL_STATS_METRIC] });
  }

  private async writeBounces(
    storage: StorageHandle,
    items: Bounce[],
  ): Promise<void> {
    for (const bounce of items) {
      const ts = parseEpoch(bounce.created, 's');
      if (ts === null) {
        continue;
      }
      await storage.event({
        name: BOUNCE_EVENT,
        start_ts: ts,
        end_ts: null,
        attributes: {
          email: bounce.email,
          reason: bounce.reason ?? null,
          status: bounce.status ?? null,
        },
      });
    }
  }

  private async writeSpamReports(
    storage: StorageHandle,
    items: SpamReport[],
  ): Promise<void> {
    for (const report of items) {
      const ts = parseEpoch(report.created, 's');
      if (ts === null) {
        continue;
      }
      await storage.event({
        name: SPAM_REPORT_EVENT,
        start_ts: ts,
        end_ts: null,
        attributes: {
          email: report.email,
          ip: report.ip ?? null,
        },
      });
    }
  }

  private async clearScopeOnFirstPage(
    storage: StorageHandle,
    phase: SendgridPhase,
    isFull: boolean,
  ): Promise<void> {
    switch (phase) {
      case 'email_stats':
        return;
      case 'bounces':
        if (isFull) {
          await storage.events([], { names: [BOUNCE_EVENT] });
        }
        return;
      case 'spam_reports':
        if (isFull) {
          await storage.events([], { names: [SPAM_REPORT_EVENT] });
        }
        return;
    }
  }

  private async writePhase(
    storage: StorageHandle,
    phase: SendgridPhase,
    items: unknown[],
  ): Promise<void> {
    switch (phase) {
      case 'email_stats':
        return this.writeEmailStats(storage, items as StatsDay[]);
      case 'bounces':
        return this.writeBounces(storage, items as Bounce[]);
      case 'spam_reports':
        return this.writeSpamReports(storage, items as SpamReport[]);
    }
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const cursor: SendgridSyncCursor | undefined = isSendgridSyncCursor(
      options.cursor,
    )
      ? options.cursor
      : undefined;
    const isFull = options.mode === 'full';

    const phases = selectActivePhases<SendgridResource, SendgridPhase>(
      (r) => r,
      PHASE_ORDER,
      this.settings.resources,
    );

    const window = this.suppressionWindow(options);

    return paginateChunked<SendgridPhase, string>({
      phases,
      cursor,
      signal,
      logger: this.logger,
      fetchPage: async (phase, page, sig) => {
        switch (phase) {
          case 'email_stats':
            return this.fetchStats(page, options, sig);
          case 'bounces':
            return this.fetchSuppressionPage<Bounce>(
              '/suppression/bounces',
              'bounces',
              page,
              window,
              sig,
            );
          case 'spam_reports':
            return this.fetchSuppressionPage<SpamReport>(
              '/suppression/spam_reports',
              'spam_reports',
              page,
              window,
              sig,
            );
        }
      },
      writeBatch: async (phase, items, page) => {
        if (page === null) {
          await this.clearScopeOnFirstPage(storage, phase, isFull);
        }
        await this.writePhase(storage, phase, items);
      },
    });
  }
}
