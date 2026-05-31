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
    accessToken: z.object({ $secret: z.string() }).meta({
      label: 'Access token',
      description:
        'Intercom access token (personal or app) with read access to conversations, contacts, teams, and admins. Generate one at Settings → Developers → Developer Hub → Authentication.',
      placeholder: 'dG9rOj...',
      secret: true,
    }),
    apiVersion: z
      .string()
      .trim()
      .regex(
        /^\d+\.\d+$/,
        'Use a numeric Intercom API version like "2.11" (no leading "v").',
      )
      .default('2.11')
      .meta({
        label: 'Intercom API version',
        description:
          'Value sent in the Intercom-Version header. Defaults to 2.11; pin a specific version here when upgrading deliberately.',
        placeholder: '2.11',
      }),
    region: z.enum(['us', 'eu', 'au']).default('us').meta({
      label: 'Region',
      description:
        'Intercom region of your workspace. Selects the API host: us → api.intercom.io, eu → api.eu.intercom.io, au → api.au.intercom.io.',
      placeholder: 'us',
    }),
    resources: z
      .array(
        z.enum([
          'admins',
          'teams',
          'contacts',
          'conversations',
          'conversation_events',
        ]),
      )
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          'Which Intercom resources to sync. Omit to sync all of them. The access token only needs read scopes for the resources listed here.',
      }),
  }),
);

// ---------------------------------------------------------------------------
// Connector doc (catalog metadata)
// ---------------------------------------------------------------------------

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'Intercom',
  category: 'support',
  brandColor: '#6AFDEF',
  tagline:
    'Sync conversations, contacts, teams, and admins from Intercom for support volume, response latency, and queue-depth analytics.',
  vendor: {
    name: 'Intercom',
    apiDocs:
      'https://developers.intercom.com/docs/references/rest-api/api.intercom.io/',
    website: 'https://www.intercom.com',
  },
  auth: {
    summary:
      'An Intercom access token (personal or app) with read access to conversations, contacts, teams, and admins.',
    setup: [
      'Open Intercom → Settings → Developers → Developer Hub and create or select an app.',
      "On the app's Authentication tab, copy the access token.",
      'Ensure the token has read access for the resources you intend to sync.',
      'Store the token as a secret and reference it from config as `accessToken: secret("INTERCOM_ACCESS_TOKEN")`.',
    ],
  },
  rateLimit:
    'Intercom enforces per-app and per-workspace limits (default ~1000 requests/minute) and signals quota state via the X-RateLimit-* response headers; the shared HTTP client backs off on 429, preferring X-RateLimit-Reset.',
  limitations: [
    'Conversation message bodies and per-part transcripts are not synced.',
    'Help Center articles and outbound campaigns are out of scope.',
    'Full per-part state-transition history is not synced; state-change events are derived from each conversation’s statistics block.',
  ],
});

// ---------------------------------------------------------------------------
// Settings / credentials
// ---------------------------------------------------------------------------

export interface IntercomSettings {
  apiVersion: string;
  region: 'us' | 'eu' | 'au';
  resources?: readonly IntercomResource[];
}

const intercomCredentials = {
  accessToken: {
    description: 'Intercom access token',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type IntercomCredentials = typeof intercomCredentials;

// ---------------------------------------------------------------------------
// Sync phases + cursor
// ---------------------------------------------------------------------------

const PHASE_ORDER = [
  'admins',
  'teams',
  'contacts',
  'conversations',
  'conversation_events',
] as const;

type IntercomPhase = (typeof PHASE_ORDER)[number];

export type IntercomResource = IntercomPhase;

const isIntercomSyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

const SEARCH_PAGE_SIZE = 150;

const ADMIN_ENTITY = 'intercom_admin';
const TEAM_ENTITY = 'intercom_team';
const CONTACT_ENTITY = 'intercom_contact';
const CONVERSATION_ENTITY = 'intercom_conversation';
const CONVERSATION_STATE_EVENT = 'intercom_conversation_state_change';

const REGION_HOSTS: Record<IntercomSettings['region'], string> = {
  us: 'https://api.intercom.io',
  eu: 'https://api.eu.intercom.io',
  au: 'https://api.au.intercom.io',
};

// ---------------------------------------------------------------------------
// API response types
// ---------------------------------------------------------------------------

interface AdminRecord {
  id: string;
  name?: string | null;
  email?: string | null;
  job_title?: string | null;
  away_mode_enabled?: boolean | null;
  has_inbox_seat?: boolean | null;
}

interface AdminListResponse {
  admins: AdminRecord[];
}

interface TeamRecord {
  id: string;
  name?: string | null;
  admin_ids?: number[] | null;
}

interface TeamListResponse {
  teams: TeamRecord[];
}

interface ContactRecord {
  id: string;
  role?: string | null;
  email?: string | null;
  external_id?: string | null;
  created_at?: number | null;
  updated_at?: number | null;
  last_seen_at?: number | null;
}

interface ConversationTagsBlock {
  tags?: Array<{ id?: string | null; name?: string | null }> | null;
}

interface ConversationStatistics {
  first_contact_reply_at?: number | null;
  first_admin_reply_at?: number | null;
  last_assignment_at?: number | null;
  last_admin_reply_at?: number | null;
  last_contact_reply_at?: number | null;
  last_close_at?: number | null;
  count_assignments?: number | null;
  count_reopens?: number | null;
  count_conversation_parts?: number | null;
}

interface ConversationRecord {
  id: string;
  state?: string | null;
  priority?: string | null;
  admin_assignee_id?: number | string | null;
  team_assignee_id?: number | string | null;
  created_at?: number | null;
  updated_at?: number | null;
  snoozed_until?: number | null;
  tags?: ConversationTagsBlock | null;
  statistics?: ConversationStatistics | null;
}

interface SearchPagingBlock {
  next?: { starting_after?: string | null } | null;
}

interface ConversationSearchResponse {
  conversations: ConversationRecord[];
  pages?: SearchPagingBlock | null;
}

interface ContactSearchResponse {
  data: ContactRecord[];
  pages?: SearchPagingBlock | null;
}

// ---------------------------------------------------------------------------
// Schemas — describe the per-resource API response shape consumed by request()
// ---------------------------------------------------------------------------

const idString = z.string().min(1);

const adminSchema = z.object({
  id: idString,
  name: z.string().nullish(),
  email: z.string().nullish(),
  job_title: z.string().nullish(),
  away_mode_enabled: z.boolean().nullish(),
  has_inbox_seat: z.boolean().nullish(),
});

const teamSchema = z.object({
  id: idString,
  name: z.string().nullish(),
  admin_ids: z.array(z.number()).nullish(),
});

const contactSchema = z.object({
  id: idString,
  role: z.string().nullish(),
  email: z.string().nullish(),
  external_id: z.string().nullish(),
  created_at: z.number().nullish(),
  updated_at: z.number().nullish(),
  last_seen_at: z.number().nullish(),
});

const conversationSchema = z.object({
  id: idString,
  state: z.string().nullish(),
  priority: z.string().nullish(),
  admin_assignee_id: z.union([z.number(), z.string()]).nullish(),
  team_assignee_id: z.union([z.number(), z.string()]).nullish(),
  created_at: z.number().nullish(),
  updated_at: z.number().nullish(),
  snoozed_until: z.number().nullish(),
  tags: z
    .object({
      tags: z
        .array(
          z.object({ id: z.string().nullish(), name: z.string().nullish() }),
        )
        .nullish(),
    })
    .nullish(),
  statistics: z
    .object({
      first_contact_reply_at: z.number().nullish(),
      first_admin_reply_at: z.number().nullish(),
      last_assignment_at: z.number().nullish(),
      last_admin_reply_at: z.number().nullish(),
      last_contact_reply_at: z.number().nullish(),
      last_close_at: z.number().nullish(),
      count_assignments: z.number().nullish(),
      count_reopens: z.number().nullish(),
      count_conversation_parts: z.number().nullish(),
    })
    .nullish(),
});

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------

function assigneeIdOrNull(
  value: number | string | null | undefined,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const s = String(value);
  // Intercom returns 0 (number) for unassigned conversations.
  return s === '' || s === '0' ? null : s;
}

function tagNames(tags: ConversationTagsBlock | null | undefined): string[] {
  const list = tags?.tags ?? [];
  const names: string[] = [];
  for (const tag of list) {
    if (tag && typeof tag.name === 'string' && tag.name !== '') {
      names.push(tag.name);
    }
  }
  return names;
}

// Intercom timestamps come as Unix seconds; storage uses Unix milliseconds.
function epochSecToMs(value: number | null | undefined): number | null {
  return parseEpoch(value ?? null, 's');
}

function epochSecToMsOrZero(value: number | null | undefined): number {
  return epochSecToMs(value) ?? 0;
}

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

const intercomResources = defineResources({
  [ADMIN_ENTITY]: {
    shape: 'entity',
    description: 'Intercom teammates (admins) with seat and away state.',
    endpoint: 'GET /admins',
    fields: [
      { name: 'name', description: 'Admin display name.' },
      { name: 'email', description: 'Admin email address.' },
      { name: 'jobTitle', description: 'Admin job title.' },
      { name: 'awayMode', description: 'Whether away mode is enabled.' },
      {
        name: 'hasInboxSeat',
        description: 'Whether the admin has an inbox seat.',
      },
    ],
    responses: { admins: z.array(adminSchema) },
  },
  [TEAM_ENTITY]: {
    shape: 'entity',
    description: 'Inbox teams and their admin membership counts.',
    endpoint: 'GET /teams',
    fields: [
      { name: 'name', description: 'Team name.' },
      { name: 'adminCount', description: 'Number of admins on the team.' },
    ],
    responses: { teams: z.array(teamSchema) },
  },
  [CONTACT_ENTITY]: {
    shape: 'entity',
    description: 'Contacts (users and leads) with role and last-seen time.',
    endpoint: 'POST /contacts/search',
    fields: [
      { name: 'role', description: 'Contact role (user or lead).' },
      { name: 'email', description: 'Contact email address.' },
      {
        name: 'externalId',
        description: 'Your external identifier for the contact.',
      },
      {
        name: 'createdAt',
        description: 'When the contact was created (Unix ms).',
      },
      {
        name: 'lastSeenAt',
        description: 'When the contact was last seen (Unix ms).',
      },
    ],
    responses: { contacts: z.array(contactSchema) },
  },
  [CONVERSATION_ENTITY]: {
    shape: 'entity',
    description:
      'Conversations with state, priority, assignment, reply-time statistics, and tags.',
    endpoint: 'POST /conversations/search',
    fields: [
      {
        name: 'state',
        description: 'Conversation state (open, snoozed, closed).',
      },
      { name: 'priority', description: 'Conversation priority.' },
      {
        name: 'adminAssigneeId',
        description: 'Assigned admin id (null if unassigned).',
      },
      {
        name: 'teamAssigneeId',
        description: 'Assigned team id (null if unassigned).',
      },
      {
        name: 'createdAt',
        description: 'When the conversation was created (Unix ms).',
      },
      {
        name: 'firstContactReplyAt',
        description: 'First contact reply time (Unix ms).',
      },
      {
        name: 'firstAdminReplyAt',
        description: 'First admin reply time (Unix ms).',
      },
      {
        name: 'snoozedUntil',
        description: 'Snooze expiry time (Unix ms), if snoozed.',
      },
      { name: 'countAssignments', description: 'Number of assignments.' },
      { name: 'countReopens', description: 'Number of reopens.' },
      {
        name: 'countConversationParts',
        description: 'Number of conversation parts.',
      },
      {
        name: 'tags',
        description: 'Flat list of tag names on the conversation.',
      },
    ],
    responses: { conversations: z.array(conversationSchema) },
  },
  [CONVERSATION_STATE_EVENT]: {
    shape: 'event',
    description:
      'State-change events (created / assigned / closed / snoozed) derived from each conversation.',
    endpoint: 'POST /conversations/search',
    notes:
      'Derived from each conversation’s statistics block; the scope is cleared and rewritten on every sync.',
    fields: [
      {
        name: 'conversationId',
        description: 'The conversation the event belongs to.',
      },
      {
        name: 'transition',
        description: 'created, assigned, closed, or snoozed.',
      },
      { name: 'state', description: 'Conversation state at sync time.' },
      { name: 'priority', description: 'Conversation priority at sync time.' },
      {
        name: 'adminAssigneeId',
        description: 'Assigned admin id (null if unassigned).',
      },
      {
        name: 'teamAssigneeId',
        description: 'Assigned team id (null if unassigned).',
      },
    ],
    responses: { conversation_events: z.array(conversationSchema) },
  },
});

// ---------------------------------------------------------------------------
// IntercomConnector
// ---------------------------------------------------------------------------

export class IntercomConnector extends BaseConnector<
  IntercomSettings,
  IntercomCredentials
> {
  static readonly id = 'intercom';

  static readonly resources = intercomResources;

  static readonly schemas = schemasFromResources(intercomResources);

  static create(input: unknown, ctx?: ConnectorContext): IntercomConnector {
    const parsed = configFields.parse(input);
    return new IntercomConnector(
      {
        apiVersion: parsed.apiVersion,
        region: parsed.region,
        resources: parsed.resources,
      },
      { accessToken: parsed.accessToken },
      ctx,
    );
  }

  readonly id = 'intercom';
  override readonly credentials = intercomCredentials;

  private get baseUrl(): string {
    return REGION_HOSTS[this.settings.region];
  }

  private buildHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.creds.accessToken}`,
      'Intercom-Version': this.settings.apiVersion,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': connectorUserAgent('intercom'),
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

  private apiPost<T>(
    url: string,
    resource: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<HttpResponse<T>> {
    return this.post<T>(url, {
      resource,
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
      signal,
    });
  }

  // -------------------------------------------------------------------------
  // admins — GET /admins (single page, not paginated)
  // -------------------------------------------------------------------------

  private async fetchAdmins(
    page: string | null,
    signal?: AbortSignal,
  ): Promise<{ items: unknown[]; next: string | null }> {
    if (page !== null) {
      // Single-page resource; only fetched when cursor is null.
      return { items: [], next: null };
    }
    const res = await this.apiGet<AdminListResponse>(
      `${this.baseUrl}/admins`,
      'admins',
      signal,
    );
    return { items: res.body.admins ?? [], next: null };
  }

  private async writeAdmins(
    storage: StorageHandle,
    items: AdminRecord[],
  ): Promise<void> {
    for (const admin of items) {
      await storage.entity({
        type: ADMIN_ENTITY,
        id: admin.id,
        attributes: {
          name: admin.name ?? null,
          email: admin.email ?? null,
          jobTitle: admin.job_title ?? null,
          awayMode: admin.away_mode_enabled ?? null,
          hasInboxSeat: admin.has_inbox_seat ?? null,
        },
        // Admins have no updatedAt in the API; stamp with sync time so newer
        // syncs win on conflict.
        updated_at: Date.now(),
      });
    }
  }

  // -------------------------------------------------------------------------
  // teams — GET /teams (single page, not paginated)
  // -------------------------------------------------------------------------

  private async fetchTeams(
    page: string | null,
    signal?: AbortSignal,
  ): Promise<{ items: unknown[]; next: string | null }> {
    if (page !== null) {
      return { items: [], next: null };
    }
    const res = await this.apiGet<TeamListResponse>(
      `${this.baseUrl}/teams`,
      'teams',
      signal,
    );
    return { items: res.body.teams ?? [], next: null };
  }

  private async writeTeams(
    storage: StorageHandle,
    items: TeamRecord[],
  ): Promise<void> {
    for (const team of items) {
      await storage.entity({
        type: TEAM_ENTITY,
        id: team.id,
        attributes: {
          name: team.name ?? null,
          adminCount: team.admin_ids?.length ?? 0,
        },
        updated_at: Date.now(),
      });
    }
  }

  // -------------------------------------------------------------------------
  // contacts — POST /contacts/search (cursor-paginated)
  // -------------------------------------------------------------------------

  private buildContactSearchBody(
    startingAfter: string | null,
    options: SyncOptions,
  ): Record<string, unknown> {
    const sinceSec = sinceUnixSec(options);
    const body: Record<string, unknown> = {
      pagination: {
        per_page: SEARCH_PAGE_SIZE,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      },
      sort: { field: 'updated_at', order: 'ascending' },
    };
    if (sinceSec !== null) {
      body['query'] = {
        field: 'updated_at',
        operator: '>',
        value: sinceSec,
      };
    }
    return body;
  }

  private async fetchContacts(
    page: string | null,
    options: SyncOptions,
    signal?: AbortSignal,
  ): Promise<{ items: unknown[]; next: string | null }> {
    const res = await this.apiPost<ContactSearchResponse>(
      `${this.baseUrl}/contacts/search`,
      'contacts',
      this.buildContactSearchBody(page, options),
      signal,
    );
    return {
      items: res.body.data ?? [],
      next: res.body.pages?.next?.starting_after ?? null,
    };
  }

  private async writeContacts(
    storage: StorageHandle,
    items: ContactRecord[],
  ): Promise<void> {
    for (const contact of items) {
      await storage.entity({
        type: CONTACT_ENTITY,
        id: contact.id,
        attributes: {
          role: contact.role ?? null,
          email: contact.email ?? null,
          externalId: contact.external_id ?? null,
          createdAt: epochSecToMs(contact.created_at),
          lastSeenAt: epochSecToMs(contact.last_seen_at),
        },
        updated_at: epochSecToMsOrZero(
          contact.updated_at ?? contact.created_at,
        ),
      });
    }
  }

  // -------------------------------------------------------------------------
  // conversations — POST /conversations/search (entities)
  // -------------------------------------------------------------------------

  private buildConversationSearchBody(
    startingAfter: string | null,
    options: SyncOptions,
  ): Record<string, unknown> {
    const sinceSec = sinceUnixSec(options);
    const body: Record<string, unknown> = {
      pagination: {
        per_page: SEARCH_PAGE_SIZE,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      },
      sort: { field: 'updated_at', order: 'ascending' },
    };
    if (sinceSec !== null) {
      body['query'] = {
        field: 'updated_at',
        operator: '>',
        value: sinceSec,
      };
    }
    return body;
  }

  private async fetchConversations(
    page: string | null,
    resource: 'conversations' | 'conversation_events',
    options: SyncOptions,
    signal?: AbortSignal,
  ): Promise<{ items: unknown[]; next: string | null }> {
    // conversation_events clears and rewrites its whole scope on every sync
    // (events can't be upserted by key), so it must re-fetch every conversation
    // even on incremental ticks — otherwise a `since` filter would drop the
    // historical events for conversations untouched in this window.
    const fetchOptions =
      resource === 'conversation_events'
        ? { ...options, since: undefined }
        : options;
    const res = await this.apiPost<ConversationSearchResponse>(
      `${this.baseUrl}/conversations/search`,
      resource,
      this.buildConversationSearchBody(page, fetchOptions),
      signal,
    );
    return {
      items: res.body.conversations ?? [],
      next: res.body.pages?.next?.starting_after ?? null,
    };
  }

  private async writeConversations(
    storage: StorageHandle,
    items: ConversationRecord[],
  ): Promise<void> {
    for (const conv of items) {
      const stats = conv.statistics ?? {};
      const attributes: Record<string, JSONValue> = {
        state: conv.state ?? null,
        priority: conv.priority ?? null,
        adminAssigneeId: assigneeIdOrNull(conv.admin_assignee_id),
        teamAssigneeId: assigneeIdOrNull(conv.team_assignee_id),
        createdAt: epochSecToMs(conv.created_at),
        firstContactReplyAt: epochSecToMs(stats.first_contact_reply_at),
        firstAdminReplyAt: epochSecToMs(stats.first_admin_reply_at),
        snoozedUntil: epochSecToMs(conv.snoozed_until),
        countAssignments: stats.count_assignments ?? null,
        countReopens: stats.count_reopens ?? null,
        countConversationParts: stats.count_conversation_parts ?? null,
        tags: tagNames(conv.tags),
      };
      await storage.entity({
        type: CONVERSATION_ENTITY,
        id: conv.id,
        attributes,
        updated_at: epochSecToMsOrZero(conv.updated_at ?? conv.created_at),
      });
    }
  }

  // -------------------------------------------------------------------------
  // conversation_events — derived from the same /conversations/search payload
  // -------------------------------------------------------------------------

  private async writeConversationEvents(
    storage: StorageHandle,
    items: ConversationRecord[],
  ): Promise<void> {
    for (const conv of items) {
      const stats = conv.statistics ?? {};
      const baseAttrs: Record<string, JSONValue> = {
        conversationId: conv.id,
        state: conv.state ?? null,
        priority: conv.priority ?? null,
        teamAssigneeId: assigneeIdOrNull(conv.team_assignee_id),
        adminAssigneeId: assigneeIdOrNull(conv.admin_assignee_id),
      };

      const createdMs = epochSecToMs(conv.created_at);
      if (createdMs !== null) {
        await storage.event({
          name: CONVERSATION_STATE_EVENT,
          start_ts: createdMs,
          end_ts: null,
          attributes: { ...baseAttrs, transition: 'created' },
        });
      }

      const assignedMs = epochSecToMs(stats.last_assignment_at);
      if (assignedMs !== null) {
        await storage.event({
          name: CONVERSATION_STATE_EVENT,
          start_ts: assignedMs,
          end_ts: null,
          attributes: { ...baseAttrs, transition: 'assigned' },
        });
      }

      const closedMs = epochSecToMs(stats.last_close_at);
      if (closedMs !== null) {
        await storage.event({
          name: CONVERSATION_STATE_EVENT,
          start_ts: closedMs,
          end_ts: null,
          attributes: { ...baseAttrs, transition: 'closed' },
        });
      }

      const snoozedMs = epochSecToMs(conv.snoozed_until);
      if (snoozedMs !== null && conv.state === 'snoozed') {
        await storage.event({
          name: CONVERSATION_STATE_EVENT,
          start_ts: snoozedMs,
          end_ts: null,
          attributes: { ...baseAttrs, transition: 'snoozed' },
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Scope clearing (idempotency)
  // -------------------------------------------------------------------------

  private async clearScopeOnFirstPage(
    storage: StorageHandle,
    phase: IntercomPhase,
    isFull: boolean,
  ): Promise<void> {
    if (phase === 'conversation_events') {
      // Events can't be upserted by key, so the only way to keep a sync
      // idempotent is to wipe the scope and rewrite from the freshly fetched
      // statistics. Cheap because the scope is per-name.
      await storage.events([], { names: [CONVERSATION_STATE_EVENT] });
      return;
    }
    if (!isFull) {
      // Entity phases upsert by id, so incremental ticks just overwrite the
      // records they touch — no need to drop the rest of the entity scope.
      return;
    }
    const entityType = ENTITY_TYPE_BY_PHASE[phase];
    if (entityType) {
      await storage.entities([], { types: [entityType] });
    }
  }

  private async writePhase(
    storage: StorageHandle,
    phase: IntercomPhase,
    items: unknown[],
  ): Promise<void> {
    switch (phase) {
      case 'admins':
        await this.writeAdmins(storage, items as AdminRecord[]);
        return;
      case 'teams':
        await this.writeTeams(storage, items as TeamRecord[]);
        return;
      case 'contacts':
        await this.writeContacts(storage, items as ContactRecord[]);
        return;
      case 'conversations':
        await this.writeConversations(storage, items as ConversationRecord[]);
        return;
      case 'conversation_events':
        await this.writeConversationEvents(
          storage,
          items as ConversationRecord[],
        );
        return;
    }
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const cursor = isIntercomSyncCursor(options.cursor)
      ? options.cursor
      : undefined;
    const isFull = options.mode === 'full';

    const phases = selectActivePhases<IntercomResource, IntercomPhase>(
      (r) => r,
      PHASE_ORDER,
      this.settings.resources,
    );

    return paginateChunked<IntercomPhase, string>({
      phases,
      cursor,
      signal,
      logger: this.logger,
      fetchPage: async (phase, page, sig) => {
        switch (phase) {
          case 'admins':
            return this.fetchAdmins(page, sig);
          case 'teams':
            return this.fetchTeams(page, sig);
          case 'contacts':
            return this.fetchContacts(page, options, sig);
          case 'conversations':
          case 'conversation_events':
            return this.fetchConversations(page, phase, options, sig);
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

const ENTITY_TYPE_BY_PHASE: Partial<Record<IntercomPhase, string>> = {
  admins: ADMIN_ENTITY,
  teams: TEAM_ENTITY,
  contacts: CONTACT_ENTITY,
  conversations: CONVERSATION_ENTITY,
};

// Intercom search filters use Unix seconds, while SyncOptions.since is an
// ISO timestamp. Returns null when no incremental window applies, which keeps
// the search body free of a no-op filter clause.
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
