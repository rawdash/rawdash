import {
  type HttpResponse,
  connectorUserAgent,
  parseLinkHeader,
  sanitizeAllowedUrl,
  standardRateLimitPolicy,
} from '@rawdash/connector-shared';
import {
  BaseConnector,
  type ChunkedSyncCursor,
  type ConnectorContext,
  type ConnectorDoc,
  type CredentialsSchema,
  type FetchPageResult,
  type FetchSpec,
  type FilterClause,
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

// Okta org hosts look like `acme.okta.com`, `acme.oktapreview.com`, or a
// custom domain that points at the org. Reject schemes/paths so the
// per-page Link sanitizer has something stable to anchor against.
const HOST_PATTERN = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i;

export const configFields = defineConfigFields(
  z.object({
    host: z
      .string()
      .trim()
      .min(1)
      .regex(
        HOST_PATTERN,
        'Use the org host only (e.g. "acme.okta.com"), without the protocol or path.',
      )
      .meta({
        label: 'Org host',
        description:
          'Your Okta org hostname, e.g. "acme.okta.com" or "acme.oktapreview.com". Do not include the protocol or trailing slash.',
        placeholder: 'acme.okta.com',
      }),
    apiToken: z.object({ $secret: z.string().min(1) }).meta({
      label: 'API token',
      description:
        'Okta API token (SSWS). Create one at Security -> API -> Tokens. Read-only access to Users, Groups, and the System Log is sufficient.',
      placeholder: '00aBcD...',
      secret: true,
    }),
    resources: z
      .array(z.enum(['users', 'groups', 'auth_events']))
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          'Which Okta resources to sync. Omit to sync all of them. The API token only needs read scopes for the resources listed here.',
      }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'Okta',
  category: 'security',
  brandColor: '#007DC1',
  tagline:
    'Sync users, groups, and authentication events from an Okta org for sign-in volume, sign-in failure rate, and MFA enrollment analytics.',
  vendor: {
    name: 'Okta',
    domain: 'okta.com',
    apiDocs: 'https://developer.okta.com/docs/reference/',
    website: 'https://www.okta.com',
  },
  auth: {
    summary:
      'An Okta API token (SSWS) is required. Tokens inherit the permissions of the admin who created them, so use a read-only admin account for least privilege. Tokens never leave the org.',
    setup: [
      'Sign in to your Okta admin console as a user with read access to Users, Groups, and the System Log.',
      'Open Security -> API -> Tokens and click Create Token.',
      'Name the token (e.g. "rawdash"), copy the generated value (Okta only shows it once), and finish.',
      'Store the token as a secret and reference it from config as `apiToken: secret("OKTA_API_TOKEN")`, alongside the org host (the "acme.okta.com" part of your admin URL).',
    ],
  },
  rateLimit:
    'Okta publishes per-endpoint quotas (commonly 600 to 1200 requests/minute on production orgs, lower for trial orgs) and exposes X-Rate-Limit-Remaining and X-Rate-Limit-Reset (Unix seconds) on every response. The shared HTTP client honors those headers when scheduling the next request and falls back to Retry-After on 429.',
  limitations: [
    'Daily-active-users is not synced as a metric; derive it at query time over the okta_auth_event scope (filter eventType to a sign-in success and count distinct actor ids per day).',
    'Application assignments, factors, devices, and the policy / authorization-server APIs are out of scope.',
    'Only successful and failed sign-in System Log events are captured; broader event types (admin actions, lifecycle changes) can be added later.',
  ],
});

export interface OktaSettings {
  host: string;
  resources?: readonly OktaResource[];
}

const oktaCredentials = {
  apiToken: {
    description: 'Okta API token (SSWS)',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type OktaCredentials = typeof oktaCredentials;

const PHASE_ORDER = ['users', 'groups', 'auth_events'] as const;

type OktaPhase = (typeof PHASE_ORDER)[number];

export type OktaResource = OktaPhase;

const isOktaSyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

type OktaSyncCursor = ChunkedSyncCursor<OktaPhase, string>;

const USERS_PAGE_SIZE = 200;
const GROUPS_PAGE_SIZE = 200;
const LOGS_PAGE_SIZE = 1000;

const USER_ENTITY = 'okta_user';
const GROUP_ENTITY = 'okta_group';
const AUTH_EVENT = 'okta_auth_event';

// System Log filter: capture user authentication outcomes. Other event types
// (admin actions, lifecycle changes, etc.) are intentionally excluded; see
// `doc.limitations`.
const AUTH_EVENT_FILTER =
  'eventType eq "user.session.start" or eventType eq "user.authentication.auth_via_mfa" or eventType eq "user.authentication.sso" or eventType eq "user.session.access_admin_app" or eventType eq "user.authentication.auth_unauth_app"';

const oktaRateLimit = standardRateLimitPolicy({
  remainingHeader: 'x-rate-limit-remaining',
  resetHeader: 'x-rate-limit-reset',
  resetUnit: 's',
});

interface OktaProfile {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  login?: string | null;
}

interface OktaUser {
  id: string;
  status?: string | null;
  created?: string | null;
  activated?: string | null;
  statusChanged?: string | null;
  lastLogin?: string | null;
  lastUpdated?: string | null;
  passwordChanged?: string | null;
  profile?: OktaProfile | null;
}

interface OktaGroup {
  id: string;
  created?: string | null;
  lastUpdated?: string | null;
  lastMembershipUpdated?: string | null;
  type?: string | null;
  profile?: {
    name?: string | null;
    description?: string | null;
  } | null;
}

interface OktaLogActor {
  id?: string | null;
  type?: string | null;
  displayName?: string | null;
  alternateId?: string | null;
}

interface OktaLogClient {
  ipAddress?: string | null;
  userAgent?: { browser?: string | null; os?: string | null } | null;
  geographicalContext?: { country?: string | null } | null;
}

interface OktaLogAuthContext {
  authenticationProvider?: string | null;
  credentialProvider?: string | null;
  credentialType?: string | null;
  authenticationStep?: number | null;
}

interface OktaLogOutcome {
  result?: string | null;
  reason?: string | null;
}

interface OktaLogTarget {
  id?: string | null;
  type?: string | null;
  displayName?: string | null;
}

interface OktaLogEvent {
  uuid: string;
  published: string;
  eventType: string;
  severity?: string | null;
  displayMessage?: string | null;
  actor?: OktaLogActor | null;
  client?: OktaLogClient | null;
  authenticationContext?: OktaLogAuthContext | null;
  outcome?: OktaLogOutcome | null;
  target?: OktaLogTarget[] | null;
}

const oktaProfileSchema = z.object({
  firstName: z.string().nullish(),
  lastName: z.string().nullish(),
  email: z.string().nullish(),
  login: z.string().nullish(),
});

const oktaUserSchema = z.object({
  id: z.string().min(1),
  status: z.string().nullish(),
  created: z.string().nullish(),
  activated: z.string().nullish(),
  statusChanged: z.string().nullish(),
  lastLogin: z.string().nullish(),
  lastUpdated: z.string().nullish(),
  passwordChanged: z.string().nullish(),
  profile: oktaProfileSchema.nullish(),
});

const oktaGroupSchema = z.object({
  id: z.string().min(1),
  created: z.string().nullish(),
  lastUpdated: z.string().nullish(),
  lastMembershipUpdated: z.string().nullish(),
  type: z.string().nullish(),
  profile: z
    .object({
      name: z.string().nullish(),
      description: z.string().nullish(),
    })
    .nullish(),
});

const oktaLogEventSchema = z.object({
  uuid: z.string().min(1),
  published: z.string(),
  eventType: z.string(),
  severity: z.string().nullish(),
  displayMessage: z.string().nullish(),
  actor: z
    .object({
      id: z.string().nullish(),
      type: z.string().nullish(),
      displayName: z.string().nullish(),
      alternateId: z.string().nullish(),
    })
    .nullish(),
  client: z
    .object({
      ipAddress: z.string().nullish(),
      userAgent: z
        .object({
          browser: z.string().nullish(),
          os: z.string().nullish(),
        })
        .nullish(),
      geographicalContext: z
        .object({ country: z.string().nullish() })
        .nullish(),
    })
    .nullish(),
  authenticationContext: z
    .object({
      authenticationProvider: z.string().nullish(),
      credentialProvider: z.string().nullish(),
      credentialType: z.string().nullish(),
      authenticationStep: z.number().nullish(),
    })
    .nullish(),
  outcome: z
    .object({
      result: z.string().nullish(),
      reason: z.string().nullish(),
    })
    .nullish(),
  target: z
    .array(
      z.object({
        id: z.string().nullish(),
        type: z.string().nullish(),
        displayName: z.string().nullish(),
      }),
    )
    .nullish(),
});

export const oktaResources = defineResources({
  [USER_ENTITY]: {
    shape: 'entity',
    filterable: [
      {
        field: 'status',
        ops: ['eq'],
        values: [
          'STAGED',
          'PROVISIONED',
          'ACTIVE',
          'RECOVERY',
          'LOCKED_OUT',
          'PASSWORD_EXPIRED',
          'SUSPENDED',
          'DEPROVISIONED',
        ],
      },
    ],
    description:
      'Okta users with lifecycle status, last-login timestamp, and profile email / login.',
    endpoint: 'GET /api/v1/users',
    fields: [
      {
        name: 'status',
        description: 'Lifecycle status (ACTIVE, SUSPENDED, etc).',
      },
      {
        name: 'email',
        description: 'Primary email address from profile.email.',
      },
      {
        name: 'login',
        description: 'Login identifier (usually the primary email).',
      },
      { name: 'firstName', description: 'First name from profile.firstName.' },
      { name: 'lastName', description: 'Last name from profile.lastName.' },
      {
        name: 'lastLogin',
        description: 'Last successful sign-in time (Unix ms, null if never).',
      },
      {
        name: 'createdAt',
        description: 'When the user was created (Unix ms).',
      },
      {
        name: 'activatedAt',
        description: 'When the user account was activated (Unix ms).',
      },
    ],
    responses: { users: z.array(oktaUserSchema) },
  },
  [GROUP_ENTITY]: {
    shape: 'entity',
    filterable: [
      {
        field: 'type',
        ops: ['eq'],
        values: ['OKTA_GROUP', 'APP_GROUP', 'BUILT_IN'],
      },
    ],
    description:
      'Okta groups (native, app-managed, and built-in) with their name, description, and type.',
    endpoint: 'GET /api/v1/groups',
    fields: [
      { name: 'name', description: 'Group display name.' },
      { name: 'description', description: 'Group description.' },
      {
        name: 'type',
        description:
          'Group type (OKTA_GROUP for native, APP_GROUP for app-managed, BUILT_IN for system).',
      },
      {
        name: 'createdAt',
        description: 'When the group was created (Unix ms).',
      },
      {
        name: 'lastMembershipUpdatedAt',
        description: 'Last time membership changed (Unix ms).',
      },
    ],
    responses: { groups: z.array(oktaGroupSchema) },
  },
  [AUTH_EVENT]: {
    shape: 'event',
    filterable: [
      {
        field: 'result',
        ops: ['eq'],
        values: ['SUCCESS', 'FAILURE', 'ALLOW', 'DENY', 'CHALLENGE'],
      },
      { field: 'eventType', ops: ['eq'] },
    ],
    description:
      'Authentication events from the Okta System Log (sign-in starts, MFA challenges, SSO sign-ins, admin-app access).',
    endpoint: 'GET /api/v1/logs',
    fields: [
      {
        name: 'eventType',
        description: 'Okta event type, e.g. user.session.start.',
      },
      {
        name: 'result',
        description:
          'Outcome result (SUCCESS / FAILURE / ALLOW / DENY / CHALLENGE).',
      },
      {
        name: 'reason',
        description: 'Outcome reason string (vendor wording, free-form).',
      },
      {
        name: 'actorId',
        description:
          'Acting subject id (usually the user id, null if anonymous).',
      },
      { name: 'actorType', description: 'Acting subject type, e.g. "User".' },
      {
        name: 'authenticationProvider',
        description: 'Provider that performed the authentication.',
      },
      {
        name: 'credentialType',
        description: 'Credential type used (PASSWORD, OTP, EMAIL, etc).',
      },
      {
        name: 'ipAddress',
        description: 'Client IP address recorded by Okta.',
      },
      {
        name: 'country',
        description: 'Geographical country derived by Okta from the client IP.',
      },
      {
        name: 'severity',
        description: 'Severity assigned by Okta (DEBUG, INFO, WARN, ERROR).',
      },
    ],
    responses: { auth_events: z.array(oktaLogEventSchema) },
    notes:
      'The scope is cleared and rewritten on every full sync; incremental syncs append events whose `published` is strictly newer than `options.since`.',
  },
});

export const id = 'okta';

export class OktaConnector extends BaseConnector<
  OktaSettings,
  OktaCredentials
> {
  static readonly id = id;

  static readonly resources = oktaResources;

  static readonly schemas = schemasFromResources(oktaResources);

  static create(input: unknown, ctx?: ConnectorContext): OktaConnector {
    const parsed = configFields.parse(input);
    return new OktaConnector(
      {
        host: parsed.host,
        resources: parsed.resources,
      },
      { apiToken: parsed.apiToken },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = oktaCredentials;

  private get baseUrl(): string {
    return `https://${this.settings.host}`;
  }

  private buildHeaders(): Record<string, string> {
    return {
      Authorization: `SSWS ${this.creds.apiToken}`,
      Accept: 'application/json',
      'User-Agent': connectorUserAgent('okta'),
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
      rateLimit: oktaRateLimit,
    });
  }

  private allowedPagePath(phase: OktaPhase): string {
    switch (phase) {
      case 'users':
        return '/api/v1/users';
      case 'groups':
        return '/api/v1/groups';
      case 'auth_events':
        return '/api/v1/logs';
    }
  }

  private sanitizePageUrl(
    phase: OktaPhase,
    pageUrl: string | null,
  ): string | null {
    return sanitizeAllowedUrl({
      url: pageUrl,
      host: this.settings.host,
      pathname: this.allowedPagePath(phase),
    });
  }

  private resolveCursor(cursor: unknown): OktaSyncCursor | undefined {
    if (!isOktaSyncCursor(cursor)) {
      return undefined;
    }
    return {
      phase: cursor.phase,
      page: this.sanitizePageUrl(cursor.phase, cursor.page),
    };
  }

  private singleSpec(
    options: SyncOptions,
    resource: string,
  ): FetchSpec | undefined {
    const specs = options.fetchSpecs?.[resource];
    return specs && specs.length === 1 ? specs[0] : undefined;
  }

  private setScimFilter(url: URL, clause: string): void {
    const existing = url.searchParams.get('filter');
    url.searchParams.set(
      'filter',
      existing ? `(${existing}) and (${clause})` : clause,
    );
  }

  private applyPushdown(
    url: URL,
    phase: OktaPhase,
    options: SyncOptions,
  ): void {
    switch (phase) {
      case 'users': {
        const status = pushableEq(
          this.singleSpec(options, USER_ENTITY)?.filter,
          'status',
        );
        if (status !== null) {
          this.setScimFilter(url, `status eq "${status}"`);
        }
        return;
      }
      case 'groups': {
        const groupType = pushableEq(
          this.singleSpec(options, GROUP_ENTITY)?.filter,
          'type',
        );
        if (groupType !== null) {
          this.setScimFilter(url, `type eq "${groupType}"`);
        }
        return;
      }
      case 'auth_events':
        return;
    }
  }

  private buildInitialUrl(phase: OktaPhase, options: SyncOptions): string {
    const url = new URL(`${this.baseUrl}${this.allowedPagePath(phase)}`);
    switch (phase) {
      case 'users':
        url.searchParams.set('limit', String(USERS_PAGE_SIZE));
        if (options.since) {
          // Okta supports SCIM-style lastUpdated filters on /users.
          url.searchParams.set('filter', `lastUpdated gt "${options.since}"`);
        }
        break;
      case 'groups':
        url.searchParams.set('limit', String(GROUPS_PAGE_SIZE));
        if (options.since) {
          url.searchParams.set('filter', `lastUpdated gt "${options.since}"`);
        }
        break;
      case 'auth_events':
        url.searchParams.set('limit', String(LOGS_PAGE_SIZE));
        url.searchParams.set('filter', AUTH_EVENT_FILTER);
        url.searchParams.set('sortOrder', 'ASCENDING');
        if (options.since) {
          url.searchParams.set('since', options.since);
        }
        break;
    }
    this.applyPushdown(url, phase, options);
    return url.toString();
  }

  private async fetchPhasePage(
    phase: OktaPhase,
    page: string | null,
    options: SyncOptions,
    signal?: AbortSignal,
  ): Promise<FetchPageResult<string>> {
    const url = page ?? this.buildInitialUrl(phase, options);
    const resource = phase === 'auth_events' ? 'auth_events' : phase;
    const res = await this.apiGet<unknown[]>(url, resource, signal);
    const rawNext = parseLinkHeader(res.headers.get('link'))['next'] ?? null;
    const next = this.sanitizePageUrl(phase, rawNext);
    // The Okta System Log Link header returns rel="next" even when the page
    // is empty, because the cursor advances in time rather than over a fixed
    // list. Stop when the page is empty so chunked syncs terminate cleanly.
    if (phase === 'auth_events') {
      const items = (res.body ?? []) as unknown[];
      return { items, next: items.length === 0 ? null : next };
    }
    return { items: res.body ?? [], next };
  }

  private async writeUsers(
    storage: StorageHandle,
    items: OktaUser[],
  ): Promise<void> {
    for (const user of items) {
      const profile = user.profile ?? null;
      await storage.entity({
        type: USER_ENTITY,
        id: user.id,
        attributes: {
          status: user.status ?? null,
          email: profile?.email ?? null,
          login: profile?.login ?? null,
          firstName: profile?.firstName ?? null,
          lastName: profile?.lastName ?? null,
          lastLogin: isoToMs(user.lastLogin),
          createdAt: isoToMs(user.created),
          activatedAt: isoToMs(user.activated),
        },
        updated_at: isoToMsOrZero(
          user.lastUpdated ?? user.statusChanged ?? user.created,
        ),
      });
    }
  }

  private async writeGroups(
    storage: StorageHandle,
    items: OktaGroup[],
  ): Promise<void> {
    for (const group of items) {
      await storage.entity({
        type: GROUP_ENTITY,
        id: group.id,
        attributes: {
          name: group.profile?.name ?? null,
          description: group.profile?.description ?? null,
          type: group.type ?? null,
          createdAt: isoToMs(group.created),
          lastMembershipUpdatedAt: isoToMs(group.lastMembershipUpdated),
        },
        updated_at: isoToMsOrZero(
          group.lastUpdated ?? group.lastMembershipUpdated ?? group.created,
        ),
      });
    }
  }

  private async writeAuthEvents(
    storage: StorageHandle,
    items: OktaLogEvent[],
    sinceMs: number | null,
  ): Promise<void> {
    for (const ev of items) {
      const ts = isoToMs(ev.published);
      if (ts === null) {
        continue;
      }
      if (sinceMs !== null && ts <= sinceMs) {
        continue;
      }
      const attributes: Record<string, JSONValue> = {
        eventType: ev.eventType,
        result: ev.outcome?.result ?? null,
        reason: ev.outcome?.reason ?? null,
        actorId: ev.actor?.id ?? null,
        actorType: ev.actor?.type ?? null,
        actorDisplayName: ev.actor?.displayName ?? null,
        authenticationProvider:
          ev.authenticationContext?.authenticationProvider ?? null,
        credentialProvider:
          ev.authenticationContext?.credentialProvider ?? null,
        credentialType: ev.authenticationContext?.credentialType ?? null,
        ipAddress: ev.client?.ipAddress ?? null,
        country: ev.client?.geographicalContext?.country ?? null,
        browser: ev.client?.userAgent?.browser ?? null,
        severity: ev.severity ?? null,
        displayMessage: ev.displayMessage ?? null,
        uuid: ev.uuid,
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
    phase: OktaPhase,
    isFull: boolean,
  ): Promise<void> {
    if (!isFull) {
      return;
    }
    switch (phase) {
      case 'users':
        await storage.entities([], { types: [USER_ENTITY] });
        return;
      case 'groups':
        await storage.entities([], { types: [GROUP_ENTITY] });
        return;
      case 'auth_events':
        await storage.events([], { names: [AUTH_EVENT] });
        return;
    }
  }

  private async writePhase(
    storage: StorageHandle,
    phase: OktaPhase,
    items: unknown[],
    sinceMs: number | null,
  ): Promise<void> {
    switch (phase) {
      case 'users':
        return this.writeUsers(storage, items as OktaUser[]);
      case 'groups':
        return this.writeGroups(storage, items as OktaGroup[]);
      case 'auth_events':
        return this.writeAuthEvents(storage, items as OktaLogEvent[], sinceMs);
    }
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

    const phases = selectActivePhases<OktaResource, OktaPhase>(
      (r) => r,
      PHASE_ORDER,
      this.settings.resources,
    );

    return paginateChunked<OktaPhase, string>({
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

function isoToMs(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function isoToMsOrZero(value: string | null | undefined): number {
  return isoToMs(value) ?? 0;
}

function pushableEq(
  filter: FilterClause[] | undefined,
  field: string,
): string | null {
  if (!filter) {
    return null;
  }
  for (const clause of filter) {
    if (
      'field' in clause &&
      clause.field === field &&
      clause.op === 'eq' &&
      typeof clause.value === 'string'
    ) {
      return clause.value;
    }
  }
  return null;
}
