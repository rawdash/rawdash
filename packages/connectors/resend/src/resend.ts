import { connectorUserAgent, parseEpoch } from '@rawdash/connector-shared';
import {
  BaseConnector,
  type ChunkedSyncCursor,
  type ConnectorContext,
  type ConnectorDoc,
  type CredentialsSchema,
  type Entity,
  type Event,
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
    apiKey: z.object({ $secret: z.string() }).meta({
      label: 'API key',
      description:
        'A Resend API key with read access. Create one in the Resend dashboard under API Keys.',
      placeholder: 're_xxxxxxxxxxxxxxxxxxxxxxxx',
      secret: true,
    }),
    lookbackDays: z.number().int().positive().optional().meta({
      label: 'Lookback days (full sync)',
      description:
        'How many days of sent-email history to page back through on a full sync. Resend lists emails newest first with no server-side date filter, so the connector stops paging once it reaches emails older than this window. Defaults to 90.',
      placeholder: '90',
    }),
    resources: z
      .array(z.enum(['emails', 'domains']))
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          'Which Resend resources to sync. Omit to sync all of them.',
      }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'Resend',
  category: 'engineering',
  brandColor: '#000000',
  tagline:
    'Sync sent-email activity and sending-domain status from Resend to chart send volume, delivery and bounce rates, and domain verification on a dashboard.',
  vendor: {
    name: 'Resend',
    domain: 'resend.com',
    apiDocs: 'https://resend.com/docs/api-reference/introduction',
    website: 'https://resend.com',
  },
  auth: {
    summary:
      'A Resend API key sent as a Bearer token. A read-only (Sending access is not required) key scoped to the account is enough to list emails and domains.',
    setup: [
      'In the Resend dashboard open the API Keys page and create a new API key.',
      'Give it Full access or Read-only access; the connector only reads.',
      'Copy the key (it starts with `re_`) and store it as a secret, then reference it from config as `apiKey: secret("RESEND_API_KEY")`.',
    ],
  },
  rateLimit:
    'Resend rate-limits requests per API key (2 requests/second by default) and returns 429 with a Retry-After header when exceeded; the connector issues sequential paginated requests and relies on the shared HTTP client to honor 429 backoff.',
  limitations: [
    'Resend exposes no analytics or aggregate-stats API, so send volume, delivery rate, and bounce rate are computed at the widget level from the per-email event stream rather than read from a metrics endpoint.',
    'Each email event carries the delivery state (lastEvent) as of the sync that first captured it. Resend list responses are not filterable by update time, so an email whose state advances (for example sent then delivered) after it was first synced is not revisited on incremental syncs.',
    'Full syncs page newest-first until they reach the lookback window; email history older than the configured lookback is not backfilled.',
    'Received-email and broadcast resources are out of scope.',
  ],
});

export interface ResendSettings {
  lookbackDays?: number;
  resources?: readonly ResendResource[];
}

const resendCredentials = {
  apiKey: {
    description: 'Resend API key',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type ResendCredentials = typeof resendCredentials;

const PHASE_ORDER = ['emails', 'domains'] as const;

type ResendPhase = (typeof PHASE_ORDER)[number];

export type ResendResource = ResendPhase;

type ResendSyncCursor = ChunkedSyncCursor<ResendPhase, string>;

const isResendSyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

const BASE_URL = 'https://api.resend.com';
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_LOOKBACK_DAYS = 90;
const PAGE_SIZE = 100;

const EMAIL_EVENT = 'resend_email';
const DOMAIN_ENTITY = 'resend_domain';

const EMAIL_STATES = [
  'queued',
  'scheduled',
  'sent',
  'delivered',
  'delivery_delayed',
  'bounced',
  'complained',
  'opened',
  'clicked',
  'canceled',
  'failed',
] as const;

const recipientsSchema = z.union([z.string(), z.array(z.string())]).nullish();

const emailListItemSchema = z.object({
  id: z.string().min(1),
  message_id: z.string().nullish(),
  from: z.string().nullish(),
  to: recipientsSchema,
  cc: recipientsSchema,
  bcc: recipientsSchema,
  reply_to: recipientsSchema,
  subject: z.string().nullish(),
  created_at: z.string(),
  last_event: z.string().nullish(),
  scheduled_at: z.string().nullish(),
});

const emailsResponseSchema = z.object({
  object: z.string().nullish(),
  has_more: z.boolean().nullish(),
  data: z.array(emailListItemSchema),
});

const domainSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  status: z.string().nullish(),
  region: z.string().nullish(),
  created_at: z.string().nullish(),
  capabilities: z
    .object({
      sending: z.string().nullish(),
      receiving: z.string().nullish(),
    })
    .nullish(),
});

const domainsResponseSchema = z.object({
  object: z.string().nullish(),
  has_more: z.boolean().nullish(),
  data: z.array(domainSchema),
});

export const resendResources = defineResources({
  [EMAIL_EVENT]: {
    shape: 'event',
    description:
      'One event per email sent through Resend, timestamped at creation, carrying its latest delivery state, sender, sending domain, subject, and recipient count.',
    endpoint: 'GET /emails',
    notes:
      'Paged newest-first; full syncs stop at the lookback window and incremental syncs stop once a page predates the last sync. Events are append-only, so each email reflects the delivery state captured when it was first synced.',
    fields: [
      { name: 'emailId', description: 'Resend email id.' },
      { name: 'messageId', description: 'RFC 2822 Message-ID header value.' },
      {
        name: 'from',
        description: 'Sender address (with optional display name).',
      },
      {
        name: 'fromDomain',
        description: 'Domain portion of the sender address, lowercased.',
      },
      { name: 'subject', description: 'Email subject line.' },
      {
        name: 'lastEvent',
        description:
          'Most recent delivery state (e.g. delivered, bounced, complained) as of the sync that captured the email.',
      },
      {
        name: 'recipientCount',
        description: 'Number of primary (To) recipients.',
      },
      { name: 'hasCc', description: 'Whether the email had Cc recipients.' },
      { name: 'hasBcc', description: 'Whether the email had Bcc recipients.' },
      {
        name: 'scheduledAt',
        description: 'Scheduled send time in epoch milliseconds, if scheduled.',
      },
    ],
    filterable: [
      { field: 'lastEvent', ops: ['eq'], values: [...EMAIL_STATES] },
      { field: 'fromDomain', ops: ['eq'] },
    ],
    responses: { emails: emailsResponseSchema },
  },
  [DOMAIN_ENTITY]: {
    shape: 'entity',
    description:
      'Sending domains configured in the Resend account, with verification status, region, and send/receive capabilities.',
    endpoint: 'GET /domains',
    fields: [
      { name: 'name', description: 'Domain name.' },
      {
        name: 'status',
        description:
          'Verification status (e.g. verified, pending, not_started, failed, temporary_failure).',
      },
      { name: 'region', description: 'Sending region for the domain.' },
      {
        name: 'sending',
        description: 'Sending capability state for the domain.',
      },
      {
        name: 'receiving',
        description: 'Receiving capability state for the domain.',
      },
      {
        name: 'createdAt',
        description: 'When the domain was created, in epoch milliseconds.',
      },
    ],
    filterable: [
      {
        field: 'status',
        ops: ['eq'],
        values: [
          'not_started',
          'pending',
          'verified',
          'failed',
          'temporary_failure',
        ],
      },
    ],
    responses: { domains: domainsResponseSchema },
  },
});

export type ResendEmail = z.infer<typeof emailListItemSchema>;
export type ResendDomain = z.infer<typeof domainSchema>;

function recipientCount(value: ResendEmail['to']): number {
  if (Array.isArray(value)) {
    return value.length;
  }
  return typeof value === 'string' && value.length > 0 ? 1 : 0;
}

function hasRecipients(value: ResendEmail['to']): boolean {
  return recipientCount(value) > 0;
}

export function extractDomain(from: string | null | undefined): string | null {
  if (!from) {
    return null;
  }
  const match = from.match(/@([^>\s]+)/);
  return match ? match[1]!.toLowerCase() : null;
}

export function emailToEvent(email: ResendEmail): Event {
  const ts = parseEpoch(email.created_at, 'iso') ?? 0;
  const scheduledMs = email.scheduled_at
    ? parseEpoch(email.scheduled_at, 'iso')
    : null;
  const attributes: Record<string, JSONValue> = {
    emailId: email.id,
    messageId: email.message_id ?? null,
    from: email.from ?? null,
    fromDomain: extractDomain(email.from),
    subject: email.subject ?? null,
    lastEvent: email.last_event ?? null,
    recipientCount: recipientCount(email.to),
    hasCc: hasRecipients(email.cc),
    hasBcc: hasRecipients(email.bcc),
    scheduledAt: scheduledMs ?? null,
  };
  return {
    name: EMAIL_EVENT,
    start_ts: ts,
    end_ts: null,
    attributes,
  };
}

export function domainToEntity(domain: ResendDomain): Entity {
  const createdMs = domain.created_at
    ? parseEpoch(domain.created_at, 'iso')
    : null;
  return {
    type: DOMAIN_ENTITY,
    id: domain.id,
    attributes: {
      name: domain.name,
      status: domain.status ?? null,
      region: domain.region ?? null,
      sending: domain.capabilities?.sending ?? null,
      receiving: domain.capabilities?.receiving ?? null,
      createdAt: createdMs ?? null,
    },
    updated_at: createdMs ?? 0,
  };
}

export const id = 'resend';

export class ResendConnector extends BaseConnector<
  ResendSettings,
  ResendCredentials
> {
  static readonly id = id;

  static readonly resources = resendResources;

  static readonly schemas = schemasFromResources(resendResources);

  static create(input: unknown, ctx?: ConnectorContext): ResendConnector {
    const parsed = configFields.parse(input);
    return new ResendConnector(
      {
        lookbackDays: parsed.lookbackDays,
        resources: parsed.resources,
      },
      { apiKey: parsed.apiKey },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = resendCredentials;

  private buildHeaders(): Record<string, string> {
    return {
      Accept: 'application/json',
      Authorization: `Bearer ${this.creds.apiKey}`,
      'User-Agent': connectorUserAgent('resend'),
    };
  }

  private emailCutoffMs(options: SyncOptions, now: number): number | null {
    const sinceMs = options.since ? new Date(options.since).getTime() : null;
    if (options.mode === 'latest') {
      return Number.isFinite(sinceMs) ? sinceMs : null;
    }
    const lookbackDays = this.settings.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
    const windowCutoff = now - lookbackDays * MS_PER_DAY;
    if (sinceMs !== null && Number.isFinite(sinceMs)) {
      return Math.max(sinceMs, windowCutoff);
    }
    return windowCutoff;
  }

  private async fetchEmailsPage(
    page: string | null,
    options: SyncOptions,
    now: number,
    signal?: AbortSignal,
  ): Promise<{ items: ResendEmail[]; next: string | null }> {
    const url = new URL(`${BASE_URL}/emails`);
    url.searchParams.set('limit', String(PAGE_SIZE));
    if (page) {
      url.searchParams.set('after', page);
    }
    const res = await this.get<z.infer<typeof emailsResponseSchema>>(
      url.toString(),
      { resource: 'emails', headers: this.buildHeaders(), signal },
    );
    const all = res.body.data ?? [];
    const cutoff = this.emailCutoffMs(options, now);
    const kept: ResendEmail[] = [];
    let reachedCutoff = false;
    for (const email of all) {
      const ts = parseEpoch(email.created_at, 'iso');
      if (cutoff !== null && ts !== null && ts <= cutoff) {
        reachedCutoff = true;
        break;
      }
      kept.push(email);
    }
    const lastId = all.length > 0 ? all[all.length - 1]!.id : null;
    const next =
      !reachedCutoff && res.body.has_more === true && lastId !== null
        ? lastId
        : null;
    return { items: kept, next };
  }

  private async fetchDomainsPage(
    page: string | null,
    signal?: AbortSignal,
  ): Promise<{ items: ResendDomain[]; next: string | null }> {
    const url = new URL(`${BASE_URL}/domains`);
    url.searchParams.set('limit', String(PAGE_SIZE));
    if (page) {
      url.searchParams.set('after', page);
    }
    const res = await this.get<z.infer<typeof domainsResponseSchema>>(
      url.toString(),
      { resource: 'domains', headers: this.buildHeaders(), signal },
    );
    const all = res.body.data ?? [];
    const lastId = all.length > 0 ? all[all.length - 1]!.id : null;
    const next = res.body.has_more === true && lastId !== null ? lastId : null;
    return { items: all, next };
  }

  private async writeEmails(
    storage: StorageHandle,
    emails: ResendEmail[],
    page: string | null,
    isFull: boolean,
  ): Promise<void> {
    if (isFull && page === null) {
      await storage.events([], { names: [EMAIL_EVENT] });
    }
    for (const email of emails) {
      await storage.event(emailToEvent(email));
    }
  }

  private async writeDomains(
    storage: StorageHandle,
    domains: ResendDomain[],
    page: string | null,
    isFull: boolean,
  ): Promise<void> {
    if (isFull && page === null) {
      await storage.entities([], { types: [DOMAIN_ENTITY] });
    }
    for (const domain of domains) {
      await storage.entity(domainToEntity(domain));
    }
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const cursor: ResendSyncCursor | undefined = isResendSyncCursor(
      options.cursor,
    )
      ? options.cursor
      : undefined;
    const isFull = options.mode === 'full';
    const now = Date.now();

    const phases = selectActivePhases<ResendResource, ResendPhase>(
      (r) => r,
      PHASE_ORDER,
      this.settings.resources,
    );

    return paginateChunked<ResendPhase, string>({
      phases,
      cursor,
      signal,
      logger: this.logger,
      fetchPage: async (phase, page, sig) => {
        if (phase === 'emails') {
          return this.fetchEmailsPage(page, options, now, sig);
        }
        return this.fetchDomainsPage(page, sig);
      },
      writeBatch: async (phase, items, page) => {
        if (phase === 'emails') {
          await this.writeEmails(storage, items as ResendEmail[], page, isFull);
          return;
        }
        await this.writeDomains(storage, items as ResendDomain[], page, isFull);
      },
    });
  }
}
