import {
  type HttpResponse,
  connectorUserAgent,
  parseEpoch,
} from '@rawdash/connector-shared';
import {
  BaseConnector,
  type ChunkedSyncCursor,
  type ConnectorContext,
  type ConnectorDoc,
  type CredentialsSchema,
  type FetchPageResult,
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
        'WorkOS API key (server-side, starts with `sk_`). Used as a bearer token on every request. Read-only access is sufficient for sync.',
      placeholder: 'WORKOS_API_KEY',
      secret: true,
    }),
    resources: z
      .array(
        z.enum(['organizations', 'connections', 'directories', 'auth_events']),
      )
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          'Which WorkOS resources to sync. Omit to sync all of them.',
      }),
    authEventsLookbackDays: z
      .number()
      .int()
      .positive()
      .max(90)
      .optional()
      .meta({
        label: 'Auth events lookback (days)',
        description:
          'On a full sync (and when no incremental cursor is available), how many days of authentication events to fetch. Defaults to 30. Caps at 90.',
        placeholder: '30',
      }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'WorkOS',
  category: 'security',
  brandColor: '#6363F1',
  tagline:
    'Sync organizations, SSO connections, directory-sync directories, and authentication events from a WorkOS workspace for B2B SaaS onboarding and SSO-activity dashboards.',
  vendor: {
    name: 'WorkOS',
    domain: 'workos.com',
    apiDocs: 'https://workos.com/docs/reference',
    website: 'https://workos.com',
  },
  auth: {
    summary:
      'A WorkOS API key (server-side, starts with `sk_`) is required. It is sent as a bearer token on every request and never leaves the workspace.',
    setup: [
      'Sign in to the WorkOS Dashboard and switch to the environment (Sandbox or Production) you want to sync.',
      'Open API Keys in the left navigation.',
      'Create a new secret key (or copy an existing one). WorkOS only shows the secret once on creation.',
      'Store it as a rawdash secret and reference it from the connector config as `apiKey: secret("WORKOS_API_KEY")`.',
    ],
  },
  rateLimit:
    'WorkOS list endpoints return X-RateLimit-Remaining and X-RateLimit-Reset (Unix seconds) headers when throttling kicks in; the shared HTTP client falls back to Retry-After on 429.',
  limitations: [
    'Authentication events use the WorkOS Events API filtered to authentication.* event types (sign-in success and failure across SSO, OAuth, password, magic auth, MFA). Other event categories (dsync.*, organization.*) are not synced.',
    'Organizations, connections, and directories are fetched in full on every sync; the WorkOS list endpoints do not expose a server-side updated_at filter, so the scope is cleared and rewritten on full syncs and left untouched on incremental syncs.',
    'Directory-sync user and group rows are out of scope; this connector tracks the directory entities themselves, not their imported memberships.',
  ],
});

export type WorkOSResource =
  | 'organizations'
  | 'connections'
  | 'directories'
  | 'auth_events';

export interface WorkOSSettings {
  resources?: readonly WorkOSResource[];
  authEventsLookbackDays?: number;
}

const workosCredentials = {
  apiKey: {
    description: 'WorkOS API key',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type WorkOSCredentials = typeof workosCredentials;

const PHASE_ORDER = [
  'organizations',
  'connections',
  'directories',
  'auth_events',
] as const;

type WorkOSPhase = (typeof PHASE_ORDER)[number];

type WorkOSSyncCursor = ChunkedSyncCursor<WorkOSPhase, string>;

const isWorkOSSyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

const ORGANIZATION_ENTITY = 'workos_organization';
const CONNECTION_ENTITY = 'workos_connection';
const DIRECTORY_ENTITY = 'workos_directory';
const AUTH_EVENT = 'workos_auth_event';

const PAGE_SIZE = 100;
const DEFAULT_AUTH_LOOKBACK_DAYS = 30;
const BASE_URL = 'https://api.workos.com';

const AUTH_EVENT_TYPES = [
  'authentication.email_verification_succeeded',
  'authentication.magic_auth_succeeded',
  'authentication.magic_auth_failed',
  'authentication.mfa_succeeded',
  'authentication.mfa_failed',
  'authentication.oauth_succeeded',
  'authentication.oauth_failed',
  'authentication.password_succeeded',
  'authentication.password_failed',
  'authentication.sso_succeeded',
  'authentication.sso_failed',
] as const;

type AuthEventType = (typeof AUTH_EVENT_TYPES)[number];

const idString = z.string().min(1);

const listMetadataSchema = z.object({
  before: z.string().nullish(),
  after: z.string().nullish(),
});

const organizationDomainSchema = z.object({
  domain: z.string(),
  state: z.string().nullish(),
});

const organizationSchema = z.object({
  id: idString,
  name: z.string(),
  domains: z.array(organizationDomainSchema).nullish(),
  allow_profiles_outside_organization: z.boolean().nullish(),
  created_at: z.string(),
  updated_at: z.string().nullish(),
});

const organizationsResponseSchema = z.object({
  data: z.array(organizationSchema),
  list_metadata: listMetadataSchema,
});

const connectionSchema = z.object({
  id: idString,
  name: z.string(),
  organization_id: z.string().nullish(),
  connection_type: z.string(),
  state: z.string().nullish(),
  status: z.string().nullish(),
  created_at: z.string(),
  updated_at: z.string().nullish(),
});

const connectionsResponseSchema = z.object({
  data: z.array(connectionSchema),
  list_metadata: listMetadataSchema,
});

const directorySchema = z.object({
  id: idString,
  name: z.string(),
  organization_id: z.string().nullish(),
  type: z.string(),
  state: z.string().nullish(),
  created_at: z.string(),
  updated_at: z.string().nullish(),
});

const directoriesResponseSchema = z.object({
  data: z.array(directorySchema),
  list_metadata: listMetadataSchema,
});

const eventSchema = z.object({
  id: idString,
  event: z.string(),
  created_at: z.string(),
  data: z
    .object({
      organization_id: z.string().nullish(),
      user_id: z.string().nullish(),
      email: z.string().nullish(),
      ip_address: z.string().nullish(),
      connection_id: z.string().nullish(),
      connection_type: z.string().nullish(),
    })
    .passthrough()
    .nullish(),
});

const eventsResponseSchema = z.object({
  data: z.array(eventSchema),
  list_metadata: listMetadataSchema,
});

export const workosResources = defineResources({
  [ORGANIZATION_ENTITY]: {
    shape: 'entity',
    filterable: [],
    description:
      'WorkOS organizations (tenants) with their display name, domains, and creation timestamp.',
    endpoint: 'GET /organizations',
    fields: [
      { name: 'name', description: 'Organization display name.' },
      {
        name: 'domains',
        description:
          'Comma-separated list of domains attached to the organization.',
      },
      {
        name: 'createdAt',
        description: 'When the organization was created (Unix ms).',
      },
    ],
    responses: { organizations: organizationsResponseSchema },
  },
  [CONNECTION_ENTITY]: {
    shape: 'entity',
    filterable: [
      {
        field: 'state',
        ops: ['eq'],
        values: ['active', 'inactive', 'draft', 'linked', 'unlinked'],
      },
      { field: 'connectionType', ops: ['eq'] },
    ],
    description:
      'WorkOS SSO connections (one per identity provider per organization) with their type, state, and parent organization.',
    endpoint: 'GET /connections',
    fields: [
      {
        name: 'connectionType',
        description: 'Connection type (e.g. OktaSAML, AzureSAML, GoogleOAuth).',
      },
      {
        name: 'organizationId',
        description: 'WorkOS organization that owns the connection.',
      },
      {
        name: 'state',
        description:
          'Lifecycle state (active, inactive, draft, linked, unlinked).',
      },
      { name: 'name', description: 'Connection display name.' },
      {
        name: 'createdAt',
        description: 'When the connection was created (Unix ms).',
      },
    ],
    responses: { connections: connectionsResponseSchema },
  },
  [DIRECTORY_ENTITY]: {
    shape: 'entity',
    filterable: [
      {
        field: 'state',
        ops: ['eq'],
        values: ['active', 'inactive', 'validating', 'linked', 'unlinked'],
      },
      { field: 'directoryType', ops: ['eq'] },
    ],
    description:
      'WorkOS directory-sync directories (SCIM/HRIS feeds) with their type, state, and parent organization.',
    endpoint: 'GET /directories',
    fields: [
      {
        name: 'directoryType',
        description:
          'Directory provider type (e.g. okta scim v2.0, azure scim v2.0, bamboohr).',
      },
      {
        name: 'organizationId',
        description: 'WorkOS organization that owns the directory.',
      },
      {
        name: 'state',
        description:
          'Lifecycle state (active, inactive, validating, linked, unlinked).',
      },
      { name: 'name', description: 'Directory display name.' },
      {
        name: 'createdAt',
        description: 'When the directory was created (Unix ms).',
      },
    ],
    responses: { directories: directoriesResponseSchema },
  },
  [AUTH_EVENT]: {
    shape: 'event',
    filterable: [
      { field: 'eventType', ops: ['eq'], values: [...AUTH_EVENT_TYPES] },
    ],
    description:
      'Authentication events from the WorkOS Events API (SSO, OAuth, password, magic auth, and MFA sign-in successes and failures).',
    endpoint: 'GET /events',
    notes:
      'Filtered to the authentication.* event family. Incremental syncs pass `range_start` so only events newer than the watermark are returned.',
    fields: [
      {
        name: 'eventType',
        description: 'WorkOS event name (authentication.sso_succeeded, etc).',
      },
      {
        name: 'outcome',
        description: '"succeeded" or "failed" derived from the event suffix.',
      },
      {
        name: 'method',
        description:
          'Authentication method (sso, oauth, password, magic_auth, mfa, email_verification).',
      },
      {
        name: 'organizationId',
        description: 'WorkOS organization the event belongs to (may be null).',
      },
      {
        name: 'userId',
        description: 'WorkOS user id involved in the event (may be null).',
      },
      {
        name: 'connectionId',
        description: 'WorkOS connection id used for the event (may be null).',
      },
      {
        name: 'connectionType',
        description:
          'Connection type used for the event (may be null for non-SSO methods).',
      },
      {
        name: 'ipAddress',
        description: 'Client IP captured by WorkOS (may be null).',
      },
    ],
    responses: { auth_events: eventsResponseSchema },
  },
});

export const id = 'workos';

type OrganizationsResponse = z.infer<typeof organizationsResponseSchema>;
type ConnectionsResponse = z.infer<typeof connectionsResponseSchema>;
type DirectoriesResponse = z.infer<typeof directoriesResponseSchema>;
type EventsResponse = z.infer<typeof eventsResponseSchema>;

type WorkOSOrganization = z.infer<typeof organizationSchema>;
type WorkOSConnection = z.infer<typeof connectionSchema>;
type WorkOSDirectory = z.infer<typeof directorySchema>;
type WorkOSEvent = z.infer<typeof eventSchema>;

interface FetchedPage<T> {
  items: T[];
  next: string | null;
}

function isoToMs(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  return parseEpoch(value, 'iso');
}

function isoToMsOrZero(value: string | null | undefined): number {
  return isoToMs(value) ?? 0;
}

function summarizeDomains(
  domains: WorkOSOrganization['domains'],
): string | null {
  if (!domains || domains.length === 0) {
    return null;
  }
  return domains.map((d) => d.domain).join(', ');
}

function deriveOutcome(eventType: string): 'succeeded' | 'failed' | null {
  if (eventType.endsWith('_succeeded')) {
    return 'succeeded';
  }
  if (eventType.endsWith('_failed')) {
    return 'failed';
  }
  return null;
}

function deriveMethod(eventType: string): string | null {
  const m = /^authentication\.(.+?)_(?:succeeded|failed)$/.exec(eventType);
  return m ? m[1]! : null;
}

function isAuthEventType(value: string): value is AuthEventType {
  return (AUTH_EVENT_TYPES as readonly string[]).includes(value);
}

function lookbackStartIso(days: number): string {
  const ts = Date.now() - days * 24 * 60 * 60 * 1000;
  return new Date(ts).toISOString();
}

export class WorkOSConnector extends BaseConnector<
  WorkOSSettings,
  WorkOSCredentials
> {
  static readonly id = id;

  static readonly resources = workosResources;

  static readonly schemas = schemasFromResources(workosResources);

  static create(input: unknown, ctx?: ConnectorContext): WorkOSConnector {
    const parsed = configFields.parse(input);
    return new WorkOSConnector(
      {
        resources: parsed.resources,
        authEventsLookbackDays: parsed.authEventsLookbackDays,
      },
      { apiKey: parsed.apiKey },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = workosCredentials;

  private buildHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.creds.apiKey}`,
      Accept: 'application/json',
      'User-Agent': connectorUserAgent('workos'),
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

  private buildListUrl(
    path: string,
    after: string | null,
    extra: Record<string, string> = {},
  ): string {
    const url = new URL(`${BASE_URL}${path}`);
    url.searchParams.set('limit', String(PAGE_SIZE));
    url.searchParams.set('order', 'asc');
    if (after) {
      url.searchParams.set('after', after);
    }
    for (const [k, v] of Object.entries(extra)) {
      url.searchParams.append(k, v);
    }
    return url.toString();
  }

  private buildEventsUrl(after: string | null, options: SyncOptions): string {
    const url = new URL(`${BASE_URL}/events`);
    url.searchParams.set('limit', String(PAGE_SIZE));
    for (const t of AUTH_EVENT_TYPES) {
      url.searchParams.append('events', t);
    }
    if (after) {
      url.searchParams.set('after', after);
    } else {
      const rangeStart = options.since ?? this.defaultEventsRangeStart();
      url.searchParams.set('range_start', rangeStart);
    }
    return url.toString();
  }

  private defaultEventsRangeStart(): string {
    const days =
      this.settings.authEventsLookbackDays ?? DEFAULT_AUTH_LOOKBACK_DAYS;
    return lookbackStartIso(days);
  }

  private async fetchOrganizationsPage(
    page: string | null,
    signal: AbortSignal | undefined,
  ): Promise<FetchedPage<WorkOSOrganization>> {
    const url = this.buildListUrl('/organizations', page);
    const res = await this.apiGet<OrganizationsResponse>(
      url,
      'organizations',
      signal,
    );
    const next = res.body.list_metadata.after ?? null;
    return { items: res.body.data, next };
  }

  private async fetchConnectionsPage(
    page: string | null,
    signal: AbortSignal | undefined,
  ): Promise<FetchedPage<WorkOSConnection>> {
    const url = this.buildListUrl('/connections', page);
    const res = await this.apiGet<ConnectionsResponse>(
      url,
      'connections',
      signal,
    );
    const next = res.body.list_metadata.after ?? null;
    return { items: res.body.data, next };
  }

  private async fetchDirectoriesPage(
    page: string | null,
    signal: AbortSignal | undefined,
  ): Promise<FetchedPage<WorkOSDirectory>> {
    const url = this.buildListUrl('/directories', page);
    const res = await this.apiGet<DirectoriesResponse>(
      url,
      'directories',
      signal,
    );
    const next = res.body.list_metadata.after ?? null;
    return { items: res.body.data, next };
  }

  private async fetchEventsPage(
    page: string | null,
    options: SyncOptions,
    signal: AbortSignal | undefined,
  ): Promise<FetchedPage<WorkOSEvent>> {
    const url = this.buildEventsUrl(page, options);
    const res = await this.apiGet<EventsResponse>(url, 'auth_events', signal);
    const next = res.body.list_metadata.after ?? null;
    return { items: res.body.data, next };
  }

  private async fetchPhasePage(
    phase: WorkOSPhase,
    page: string | null,
    options: SyncOptions,
    signal?: AbortSignal,
  ): Promise<FetchPageResult<string>> {
    switch (phase) {
      case 'organizations':
        return this.fetchOrganizationsPage(page, signal);
      case 'connections':
        return this.fetchConnectionsPage(page, signal);
      case 'directories':
        return this.fetchDirectoriesPage(page, signal);
      case 'auth_events':
        return this.fetchEventsPage(page, options, signal);
    }
  }

  private async writeOrganizations(
    storage: StorageHandle,
    items: WorkOSOrganization[],
  ): Promise<void> {
    for (const org of items) {
      await storage.entity({
        type: ORGANIZATION_ENTITY,
        id: org.id,
        attributes: {
          name: org.name,
          domains: summarizeDomains(org.domains),
          createdAt: isoToMs(org.created_at),
        },
        updated_at: isoToMsOrZero(org.updated_at ?? org.created_at),
      });
    }
  }

  private async writeConnections(
    storage: StorageHandle,
    items: WorkOSConnection[],
  ): Promise<void> {
    for (const c of items) {
      await storage.entity({
        type: CONNECTION_ENTITY,
        id: c.id,
        attributes: {
          name: c.name,
          connectionType: c.connection_type,
          organizationId: c.organization_id ?? null,
          state: c.state ?? c.status ?? null,
          createdAt: isoToMs(c.created_at),
        },
        updated_at: isoToMsOrZero(c.updated_at ?? c.created_at),
      });
    }
  }

  private async writeDirectories(
    storage: StorageHandle,
    items: WorkOSDirectory[],
  ): Promise<void> {
    for (const d of items) {
      await storage.entity({
        type: DIRECTORY_ENTITY,
        id: d.id,
        attributes: {
          name: d.name,
          directoryType: d.type,
          organizationId: d.organization_id ?? null,
          state: d.state ?? null,
          createdAt: isoToMs(d.created_at),
        },
        updated_at: isoToMsOrZero(d.updated_at ?? d.created_at),
      });
    }
  }

  private async writeAuthEvents(
    storage: StorageHandle,
    items: WorkOSEvent[],
    sinceMs: number | null,
  ): Promise<void> {
    for (const ev of items) {
      if (!isAuthEventType(ev.event)) {
        continue;
      }
      const ts = isoToMs(ev.created_at);
      if (ts === null) {
        continue;
      }
      if (sinceMs !== null && ts <= sinceMs) {
        continue;
      }
      const data = ev.data ?? {};
      const attributes: Record<string, JSONValue> = {
        eventType: ev.event,
        outcome: deriveOutcome(ev.event),
        method: deriveMethod(ev.event),
        organizationId: data.organization_id ?? null,
        userId: data.user_id ?? null,
        connectionId: data.connection_id ?? null,
        connectionType: data.connection_type ?? null,
        ipAddress: data.ip_address ?? null,
        eventId: ev.id,
      };
      await storage.event({
        name: AUTH_EVENT,
        start_ts: ts,
        end_ts: null,
        attributes,
      });
    }
  }

  private async clearScopeOnFirstPage(
    storage: StorageHandle,
    phase: WorkOSPhase,
    isFull: boolean,
  ): Promise<void> {
    if (!isFull) {
      return;
    }
    switch (phase) {
      case 'organizations':
        await storage.entities([], { types: [ORGANIZATION_ENTITY] });
        return;
      case 'connections':
        await storage.entities([], { types: [CONNECTION_ENTITY] });
        return;
      case 'directories':
        await storage.entities([], { types: [DIRECTORY_ENTITY] });
        return;
      case 'auth_events':
        await storage.events([], { names: [AUTH_EVENT] });
        return;
    }
  }

  private async writePhase(
    storage: StorageHandle,
    phase: WorkOSPhase,
    items: unknown[],
    sinceMs: number | null,
  ): Promise<void> {
    switch (phase) {
      case 'organizations':
        return this.writeOrganizations(storage, items as WorkOSOrganization[]);
      case 'connections':
        return this.writeConnections(storage, items as WorkOSConnection[]);
      case 'directories':
        return this.writeDirectories(storage, items as WorkOSDirectory[]);
      case 'auth_events':
        return this.writeAuthEvents(storage, items as WorkOSEvent[], sinceMs);
    }
  }

  private resolveCursor(cursor: unknown): WorkOSSyncCursor | undefined {
    return isWorkOSSyncCursor(cursor) ? cursor : undefined;
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const cursor = this.resolveCursor(options.cursor);
    const isFull = options.mode === 'full';
    const sinceMs = options.since ? Date.parse(options.since) : null;
    const sinceMsOrNull =
      sinceMs !== null && Number.isFinite(sinceMs) ? sinceMs : null;

    const phases = selectActivePhases<WorkOSResource, WorkOSPhase>(
      (r) => r,
      PHASE_ORDER,
      this.settings.resources,
    );

    return paginateChunked<WorkOSPhase, string>({
      phases,
      cursor,
      signal,
      logger: this.logger,
      fetchPage: async (phase, page, sig) =>
        this.fetchPhasePage(phase, page, options, sig),
      writeBatch: async (phase, items, page) => {
        if (page === null) {
          await this.clearScopeOnFirstPage(storage, phase, isFull);
        }
        await this.writePhase(storage, phase, items, sinceMsOrNull);
      },
    });
  }
}
