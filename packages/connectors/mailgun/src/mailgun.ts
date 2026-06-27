import { connectorUserAgent, parseEpoch } from '@rawdash/connector-shared';
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
  metricSample,
  paginateChunked,
  schemasFromResources,
  selectActivePhases,
} from '@rawdash/core';
import { z } from 'zod';

export const configFields = defineConfigFields(
  z.object({
    apiKey: z.object({ $secret: z.string() }).meta({
      label: 'API key',
      description:
        'A Mailgun API key with read access to analytics. Create one in the Mailgun dashboard under Settings -> API Keys.',
      placeholder: 'key-...',
      secret: true,
    }),
    domain: z.string().trim().min(1, 'A sending domain is required').meta({
      label: 'Sending domain',
      description:
        'The Mailgun sending domain to report on (e.g. mg.example.com). Metrics and logs are filtered to this domain.',
      placeholder: 'mg.example.com',
    }),
    region: z.enum(['us', 'eu']).default('us').meta({
      label: 'Region',
      description:
        "Which Mailgun region hosts the domain. 'us' uses api.mailgun.net; 'eu' uses api.eu.mailgun.net.",
      placeholder: 'us',
    }),
    lookbackDays: z.number().int().positive().optional().meta({
      label: 'Lookback days (full sync)',
      description:
        'How many calendar days of stats/events to fetch on a full sync. Defaults to 90.',
      placeholder: '90',
    }),
    resources: z
      .array(z.enum(['email_stats', 'events']))
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          'Which Mailgun resources to sync. Omit to sync all of them.',
      }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'Mailgun',
  category: 'engineering',
  brandColor: '#F06B66',
  tagline:
    'Sync transactional email volume, delivery, bounce, and complaint metrics plus recent delivery events from Mailgun.',
  vendor: {
    name: 'Mailgun',
    domain: 'mailgun.com',
    apiDocs: 'https://documentation.mailgun.com/docs/mailgun/api-reference/',
    website: 'https://www.mailgun.com',
  },
  auth: {
    summary:
      'A Mailgun API key with read access to analytics, sent via HTTP basic auth (username `api`, password is the key).',
    setup: [
      'In the Mailgun dashboard open Settings -> API Keys and create or copy an API key with analytics read access.',
      'Note which region hosts your domain (US or EU); set the connector `region` accordingly.',
      'Store the key as a secret and reference it from the connector config as `apiKey: secret("MAILGUN_API_KEY")`, and set `domain` to the sending domain you want to report on.',
    ],
  },
  rateLimit:
    'Mailgun applies per-endpoint rate limits and returns 429 with a Retry-After header when exceeded; the shared HTTP client backs off and retries automatically.',
  limitations: [
    'Metrics are reported at daily resolution; the connector requests `resolution=day` from the analytics API.',
    'Incremental syncs re-fetch a fixed trailing window and replace only that window, so older samples are preserved.',
    'The events resource stores a bounded sample of the most recent delivery logs (Mailgun retains log data for a limited period), not a complete event archive.',
  ],
});

export interface MailgunSettings {
  domain: string;
  region: 'us' | 'eu';
  lookbackDays?: number;
  resources?: readonly MailgunResource[];
}

const mailgunCredentials = {
  apiKey: {
    description: 'Mailgun API key',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type MailgunCredentials = typeof mailgunCredentials;

const PHASE_ORDER = ['email_stats', 'events'] as const;

type MailgunPhase = (typeof PHASE_ORDER)[number];

export type MailgunResource = MailgunPhase;

type MailgunSyncCursor = ChunkedSyncCursor<MailgunPhase, string>;

const isMailgunSyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_LOOKBACK_DAYS = 90;
const INCREMENTAL_LOOKBACK_DAYS = 7;
const METRICS_PAGE_LIMIT = 1000;
const EVENTS_PAGE_LIMIT = 300;
const MAX_EVENT_PAGES = 20;

const EMAIL_STATS_METRIC = 'mailgun_email_stats';
const MAILGUN_EVENT = 'mailgun_event';

const METRIC_FIELDS = [
  'accepted_count',
  'delivered_count',
  'failed_count',
  'opened_count',
  'clicked_count',
  'unsubscribed_count',
  'complained_count',
] as const;

const EVENT_TYPES = [
  'accepted',
  'delivered',
  'failed',
  'opened',
  'clicked',
  'unsubscribed',
  'complained',
] as const;

const metricsDimensionSchema = z.object({
  dimension: z.string(),
  value: z.string(),
  display_value: z.string().nullish(),
});

const metricsItemSchema = z.object({
  dimensions: z.array(metricsDimensionSchema),
  metrics: z.object({
    accepted_count: z.number().nullish(),
    delivered_count: z.number().nullish(),
    failed_count: z.number().nullish(),
    opened_count: z.number().nullish(),
    clicked_count: z.number().nullish(),
    unsubscribed_count: z.number().nullish(),
    complained_count: z.number().nullish(),
  }),
});

const metricsResponseSchema = z.object({
  items: z.array(metricsItemSchema),
  pagination: z
    .object({
      skip: z.number().nullish(),
      limit: z.number().nullish(),
      total: z.number().nullish(),
    })
    .nullish(),
});

const logsItemSchema = z.object({
  id: z.string(),
  event: z.string(),
  '@timestamp': z.string(),
  recipient: z.string().nullish(),
  'recipient-domain': z.string().nullish(),
  severity: z.string().nullish(),
  reason: z.string().nullish(),
});

const logsResponseSchema = z.object({
  items: z.array(logsItemSchema),
  pagination: z
    .object({
      next: z.string().nullish(),
      previous: z.string().nullish(),
      total: z.number().nullish(),
    })
    .nullish(),
});

export const mailgunResources = defineResources({
  [EMAIL_STATS_METRIC]: {
    shape: 'metric',
    description:
      'Daily transactional email volume and engagement for the configured domain. The canonical value is `accepted` (messages accepted for sending); delivery, failure, and engagement counts are carried as measures.',
    endpoint: 'POST /v1/analytics/metrics',
    unit: 'emails',
    granularity: 'day',
    dimensions: [
      { name: 'date', description: 'Calendar day of the metric sample (UTC).' },
      { name: 'domain', description: 'The Mailgun sending domain.' },
    ],
    measures: [
      { name: 'delivered', description: 'Messages delivered on the day.' },
      {
        name: 'failed',
        description: 'Messages that failed (bounced/dropped).',
      },
      { name: 'opened', description: 'Message opens recorded on the day.' },
      { name: 'clicked', description: 'Link clicks recorded on the day.' },
      {
        name: 'unsubscribed',
        description: 'Unsubscribes recorded on the day.',
      },
      {
        name: 'complained',
        description: 'Spam complaints recorded on the day.',
      },
    ],
    responses: { email_stats: metricsResponseSchema },
  },
  [MAILGUN_EVENT]: {
    shape: 'event',
    description:
      'Recent per-message delivery events (accepted, delivered, failed, opened, clicked, unsubscribed, complained) for the configured domain. Deduplicated by Mailgun event id.',
    endpoint: 'POST /v1/analytics/logs',
    notes:
      'A bounded sample of the most recent logs is stored; Mailgun retains log data for a limited period.',
    fields: [
      { name: 'eventId', description: 'Mailgun event id (stable per event).' },
      {
        name: 'eventType',
        description:
          'Event type (accepted, delivered, failed, opened, clicked, unsubscribed, complained).',
      },
      { name: 'recipient', description: 'Recipient email address.' },
      { name: 'domain', description: 'The Mailgun sending domain.' },
      { name: 'severity', description: 'Failure severity, when present.' },
      { name: 'reason', description: 'Failure reason, when present.' },
    ],
    filterable: [],
    responses: { events: logsResponseSchema },
  },
});

export type MailgunMetricsItem = z.infer<typeof metricsItemSchema>;
export type MailgunLogsItem = z.infer<typeof logsItemSchema>;

export interface MailgunWindow {
  startMs: number;
  endMs: number;
}

function startOfUtcDay(ms: number): number {
  return Math.floor(ms / MS_PER_DAY) * MS_PER_DAY;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toIsoDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function getWindow(
  options: SyncOptions,
  lookbackDays: number,
  now: number = Date.now(),
): MailgunWindow {
  const endMs = startOfUtcDay(now) + MS_PER_DAY - 1;
  const today = startOfUtcDay(now);
  if (options.mode === 'latest') {
    return {
      startMs: today - (INCREMENTAL_LOOKBACK_DAYS - 1) * MS_PER_DAY,
      endMs,
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
      return { startMs: today - (capped - 1) * MS_PER_DAY, endMs };
    }
  }
  return { startMs: today - (lookbackDays - 1) * MS_PER_DAY, endMs };
}

function toNumber(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function timeDimensionValue(item: MailgunMetricsItem): string | null {
  const timeDim =
    item.dimensions.find((d) => d.dimension === 'time') ?? item.dimensions[0];
  return timeDim ? timeDim.value : null;
}

export function metricsItemToSample(
  item: MailgunMetricsItem,
  domain: string,
): MetricSample {
  const raw = timeDimensionValue(item);
  const parsed = raw ? parseEpoch(raw, 'iso') : null;
  const ts = parsed ?? (raw ? Date.parse(raw) : NaN);
  const tsMs = Number.isFinite(ts) ? ts : 0;
  const date = Number.isFinite(ts) ? toIsoDate(tsMs) : (raw ?? '');
  const m = item.metrics;
  return metricSample(mailgunResources, EMAIL_STATS_METRIC, {
    ts: tsMs,
    value: toNumber(m.accepted_count),
    attributes: {
      date,
      domain,
      delivered: toNumber(m.delivered_count),
      failed: toNumber(m.failed_count),
      opened: toNumber(m.opened_count),
      clicked: toNumber(m.clicked_count),
      unsubscribed: toNumber(m.unsubscribed_count),
      complained: toNumber(m.complained_count),
    },
  });
}

export function logsItemToEvent(item: MailgunLogsItem, domain: string): Event {
  const parsed = parseEpoch(item['@timestamp'], 'iso');
  const ts = parsed ?? Date.parse(item['@timestamp']);
  const startTs = Number.isFinite(ts) ? ts : 0;
  return {
    name: MAILGUN_EVENT,
    start_ts: startTs,
    end_ts: startTs,
    attributes: {
      eventId: item.id,
      eventType: item.event,
      recipient: item.recipient ?? null,
      domain,
      severity: item.severity ?? null,
      reason: item.reason ?? null,
    },
  };
}

export const id = 'mailgun';

export class MailgunConnector extends BaseConnector<
  MailgunSettings,
  MailgunCredentials
> {
  static readonly id = id;

  static readonly resources = mailgunResources;

  static readonly schemas = schemasFromResources(mailgunResources);

  static create(input: unknown, ctx?: ConnectorContext): MailgunConnector {
    const parsed = configFields.parse(input);
    return new MailgunConnector(
      {
        domain: parsed.domain,
        region: parsed.region,
        lookbackDays: parsed.lookbackDays,
        resources: parsed.resources,
      },
      { apiKey: parsed.apiKey },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = mailgunCredentials;

  private baseUrl(): string {
    return this.settings.region === 'eu'
      ? 'https://api.eu.mailgun.net'
      : 'https://api.mailgun.net';
  }

  private buildHeaders(): Record<string, string> {
    const token = btoa(`api:${this.creds.apiKey}`);
    return {
      Authorization: `Basic ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': connectorUserAgent('mailgun'),
    };
  }

  private domainFilter(): Record<string, unknown> {
    return {
      AND: [
        {
          attribute: 'domain',
          comparator: '=',
          values: [
            { label: this.settings.domain, value: this.settings.domain },
          ],
        },
      ],
    };
  }

  private async fetchMetricItems(
    window: MailgunWindow,
    signal?: AbortSignal,
  ): Promise<MailgunMetricsItem[]> {
    const url = `${this.baseUrl()}/v1/analytics/metrics`;
    const start = new Date(window.startMs).toUTCString();
    const end = new Date(window.endMs).toUTCString();
    const items: MailgunMetricsItem[] = [];
    let skip = 0;
    for (;;) {
      const body = JSON.stringify({
        start,
        end,
        resolution: 'day',
        dimensions: ['time'],
        metrics: METRIC_FIELDS,
        filter: this.domainFilter(),
        include_subaccounts: false,
        include_aggregates: false,
        skip,
        limit: METRICS_PAGE_LIMIT,
      });
      const res = await this.post<z.infer<typeof metricsResponseSchema>>(url, {
        resource: 'email_stats',
        headers: this.buildHeaders(),
        body,
        signal,
      });
      const page = res.body.items ?? [];
      items.push(...page);
      const total = res.body.pagination?.total ?? null;
      skip += page.length;
      if (page.length < METRICS_PAGE_LIMIT) {
        break;
      }
      if (total !== null && skip >= total) {
        break;
      }
    }
    return items;
  }

  private async fetchLogItems(
    window: MailgunWindow,
    signal?: AbortSignal,
  ): Promise<MailgunLogsItem[]> {
    const url = `${this.baseUrl()}/v1/analytics/logs`;
    const start = new Date(window.startMs).toUTCString();
    const end = new Date(window.endMs).toUTCString();
    const byId = new Map<string, MailgunLogsItem>();
    const seenTokens = new Set<string>();
    let token: string | null = null;
    for (let page = 0; page < MAX_EVENT_PAGES; page++) {
      const body: string = JSON.stringify(
        token
          ? { pagination: { token, limit: EVENTS_PAGE_LIMIT } }
          : {
              start,
              end,
              events: EVENT_TYPES,
              filter: this.domainFilter(),
              include_subaccounts: false,
              pagination: { sort: 'timestamp:asc', limit: EVENTS_PAGE_LIMIT },
            },
      );
      const res = await this.post<z.infer<typeof logsResponseSchema>>(url, {
        resource: 'events',
        headers: this.buildHeaders(),
        body,
        signal,
      });
      for (const item of res.body.items ?? []) {
        byId.set(item.id, item);
      }
      const next: string | null = res.body.pagination?.next ?? null;
      if (
        !next ||
        seenTokens.has(next) ||
        (res.body.items ?? []).length === 0
      ) {
        break;
      }
      seenTokens.add(next);
      token = next;
    }
    return Array.from(byId.values());
  }

  private async writePhase(
    storage: StorageHandle,
    phase: MailgunPhase,
    window: MailgunWindow,
    signal?: AbortSignal,
  ): Promise<void> {
    if (phase === 'email_stats') {
      const items = await this.fetchMetricItems(window, signal);
      const samples = items.map((item) =>
        metricsItemToSample(item, this.settings.domain),
      );
      await storage.metrics(samples, {
        names: [EMAIL_STATS_METRIC],
        replaceWindow: { start: window.startMs, end: window.endMs },
      });
      return;
    }
    const items = await this.fetchLogItems(window, signal);
    const events = items.map((item) =>
      logsItemToEvent(item, this.settings.domain),
    );
    await storage.events(events, { names: [MAILGUN_EVENT] });
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const cursor: MailgunSyncCursor | undefined = isMailgunSyncCursor(
      options.cursor,
    )
      ? options.cursor
      : undefined;
    const lookbackDays = this.settings.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
    const window = getWindow(options, lookbackDays);

    const phases = selectActivePhases<MailgunResource, MailgunPhase>(
      (r) => r,
      PHASE_ORDER,
      this.settings.resources,
    );

    return paginateChunked<MailgunPhase, string>({
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
