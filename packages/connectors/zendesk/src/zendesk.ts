import {
  type HttpResponse,
  connectorUserAgent,
  parseEpoch,
} from '@rawdash/connector-shared';
import {
  BaseConnector,
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

// ---------------------------------------------------------------------------
// configFields
// ---------------------------------------------------------------------------

export const configFields = defineConfigFields(
  z.object({
    subdomain: z
      .string()
      .trim()
      .min(1)
      .regex(
        /^[a-z0-9][a-z0-9-]*$/i,
        'Use the subdomain only (e.g. "acme" for acme.zendesk.com), without the protocol or path.',
      )
      .meta({
        label: 'Account subdomain',
        description:
          'Your Zendesk account subdomain, the "acme" in acme.zendesk.com.',
        placeholder: 'acme',
      }),
    email: z.string().trim().min(1).meta({
      label: 'Agent email',
      description:
        'Email address of an agent (or admin) on the Zendesk account; paired with the API token for Basic auth.',
      placeholder: 'agent@acme.com',
    }),
    apiToken: z.object({ $secret: z.string() }).meta({
      label: 'API token',
      description:
        'Zendesk API token. Create one in Admin Center -> Apps and integrations -> Zendesk API -> Settings -> Add API token.',
      placeholder: 'aB1c2D3...',
      secret: true,
    }),
    resources: z
      .array(
        z.enum([
          'users',
          'groups',
          'tickets',
          'ticket_events',
          'satisfaction_ratings',
        ]),
      )
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          'Which Zendesk resources to sync. Omit to sync all of them. The API token only needs read scopes for the resources listed here.',
      }),
  }),
);

// ---------------------------------------------------------------------------
// Connector doc (catalog metadata)
// ---------------------------------------------------------------------------

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'Zendesk',
  category: 'support',
  brandColor: '#03363D',
  tagline:
    'Sync tickets, ticket state-change events, satisfaction ratings, users, and groups from Zendesk Support for queue depth, response time, and CSAT analytics.',
  vendor: {
    name: 'Zendesk',
    apiDocs:
      'https://developer.zendesk.com/api-reference/ticketing/introduction/',
    website: 'https://www.zendesk.com',
  },
  auth: {
    summary:
      'HTTP Basic auth using an agent (or admin) email address paired with a Zendesk API token. The token must belong to an account with read access to tickets, users, and groups.',
    setup: [
      'Open Admin Center -> Apps and integrations -> Zendesk API.',
      'On the Settings tab, enable Token access if it is not already on.',
      'Click Add API token, give it a label, and copy the generated token value (you cannot view it again).',
      'Store the token as a secret and reference it from config as `apiToken: secret("ZENDESK_API_TOKEN")`, alongside the agent email and your account subdomain (the "acme" in acme.zendesk.com).',
    ],
  },
  rateLimit:
    'Zendesk Support API enforces per-account quotas (default ~700 requests/minute on Professional plans, higher on Enterprise) and signals throttling via 429 with a Retry-After header; the shared HTTP client honors Retry-After on backoff.',
  limitations: [
    'Ticket comment bodies and per-event audit transcripts are not synced.',
    'Zendesk Chat, Talk (voice), and Sell are separate product lines and are out of scope.',
    'Ticket state-change events are derived from each ticket’s timestamps (created, updated, solved); full audit-event history is not synced.',
  ],
});

// ---------------------------------------------------------------------------
// Settings / credentials
// ---------------------------------------------------------------------------

export interface ZendeskSettings {
  subdomain: string;
  resources?: readonly ZendeskResource[];
}

const zendeskCredentials = {
  email: {
    description: 'Zendesk agent email',
    auth: 'required' as const,
  },
  apiToken: {
    description: 'Zendesk API token',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type ZendeskCredentials = typeof zendeskCredentials;

// ---------------------------------------------------------------------------
// Sync phases + cursor
// ---------------------------------------------------------------------------

const PHASE_ORDER = [
  'users',
  'groups',
  'tickets',
  'ticket_events',
  'satisfaction_ratings',
] as const;

type ZendeskPhase = (typeof PHASE_ORDER)[number];

export type ZendeskResource = ZendeskPhase;

const isZendeskSyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

const PAGE_SIZE = 100;
const INCREMENTAL_PAGE_SIZE = 1000;

const USER_ENTITY = 'zendesk_user';
const GROUP_ENTITY = 'zendesk_group';
const TICKET_ENTITY = 'zendesk_ticket';
const TICKET_STATE_EVENT = 'zendesk_ticket_state_change';
const SATISFACTION_RATING_ENTITY = 'zendesk_satisfaction_rating';

// ---------------------------------------------------------------------------
// API response types
// ---------------------------------------------------------------------------

interface UserRecord {
  id: number;
  name?: string | null;
  email?: string | null;
  role?: string | null;
  active?: boolean | null;
  suspended?: boolean | null;
  default_group_id?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
}

interface UserListResponse {
  users: UserRecord[];
  meta?: { has_more?: boolean | null; after_cursor?: string | null } | null;
}

interface GroupRecord {
  id: number;
  name?: string | null;
  default?: boolean | null;
  deleted?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
}

interface GroupListResponse {
  groups: GroupRecord[];
  meta?: { has_more?: boolean | null; after_cursor?: string | null } | null;
}

interface TicketRecord {
  id: number;
  subject?: string | null;
  status?: string | null;
  priority?: string | null;
  type?: string | null;
  channel?: string | null;
  assignee_id?: number | null;
  requester_id?: number | null;
  submitter_id?: number | null;
  group_id?: number | null;
  organization_id?: number | null;
  tags?: string[] | null;
  via?: { channel?: string | null } | null;
  satisfaction_rating?: { score?: string | null } | null;
  created_at?: string | null;
  updated_at?: string | null;
}

interface IncrementalTicketsResponse {
  tickets: TicketRecord[];
  after_cursor?: string | null;
  end_of_stream?: boolean | null;
  count?: number | null;
}

interface SatisfactionRatingRecord {
  id: number;
  score?: string | null;
  ticket_id?: number | null;
  assignee_id?: number | null;
  requester_id?: number | null;
  group_id?: number | null;
  comment?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

interface SatisfactionRatingListResponse {
  satisfaction_ratings: SatisfactionRatingRecord[];
  meta?: { has_more?: boolean | null; after_cursor?: string | null } | null;
}

// ---------------------------------------------------------------------------
// Schemas — describe the per-resource API response shape consumed by request()
// ---------------------------------------------------------------------------

const idNumber = z.number();
const isoString = z.string();

const userSchema = z.object({
  id: idNumber,
  name: z.string().nullish(),
  email: z.string().nullish(),
  role: z.string().nullish(),
  active: z.boolean().nullish(),
  suspended: z.boolean().nullish(),
  default_group_id: z.number().nullish(),
  created_at: isoString.nullish(),
  updated_at: isoString.nullish(),
});

const groupSchema = z.object({
  id: idNumber,
  name: z.string().nullish(),
  default: z.boolean().nullish(),
  deleted: z.boolean().nullish(),
  created_at: isoString.nullish(),
  updated_at: isoString.nullish(),
});

const ticketSchema = z.object({
  id: idNumber,
  subject: z.string().nullish(),
  status: z.string().nullish(),
  priority: z.string().nullish(),
  type: z.string().nullish(),
  channel: z.string().nullish(),
  assignee_id: z.number().nullish(),
  requester_id: z.number().nullish(),
  submitter_id: z.number().nullish(),
  group_id: z.number().nullish(),
  organization_id: z.number().nullish(),
  tags: z.array(z.string()).nullish(),
  via: z.object({ channel: z.string().nullish() }).nullish(),
  satisfaction_rating: z.object({ score: z.string().nullish() }).nullish(),
  created_at: isoString.nullish(),
  updated_at: isoString.nullish(),
});

const satisfactionRatingSchema = z.object({
  id: idNumber,
  score: z.string().nullish(),
  ticket_id: z.number().nullish(),
  assignee_id: z.number().nullish(),
  requester_id: z.number().nullish(),
  group_id: z.number().nullish(),
  comment: z.string().nullish(),
  created_at: isoString.nullish(),
  updated_at: isoString.nullish(),
});

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------

function numericIdOrNull(value: number | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return String(value);
}

function isoToMs(value: string | null | undefined): number | null {
  return parseEpoch(value ?? null, 'iso');
}

function isoToMsOrZero(value: string | null | undefined): number {
  return isoToMs(value) ?? 0;
}

function viaChannel(ticket: TicketRecord): string | null {
  return ticket.via?.channel ?? ticket.channel ?? null;
}

function csatScore(ticket: TicketRecord): string | null {
  return ticket.satisfaction_rating?.score ?? null;
}

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

export const zendeskResources = defineResources({
  [USER_ENTITY]: {
    shape: 'entity',
    description:
      'Zendesk users (agents, admins, and end-users) with role and activity flags.',
    endpoint: 'GET /api/v2/users.json',
    fields: [
      { name: 'name', description: 'User display name.' },
      { name: 'email', description: 'User email address.' },
      {
        name: 'role',
        description: 'User role (end-user, agent, or admin).',
      },
      { name: 'active', description: 'Whether the user is active.' },
      { name: 'suspended', description: 'Whether the user is suspended.' },
      {
        name: 'defaultGroupId',
        description: 'Default group the user belongs to (agents only).',
      },
      {
        name: 'createdAt',
        description: 'When the user was created (Unix ms).',
      },
    ],
    responses: { users: z.array(userSchema) },
  },
  [GROUP_ENTITY]: {
    shape: 'entity',
    description: 'Agent groups used to route tickets.',
    endpoint: 'GET /api/v2/groups.json',
    fields: [
      { name: 'name', description: 'Group name.' },
      {
        name: 'isDefault',
        description: 'Whether this is the account default group.',
      },
      { name: 'deleted', description: 'Whether the group is soft-deleted.' },
      {
        name: 'createdAt',
        description: 'When the group was created (Unix ms).',
      },
    ],
    responses: { groups: z.array(groupSchema) },
  },
  [TICKET_ENTITY]: {
    shape: 'entity',
    description:
      'Tickets with status, priority, assignment, channel, and tags.',
    endpoint: 'GET /api/v2/incremental/tickets/cursor.json',
    fields: [
      { name: 'subject', description: 'Ticket subject line.' },
      {
        name: 'status',
        description:
          'Ticket status (new, open, pending, hold, solved, closed).',
      },
      {
        name: 'priority',
        description: 'Ticket priority (low, normal, high, urgent).',
      },
      { name: 'type', description: 'Ticket type (question, incident, etc.).' },
      {
        name: 'channel',
        description: 'Channel the ticket was created from (email, web, etc.).',
      },
      {
        name: 'assigneeId',
        description: 'Assigned agent id (null if unassigned).',
      },
      { name: 'requesterId', description: 'Requester (end-user) id.' },
      {
        name: 'groupId',
        description: 'Group the ticket is routed to (null if unrouted).',
      },
      {
        name: 'organizationId',
        description: 'Organization id (null if none).',
      },
      {
        name: 'tags',
        description: 'Flat list of tags applied to the ticket.',
      },
      {
        name: 'satisfactionScore',
        description:
          'Per-ticket CSAT score from the satisfaction_rating block (offered, good, bad, unoffered).',
      },
      {
        name: 'createdAt',
        description: 'When the ticket was created (Unix ms).',
      },
    ],
    responses: { tickets: z.array(ticketSchema) },
  },
  [TICKET_STATE_EVENT]: {
    shape: 'event',
    description:
      'Ticket state-change events (created / solved) derived from each ticket.',
    endpoint: 'GET /api/v2/incremental/tickets/cursor.json',
    notes:
      'Derived from each ticket’s timestamps; the scope is cleared and rewritten on every sync.',
    fields: [
      {
        name: 'ticketId',
        description: 'The ticket the event belongs to.',
      },
      {
        name: 'transition',
        description: 'created or solved.',
      },
      {
        name: 'status',
        description: 'Ticket status at sync time.',
      },
      {
        name: 'priority',
        description: 'Ticket priority at sync time.',
      },
      {
        name: 'assigneeId',
        description: 'Assigned agent id at sync time (null if unassigned).',
      },
      {
        name: 'groupId',
        description: 'Group id at sync time (null if unrouted).',
      },
      { name: 'channel', description: 'Channel the ticket was created from.' },
    ],
    responses: { ticket_events: z.array(ticketSchema) },
  },
  [SATISFACTION_RATING_ENTITY]: {
    shape: 'entity',
    description:
      'Per-ticket customer satisfaction (CSAT) ratings with score and free-text comment.',
    endpoint: 'GET /api/v2/satisfaction_ratings.json',
    fields: [
      { name: 'score', description: 'Rating score (good, bad, offered).' },
      { name: 'ticketId', description: 'The ticket the rating is for.' },
      {
        name: 'assigneeId',
        description: 'Agent assigned at the time of rating.',
      },
      { name: 'requesterId', description: 'Requester (end-user) id.' },
      { name: 'groupId', description: 'Group id at the time of rating.' },
      {
        name: 'hasComment',
        description: 'Whether a free-text comment is set.',
      },
      {
        name: 'createdAt',
        description: 'When the rating was submitted (Unix ms).',
      },
    ],
    responses: { satisfaction_ratings: z.array(satisfactionRatingSchema) },
  },
});

// ---------------------------------------------------------------------------
// ZendeskConnector
// ---------------------------------------------------------------------------

export const id = 'zendesk';

export class ZendeskConnector extends BaseConnector<
  ZendeskSettings,
  ZendeskCredentials
> {
  static readonly id = id;

  static readonly resources = zendeskResources;

  static readonly schemas = schemasFromResources(zendeskResources);

  static create(input: unknown, ctx?: ConnectorContext): ZendeskConnector {
    const parsed = configFields.parse(input);
    return new ZendeskConnector(
      {
        subdomain: parsed.subdomain,
        resources: parsed.resources,
      },
      { email: parsed.email, apiToken: parsed.apiToken },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = zendeskCredentials;

  private get baseUrl(): string {
    return `https://${this.settings.subdomain}.zendesk.com`;
  }

  private buildHeaders(): Record<string, string> {
    return {
      Authorization: encodeBasicAuth(
        `${this.creds.email}/token`,
        this.creds.apiToken,
      ),
      Accept: 'application/json',
      'User-Agent': connectorUserAgent('zendesk'),
    };
  }

  private apiGet<T>(
    url: string,
    resource: string,
    signal?: AbortSignal,
  ): Promise<HttpResponse<T>> {
    return this.get<T>(url, {
      resource,
      headers: this.buildHeaders(),
      signal,
    });
  }

  // -------------------------------------------------------------------------
  // users — GET /api/v2/users.json (cursor pagination)
  // -------------------------------------------------------------------------

  private buildUserListUrl(cursor: string | null): string {
    const params = new URLSearchParams({ 'page[size]': String(PAGE_SIZE) });
    if (cursor) {
      params.set('page[after]', cursor);
    }
    return `${this.baseUrl}/api/v2/users.json?${params.toString()}`;
  }

  private async fetchUsers(
    page: string | null,
    signal?: AbortSignal,
  ): Promise<{ items: unknown[]; next: string | null }> {
    const res = await this.apiGet<UserListResponse>(
      this.buildUserListUrl(page),
      'users',
      signal,
    );
    return {
      items: res.body.users ?? [],
      next: res.body.meta?.has_more
        ? (res.body.meta?.after_cursor ?? null)
        : null,
    };
  }

  private async writeUsers(
    storage: StorageHandle,
    items: UserRecord[],
  ): Promise<void> {
    for (const user of items) {
      await storage.entity({
        type: USER_ENTITY,
        id: String(user.id),
        attributes: {
          name: user.name ?? null,
          email: user.email ?? null,
          role: user.role ?? null,
          active: user.active ?? null,
          suspended: user.suspended ?? null,
          defaultGroupId: numericIdOrNull(user.default_group_id),
          createdAt: isoToMs(user.created_at),
        },
        updated_at: isoToMsOrZero(user.updated_at ?? user.created_at),
      });
    }
  }

  // -------------------------------------------------------------------------
  // groups — GET /api/v2/groups.json (cursor pagination)
  // -------------------------------------------------------------------------

  private buildGroupListUrl(cursor: string | null): string {
    const params = new URLSearchParams({ 'page[size]': String(PAGE_SIZE) });
    if (cursor) {
      params.set('page[after]', cursor);
    }
    return `${this.baseUrl}/api/v2/groups.json?${params.toString()}`;
  }

  private async fetchGroups(
    page: string | null,
    signal?: AbortSignal,
  ): Promise<{ items: unknown[]; next: string | null }> {
    const res = await this.apiGet<GroupListResponse>(
      this.buildGroupListUrl(page),
      'groups',
      signal,
    );
    return {
      items: res.body.groups ?? [],
      next: res.body.meta?.has_more
        ? (res.body.meta?.after_cursor ?? null)
        : null,
    };
  }

  private async writeGroups(
    storage: StorageHandle,
    items: GroupRecord[],
  ): Promise<void> {
    for (const group of items) {
      await storage.entity({
        type: GROUP_ENTITY,
        id: String(group.id),
        attributes: {
          name: group.name ?? null,
          isDefault: group.default ?? null,
          deleted: group.deleted ?? null,
          createdAt: isoToMs(group.created_at),
        },
        updated_at: isoToMsOrZero(group.updated_at ?? group.created_at),
      });
    }
  }

  // -------------------------------------------------------------------------
  // tickets — GET /api/v2/incremental/tickets/cursor.json (cursor pagination)
  // -------------------------------------------------------------------------

  private buildIncrementalTicketsUrl(
    cursor: string | null,
    options: SyncOptions,
  ): string {
    const params = new URLSearchParams({
      per_page: String(INCREMENTAL_PAGE_SIZE),
    });
    if (cursor) {
      params.set('cursor', cursor);
    } else {
      params.set('start_time', String(sinceUnixSec(options) ?? 0));
    }
    return `${this.baseUrl}/api/v2/incremental/tickets/cursor.json?${params.toString()}`;
  }

  private async fetchTickets(
    page: string | null,
    resource: 'tickets' | 'ticket_events',
    options: SyncOptions,
    signal?: AbortSignal,
  ): Promise<{ items: unknown[]; next: string | null }> {
    // ticket_events clears and rewrites its whole scope on every sync (events
    // can't be upserted by key), so even on incremental ticks it must scan from
    // the beginning — otherwise a `since` filter would drop historical events
    // for tickets untouched in this window.
    const fetchOptions =
      resource === 'ticket_events' ? { ...options, since: undefined } : options;
    const res = await this.apiGet<IncrementalTicketsResponse>(
      this.buildIncrementalTicketsUrl(page, fetchOptions),
      resource,
      signal,
    );
    const next = res.body.end_of_stream
      ? null
      : (res.body.after_cursor ?? null);
    return { items: res.body.tickets ?? [], next };
  }

  private async writeTickets(
    storage: StorageHandle,
    items: TicketRecord[],
  ): Promise<void> {
    for (const ticket of items) {
      const attributes: Record<string, JSONValue> = {
        subject: ticket.subject ?? null,
        status: ticket.status ?? null,
        priority: ticket.priority ?? null,
        type: ticket.type ?? null,
        channel: viaChannel(ticket),
        assigneeId: numericIdOrNull(ticket.assignee_id),
        requesterId: numericIdOrNull(ticket.requester_id),
        submitterId: numericIdOrNull(ticket.submitter_id),
        groupId: numericIdOrNull(ticket.group_id),
        organizationId: numericIdOrNull(ticket.organization_id),
        tags: ticket.tags ?? [],
        satisfactionScore: csatScore(ticket),
        createdAt: isoToMs(ticket.created_at),
      };
      await storage.entity({
        type: TICKET_ENTITY,
        id: String(ticket.id),
        attributes,
        updated_at: isoToMsOrZero(ticket.updated_at ?? ticket.created_at),
      });
    }
  }

  // -------------------------------------------------------------------------
  // ticket_events — derived from the same /incremental/tickets payload
  // -------------------------------------------------------------------------

  private async writeTicketEvents(
    storage: StorageHandle,
    items: TicketRecord[],
  ): Promise<void> {
    for (const ticket of items) {
      const baseAttrs: Record<string, JSONValue> = {
        ticketId: String(ticket.id),
        status: ticket.status ?? null,
        priority: ticket.priority ?? null,
        assigneeId: numericIdOrNull(ticket.assignee_id),
        groupId: numericIdOrNull(ticket.group_id),
        channel: viaChannel(ticket),
      };

      const createdMs = isoToMs(ticket.created_at);
      if (createdMs !== null) {
        await storage.event({
          name: TICKET_STATE_EVENT,
          start_ts: createdMs,
          end_ts: null,
          attributes: { ...baseAttrs, transition: 'created' },
        });
      }

      // Zendesk doesn't return a solved_at timestamp directly on the ticket;
      // when the ticket is in a terminal state (solved or closed), we mirror
      // updated_at as the solved transition. Imperfect but the best signal
      // available without per-ticket audit_events.
      if (
        (ticket.status === 'solved' || ticket.status === 'closed') &&
        ticket.updated_at
      ) {
        const solvedMs = isoToMs(ticket.updated_at);
        if (solvedMs !== null) {
          await storage.event({
            name: TICKET_STATE_EVENT,
            start_ts: solvedMs,
            end_ts: null,
            attributes: { ...baseAttrs, transition: 'solved' },
          });
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // satisfaction_ratings — GET /api/v2/satisfaction_ratings.json
  // -------------------------------------------------------------------------

  private buildSatisfactionRatingsUrl(
    cursor: string | null,
    options: SyncOptions,
  ): string {
    const params = new URLSearchParams({ 'page[size]': String(PAGE_SIZE) });
    if (cursor) {
      params.set('page[after]', cursor);
    } else {
      const startTime = sinceUnixSec(options);
      if (startTime !== null) {
        params.set('start_time', String(startTime));
      }
    }
    return `${this.baseUrl}/api/v2/satisfaction_ratings.json?${params.toString()}`;
  }

  private async fetchSatisfactionRatings(
    page: string | null,
    options: SyncOptions,
    signal?: AbortSignal,
  ): Promise<{ items: unknown[]; next: string | null }> {
    const res = await this.apiGet<SatisfactionRatingListResponse>(
      this.buildSatisfactionRatingsUrl(page, options),
      'satisfaction_ratings',
      signal,
    );
    return {
      items: res.body.satisfaction_ratings ?? [],
      next: res.body.meta?.has_more
        ? (res.body.meta?.after_cursor ?? null)
        : null,
    };
  }

  private async writeSatisfactionRatings(
    storage: StorageHandle,
    items: SatisfactionRatingRecord[],
  ): Promise<void> {
    for (const rating of items) {
      await storage.entity({
        type: SATISFACTION_RATING_ENTITY,
        id: String(rating.id),
        attributes: {
          score: rating.score ?? null,
          ticketId: numericIdOrNull(rating.ticket_id),
          assigneeId: numericIdOrNull(rating.assignee_id),
          requesterId: numericIdOrNull(rating.requester_id),
          groupId: numericIdOrNull(rating.group_id),
          hasComment:
            typeof rating.comment === 'string' && rating.comment !== '',
          createdAt: isoToMs(rating.created_at),
        },
        updated_at: isoToMsOrZero(rating.updated_at ?? rating.created_at),
      });
    }
  }

  // -------------------------------------------------------------------------
  // Scope clearing (idempotency)
  // -------------------------------------------------------------------------

  private async clearScopeOnFirstPage(
    storage: StorageHandle,
    phase: ZendeskPhase,
    isFull: boolean,
  ): Promise<void> {
    if (phase === 'ticket_events') {
      // Events can't be upserted by key, so wipe the scope and rewrite from
      // the freshly fetched ticket timestamps on every sync.
      await storage.events([], { names: [TICKET_STATE_EVENT] });
      return;
    }
    if (!isFull) {
      // Entity phases upsert by id, so incremental ticks just overwrite the
      // records they touch.
      return;
    }
    const entityType = ENTITY_TYPE_BY_PHASE[phase];
    if (entityType) {
      await storage.entities([], { types: [entityType] });
    }
  }

  private async writePhase(
    storage: StorageHandle,
    phase: ZendeskPhase,
    items: unknown[],
  ): Promise<void> {
    switch (phase) {
      case 'users':
        await this.writeUsers(storage, items as UserRecord[]);
        return;
      case 'groups':
        await this.writeGroups(storage, items as GroupRecord[]);
        return;
      case 'tickets':
        await this.writeTickets(storage, items as TicketRecord[]);
        return;
      case 'ticket_events':
        await this.writeTicketEvents(storage, items as TicketRecord[]);
        return;
      case 'satisfaction_ratings':
        await this.writeSatisfactionRatings(
          storage,
          items as SatisfactionRatingRecord[],
        );
        return;
    }
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const cursor = isZendeskSyncCursor(options.cursor)
      ? options.cursor
      : undefined;
    const isFull = options.mode === 'full';

    const phases = selectActivePhases<ZendeskResource, ZendeskPhase>(
      (r) => r,
      PHASE_ORDER,
      this.settings.resources,
    );

    return paginateChunked<ZendeskPhase, string>({
      phases,
      cursor,
      signal,
      logger: this.logger,
      fetchPage: async (phase, page, sig) => {
        switch (phase) {
          case 'users':
            return this.fetchUsers(page, sig);
          case 'groups':
            return this.fetchGroups(page, sig);
          case 'tickets':
          case 'ticket_events':
            return this.fetchTickets(page, phase, options, sig);
          case 'satisfaction_ratings':
            return this.fetchSatisfactionRatings(page, options, sig);
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

// ---------------------------------------------------------------------------
// Helpers (module-scoped)
// ---------------------------------------------------------------------------

const ENTITY_TYPE_BY_PHASE: Partial<Record<ZendeskPhase, string>> = {
  users: USER_ENTITY,
  groups: GROUP_ENTITY,
  tickets: TICKET_ENTITY,
  satisfaction_ratings: SATISFACTION_RATING_ENTITY,
};

// Zendesk's incremental endpoints take start_time in Unix seconds, while
// SyncOptions.since is an ISO timestamp. Returns null when no incremental
// window applies.
function sinceUnixSec(options: SyncOptions): number | null {
  if (!options.since) {
    return null;
  }
  const ms = new Date(options.since).getTime();
  if (!Number.isFinite(ms)) {
    return null;
  }
  return Math.floor(ms / 1000);
}

// Cloudflare Workers and Node both expose btoa, but Node only did so from 16+
// onward. Fall back to Buffer if btoa is missing so we don't crash on older
// runtimes the host might be embedded in.
function encodeBasicAuth(username: string, secret: string): string {
  const raw = `${username}:${secret}`;
  if (typeof btoa === 'function') {
    return `Basic ${btoa(raw)}`;
  }
  const bufferCtor = (
    globalThis as {
      Buffer?: { from: (s: string) => { toString: (enc: string) => string } };
    }
  ).Buffer;
  if (bufferCtor) {
    return `Basic ${bufferCtor.from(raw).toString('base64')}`;
  }
  throw new Error('No base64 encoder available in this runtime');
}
