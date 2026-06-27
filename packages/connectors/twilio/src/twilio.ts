import {
  type HttpResponse,
  connectorUserAgent,
  parseEpoch,
  sanitizeAllowedUrl,
} from '@rawdash/connector-shared';
import {
  BaseConnector,
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

const TWILIO_API_HOST = 'api.twilio.com';
const TWILIO_API_BASE = `https://${TWILIO_API_HOST}`;
const API_VERSION = '2010-04-01';
const PAGE_SIZE = 1000;
const MS_PER_DAY = 86_400_000;
const DEFAULT_LOOKBACK_DAYS = 30;
const INCREMENTAL_LOOKBACK_DAYS = 2;

export const configFields = defineConfigFields(
  z.object({
    accountSid: z.string().min(1).meta({
      label: 'Account SID',
      description:
        'Twilio Account SID (starts with AC). Found on the Twilio Console dashboard. Used as the Basic auth username and in every request path.',
      placeholder: 'AC...',
    }),
    authToken: z.object({ $secret: z.string().min(1) }).meta({
      label: 'Auth token',
      description:
        'Twilio Auth token for the account, used as the Basic auth password.',
      placeholder: 'TWILIO_AUTH_TOKEN',
      secret: true,
    }),
    resources: z
      .array(
        z.enum([
          'twilio_message',
          'twilio_call',
          'twilio_usage_count',
          'twilio_usage_price',
        ]),
      )
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          'Which Twilio resources to sync. Omit to sync all of them. The two usage metrics share one upstream call to the daily Usage Records report.',
      }),
    lookbackDays: z.number().int().positive().max(365).optional().meta({
      label: 'Backfill window (days)',
      description:
        'How many days of usage history to fetch on a full sync. Defaults to 30. Message and call backfill is bounded by the same window.',
      placeholder: '30',
    }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'Twilio',
  category: 'engineering',
  brandColor: '#F22F46',
  tagline:
    'Track SMS and voice volume, delivery and error rates, and per-category spend from the Twilio REST API.',
  vendor: {
    name: 'Twilio',
    domain: 'twilio.com',
    apiDocs: 'https://www.twilio.com/docs/usage/api',
    website: 'https://twilio.com',
  },
  auth: {
    summary:
      'Authenticates over HTTP Basic auth using the Twilio Account SID as the username and the Auth token as the password. Read access to messages, calls, and usage records is sufficient.',
    setup: [
      'Open the Twilio Console dashboard and copy your Account SID (starts with AC).',
      'Copy the Auth token shown next to it.',
      'Store the token as a secret (e.g. TWILIO_AUTH_TOKEN).',
      'Reference it from config as `authToken: secret("TWILIO_AUTH_TOKEN")` alongside `accountSid: "AC..."`.',
    ],
  },
  rateLimit:
    'Twilio returns 429 with a Retry-After header when the per-account concurrency budget is exceeded; the shared HTTP client honors it. List endpoints paginate via a relative next_page_uri with a configurable PageSize (capped at 1000 here).',
  limitations: [
    'Monetary amounts (message/call price, usage price) are reported by Twilio as negative-signed decimal strings; the connector stores their absolute value as a positive number.',
    'Message and call events are bounded by the backfill window; very high-volume accounts should sync the usage metrics rather than per-message events for spend and volume trends.',
    'Usage is read from the daily Usage Records report (1-day granularity); sub-daily usage is not exposed.',
  ],
});

const PHASE_ORDER = ['messages', 'calls', 'usage'] as const;

type TwilioPhase = (typeof PHASE_ORDER)[number];

export type TwilioResource =
  | 'twilio_message'
  | 'twilio_call'
  | 'twilio_usage_count'
  | 'twilio_usage_price';

const isTwilioSyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

const RESOURCES_BY_PHASE: Record<TwilioPhase, readonly TwilioResource[]> = {
  messages: ['twilio_message'],
  calls: ['twilio_call'],
  usage: ['twilio_usage_count', 'twilio_usage_price'],
};

const ENDPOINT_PATH: Record<TwilioPhase, string> = {
  messages: `/${API_VERSION}/Accounts/{sid}/Messages.json`,
  calls: `/${API_VERSION}/Accounts/{sid}/Calls.json`,
  usage: `/${API_VERSION}/Accounts/{sid}/Usage/Records/Daily.json`,
};

const messageSchema = z.object({
  sid: z.string().min(1),
  status: z.string().nullish(),
  error_code: z.number().int().nullish(),
  direction: z.string().nullish(),
  price: z.string().nullish(),
  price_unit: z.string().nullish(),
  date_sent: z.string().nullish(),
  date_created: z.string().nullish(),
  from: z.string().nullish(),
  to: z.string().nullish(),
  num_segments: z.string().nullish(),
  num_media: z.string().nullish(),
  messaging_service_sid: z.string().nullish(),
});

const callSchema = z.object({
  sid: z.string().min(1),
  status: z.string().nullish(),
  direction: z.string().nullish(),
  duration: z.string().nullish(),
  price: z.string().nullish(),
  price_unit: z.string().nullish(),
  start_time: z.string().nullish(),
  end_time: z.string().nullish(),
  date_created: z.string().nullish(),
  from: z.string().nullish(),
  to: z.string().nullish(),
});

const usageRecordSchema = z.object({
  category: z.string().min(1),
  description: z.string().nullish(),
  count: z.string().nullish(),
  count_unit: z.string().nullish(),
  usage: z.string().nullish(),
  usage_unit: z.string().nullish(),
  price: z.string().nullish(),
  price_unit: z.string().nullish(),
  start_date: z.string().nullish(),
  end_date: z.string().nullish(),
});

const messagesResponseSchema = z.object({
  messages: z.array(messageSchema),
  next_page_uri: z.string().nullish(),
});

const callsResponseSchema = z.object({
  calls: z.array(callSchema),
  next_page_uri: z.string().nullish(),
});

const usageResponseSchema = z.object({
  usage_records: z.array(usageRecordSchema),
  next_page_uri: z.string().nullish(),
});

type TwilioMessage = z.infer<typeof messageSchema>;
type TwilioCall = z.infer<typeof callSchema>;
type TwilioUsageRecord = z.infer<typeof usageRecordSchema>;

const USAGE_DIMENSIONS = [
  {
    name: 'category',
    description:
      'Twilio usage category (e.g. sms, sms-inbound, sms-outbound, calls, calls-inbound, calls-outbound, verify, whatsapp).',
  },
  {
    name: 'description',
    description: 'Human-readable label for the category, or null.',
  },
] as const;

export const twilioResources = defineResources({
  twilio_message: {
    shape: 'event',
    filterable: [],
    description:
      'SMS / MMS message attempts with status, error code, direction, and price, timestamped at the time the message was sent.',
    endpoint: 'GET /2010-04-01/Accounts/{AccountSid}/Messages.json',
    notes:
      'start_ts is date_sent when present, falling back to date_created. Messages whose timestamp cannot be parsed are skipped.',
    fields: [
      { name: 'sid', description: 'Twilio message SID.' },
      {
        name: 'status',
        description:
          'Delivery status (queued, sending, sent, delivered, undelivered, failed, received, ...).',
      },
      {
        name: 'errorCode',
        description: 'Twilio error code if the message failed, else null.',
      },
      {
        name: 'direction',
        description:
          'Message direction (inbound, outbound-api, outbound-call, outbound-reply).',
      },
      {
        name: 'price',
        description:
          'Absolute price charged for the message in priceUnit, or null if not yet priced.',
      },
      {
        name: 'priceUnit',
        description: 'ISO currency code for price, or null.',
      },
      { name: 'from', description: 'Sender address or number.' },
      { name: 'to', description: 'Recipient address or number.' },
      {
        name: 'numSegments',
        description: 'Number of message segments billed.',
      },
      { name: 'numMedia', description: 'Number of media attachments.' },
      {
        name: 'messagingServiceSid',
        description:
          'Messaging Service SID the message was sent through, or null.',
      },
    ],
    responses: { messages: messagesResponseSchema },
  },
  twilio_call: {
    shape: 'event',
    filterable: [],
    description:
      'Voice call attempts with status, direction, duration, and price, timestamped at the call start time.',
    endpoint: 'GET /2010-04-01/Accounts/{AccountSid}/Calls.json',
    notes:
      'start_ts is start_time when present, falling back to date_created. Calls whose timestamp cannot be parsed are skipped.',
    fields: [
      { name: 'sid', description: 'Twilio call SID.' },
      {
        name: 'status',
        description:
          'Call status (queued, ringing, in-progress, completed, busy, failed, no-answer, canceled).',
      },
      {
        name: 'direction',
        description: 'Call direction (inbound, outbound-api, outbound-dial).',
      },
      {
        name: 'duration',
        description: 'Call duration in seconds.',
        unit: 'seconds',
      },
      {
        name: 'price',
        description:
          'Absolute price charged for the call in priceUnit, or null if not yet priced.',
      },
      {
        name: 'priceUnit',
        description: 'ISO currency code for price, or null.',
      },
      { name: 'from', description: 'Caller number.' },
      { name: 'to', description: 'Callee number.' },
    ],
    responses: { calls: callsResponseSchema },
  },
  twilio_usage_count: {
    shape: 'metric',
    description:
      'Daily usage count per Twilio billing category, from the daily Usage Records report.',
    endpoint: 'GET /2010-04-01/Accounts/{AccountSid}/Usage/Records/Daily.json',
    unit: 'count',
    granularity: 'daily',
    dimensions: [...USAGE_DIMENSIONS],
    measures: [
      {
        name: 'usage',
        description:
          'Raw usage amount in the category usage_unit (may differ from count, e.g. seconds for voice).',
      },
    ],
    notes:
      'Sample value is the Usage Record count. Written from the same usage call as twilio_usage_price.',
    responses: { usage_records: usageResponseSchema },
  },
  twilio_usage_price: {
    shape: 'metric',
    description:
      'Daily spend per Twilio billing category, from the daily Usage Records report.',
    endpoint: 'GET /2010-04-01/Accounts/{AccountSid}/Usage/Records/Daily.json',
    unit: 'currency',
    granularity: 'daily',
    dimensions: [...USAGE_DIMENSIONS],
    notes:
      'Sample value is the absolute Usage Record price in priceUnit. Written alongside twilio_usage_count from one usage call.',
  },
});

export interface TwilioSettings {
  accountSid: string;
  resources?: readonly TwilioResource[];
  lookbackDays?: number;
}

const twilioCredentials = {
  authToken: {
    description: 'Twilio Auth token (Basic auth password)',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type TwilioCredentials = typeof twilioCredentials;

export const id = 'twilio';

function absNumber(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value.trim() === '') {
    return null;
  }
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? Math.abs(n) : null;
}

function intCount(value: string | null | undefined): number {
  if (value === null || value === undefined || value.trim() === '') {
    return 0;
  }
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

export function messageStartTs(message: TwilioMessage): number | null {
  return (
    parseEpoch(message.date_sent ?? null, 'iso') ??
    parseEpoch(message.date_created ?? null, 'iso')
  );
}

export function callStartTs(call: TwilioCall): number | null {
  return (
    parseEpoch(call.start_time ?? null, 'iso') ??
    parseEpoch(call.date_created ?? null, 'iso')
  );
}

export function buildMessageEvents(
  messages: readonly TwilioMessage[],
): Event[] {
  const events: Event[] = [];
  for (const m of messages) {
    const ts = messageStartTs(m);
    if (ts === null) {
      continue;
    }
    events.push({
      name: 'twilio_message',
      start_ts: ts,
      end_ts: null,
      attributes: {
        sid: m.sid,
        status: m.status ?? null,
        errorCode: m.error_code ?? null,
        direction: m.direction ?? null,
        price: absNumber(m.price),
        priceUnit: m.price_unit ?? null,
        from: m.from ?? null,
        to: m.to ?? null,
        numSegments: intCount(m.num_segments),
        numMedia: intCount(m.num_media),
        messagingServiceSid: m.messaging_service_sid ?? null,
      },
    });
  }
  return events;
}

export function buildCallEvents(calls: readonly TwilioCall[]): Event[] {
  const events: Event[] = [];
  for (const c of calls) {
    const ts = callStartTs(c);
    if (ts === null) {
      continue;
    }
    events.push({
      name: 'twilio_call',
      start_ts: ts,
      end_ts: null,
      attributes: {
        sid: c.sid,
        status: c.status ?? null,
        direction: c.direction ?? null,
        duration: intCount(c.duration),
        price: absNumber(c.price),
        priceUnit: c.price_unit ?? null,
        from: c.from ?? null,
        to: c.to ?? null,
      },
    });
  }
  return events;
}

export function buildUsageSamples(records: readonly TwilioUsageRecord[]): {
  counts: MetricSample[];
  prices: MetricSample[];
} {
  const counts: MetricSample[] = [];
  const prices: MetricSample[] = [];
  for (const r of records) {
    const ts = parseEpoch(r.start_date ?? null, 'iso');
    if (ts === null) {
      continue;
    }
    const dims = {
      category: r.category,
      description: r.description ?? null,
    };
    counts.push(
      metricSample(twilioResources, 'twilio_usage_count', {
        ts,
        value: intCount(r.count),
        attributes: { ...dims, usage: intCount(r.usage) },
      }),
    );
    prices.push(
      metricSample(twilioResources, 'twilio_usage_price', {
        ts,
        value: absNumber(r.price) ?? 0,
        attributes: { ...dims },
      }),
    );
  }
  return { counts, prices };
}

function resourceToPhase(resource: TwilioResource): TwilioPhase {
  for (const phase of PHASE_ORDER) {
    if ((RESOURCES_BY_PHASE[phase] as readonly string[]).includes(resource)) {
      return phase;
    }
  }
  throw new Error(`twilio: unmapped resource ${resource}`);
}

function toDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export class TwilioConnector extends BaseConnector<
  TwilioSettings,
  TwilioCredentials
> {
  static readonly id = id;

  static readonly resources = twilioResources;

  static readonly schemas = schemasFromResources(twilioResources);

  static create(input: unknown, ctx?: ConnectorContext): TwilioConnector {
    const parsed = configFields.parse(input);
    return new TwilioConnector(
      {
        accountSid: parsed.accountSid,
        resources: parsed.resources,
        lookbackDays: parsed.lookbackDays,
      },
      { authToken: parsed.authToken },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = twilioCredentials;

  private buildHeaders(): Record<string, string> {
    const basic = btoa(
      `${this.settings.accountSid}:${String(this.creds.authToken)}`,
    );
    return {
      Authorization: `Basic ${basic}`,
      Accept: 'application/json',
      'User-Agent': connectorUserAgent(this.id),
    };
  }

  private fetch<T>(
    url: string,
    resource: string,
    signal: AbortSignal | undefined,
  ): Promise<HttpResponse<T>> {
    return this.get<T>(url, {
      resource,
      headers: this.buildHeaders(),
      signal,
    });
  }

  private phasePath(phase: TwilioPhase): string {
    return ENDPOINT_PATH[phase].replace('{sid}', this.settings.accountSid);
  }

  private buildInitialUrl(
    phase: TwilioPhase,
    options: SyncOptions,
    lookbackDays: number,
    now: number,
  ): string {
    const url = new URL(`${TWILIO_API_BASE}${this.phasePath(phase)}`);
    url.searchParams.set('PageSize', String(PAGE_SIZE));
    if (phase === 'usage') {
      const days =
        options.mode === 'latest' ? INCREMENTAL_LOOKBACK_DAYS : lookbackDays;
      const sinceMs = options.since ? parseEpoch(options.since, 'iso') : null;
      const startMs =
        sinceMs !== null
          ? Math.min(sinceMs, now - INCREMENTAL_LOOKBACK_DAYS * MS_PER_DAY)
          : now - days * MS_PER_DAY;
      url.searchParams.set('StartDate', toDate(startMs));
      url.searchParams.set('EndDate', toDate(now));
      return url.toString();
    }
    const sinceMs = options.since
      ? parseEpoch(options.since, 'iso')
      : now - lookbackDays * MS_PER_DAY;
    if (sinceMs !== null) {
      const field = phase === 'messages' ? 'DateSent>' : 'StartTime>';
      url.searchParams.set(field, toDate(sinceMs));
    }
    return url.toString();
  }

  private nextUrl(
    phase: TwilioPhase,
    nextPageUri: string | null,
  ): string | null {
    if (!nextPageUri) {
      return null;
    }
    return sanitizeAllowedUrl({
      url: `${TWILIO_API_BASE}${nextPageUri}`,
      host: TWILIO_API_HOST,
      pathname: this.phasePath(phase),
    });
  }

  private async writePhase(
    storage: StorageHandle,
    phase: TwilioPhase,
    items: unknown[],
  ): Promise<void> {
    switch (phase) {
      case 'messages':
        await storage.events(buildMessageEvents(items as TwilioMessage[]), {
          names: ['twilio_message'],
        });
        return;
      case 'calls':
        await storage.events(buildCallEvents(items as TwilioCall[]), {
          names: ['twilio_call'],
        });
        return;
      case 'usage': {
        const { counts, prices } = buildUsageSamples(
          items as TwilioUsageRecord[],
        );
        await storage.metrics(counts, { names: ['twilio_usage_count'] });
        await storage.metrics(prices, { names: ['twilio_usage_price'] });
        return;
      }
    }
  }

  private parsePage(
    phase: TwilioPhase,
    body: unknown,
  ): { items: unknown[]; nextPageUri: string | null } {
    switch (phase) {
      case 'messages': {
        const parsed = messagesResponseSchema.parse(body);
        return {
          items: parsed.messages,
          nextPageUri: parsed.next_page_uri ?? null,
        };
      }
      case 'calls': {
        const parsed = callsResponseSchema.parse(body);
        return {
          items: parsed.calls,
          nextPageUri: parsed.next_page_uri ?? null,
        };
      }
      case 'usage': {
        const parsed = usageResponseSchema.parse(body);
        return {
          items: parsed.usage_records,
          nextPageUri: parsed.next_page_uri ?? null,
        };
      }
    }
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const cursor = isTwilioSyncCursor(options.cursor)
      ? options.cursor
      : undefined;
    const lookbackDays = this.settings.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
    const now = Date.now();

    const phases = selectActivePhases<TwilioResource, TwilioPhase>(
      resourceToPhase,
      PHASE_ORDER,
      this.settings.resources,
    );

    return paginateChunked<TwilioPhase, string>({
      phases,
      cursor,
      signal,
      logger: this.logger,
      fetchPage: async (phase, page, sig) => {
        const url =
          page ?? this.buildInitialUrl(phase, options, lookbackDays, now);
        const res = await this.fetch<unknown>(url, phase, sig);
        const { items, nextPageUri } = this.parsePage(phase, res.body);
        return { items, next: this.nextUrl(phase, nextPageUri) };
      },
      writeBatch: async (phase, items) => {
        await this.writePhase(storage, phase, items);
      },
    });
  }
}
