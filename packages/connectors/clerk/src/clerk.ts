import {
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
    secretKey: z.object({ $secret: z.string().min(1) }).meta({
      label: 'Secret key',
      description:
        'Clerk Backend API secret key (starts with `sk_test_` or `sk_live_`). Create one at Clerk Dashboard -> API Keys.',
      placeholder: 'CLERK_SECRET_KEY',
      secret: true,
    }),
    apiUrl: z
      .string()
      .trim()
      .url('Must be a full URL, e.g. "https://api.clerk.com".')
      .default('https://api.clerk.com')
      .meta({
        label: 'API base URL',
        description:
          'Clerk Backend API base URL. Defaults to https://api.clerk.com; override only if you are pinned to the legacy https://api.clerk.dev host.',
        placeholder: 'https://api.clerk.com',
      }),
    resources: z
      .array(
        z.enum(['users', 'organizations', 'sessions', 'daily_active_users']),
      )
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          'Which Clerk resources to sync. Omit to sync all of them. The secret key has read access to every resource by default; the allowlist exists to skip phases your dashboards do not query.',
      }),
    dauLookbackDays: z.number().int().positive().max(90).optional().meta({
      label: 'DAU lookback (days)',
      description:
        'How many days back to bucket users by last_active_at when computing the daily_active_users metric. Defaults to 30; the cap is 90.',
      placeholder: '30',
    }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'Clerk',
  category: 'security',
  brandColor: '#6C47FF',
  tagline:
    'Sync users, organizations, sessions, and a derived daily-active-users metric from a Clerk application for sign-up, DAU, and active-session dashboards.',
  vendor: {
    name: 'Clerk',
    domain: 'clerk.com',
    apiDocs: 'https://clerk.com/docs/reference/backend-api',
    website: 'https://clerk.com',
  },
  auth: {
    summary:
      'A Clerk Backend API secret key (Bearer token). Anyone with the key has read access to every resource the connector syncs.',
    setup: [
      'Open the Clerk Dashboard for the application you want to sync and navigate to API Keys.',
      'Copy the Secret key (it starts with `sk_test_` for development instances or `sk_live_` for production).',
      'Store it as a rawdash secret and reference it from the connector config as `secretKey: secret("CLERK_SECRET_KEY")`.',
      'Treat the secret key like a root credential - rotate it from the dashboard if it leaks.',
    ],
  },
  rateLimit:
    'Clerk Backend API throttles per instance (~20 req/s for production, lower for dev). Responses publish X-RateLimit-Remaining / X-RateLimit-Reset (Unix seconds) headers and the shared HTTP client backs off on 429 using the standard rate-limit policy.',
  limitations: [
    'Each phase paginates via limit / offset and is capped at 50 pages per sync (~25,000 rows). Instances larger than that should run more frequent incremental syncs so each window fits under the cap.',
    'The daily_active_users metric is derived by bucketing users by the day of their last_active_at timestamp - it counts users whose most recent activity fell on each day, not unique users active across overlapping days.',
    'Webhooks, JWT templates, instance settings, and impersonation tokens are out of scope.',
  ],
});

export type ClerkResource =
  | 'users'
  | 'organizations'
  | 'sessions'
  | 'daily_active_users';

export interface ClerkSettings {
  apiUrl?: string;
  resources?: readonly ClerkResource[];
  dauLookbackDays?: number;
}

const clerkCredentials = {
  secretKey: {
    description: 'Clerk Backend API secret key',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type ClerkCredentials = typeof clerkCredentials;

const clerkRateLimit = standardRateLimitPolicy({
  remainingHeader: 'x-ratelimit-remaining',
  resetHeader: 'x-ratelimit-reset',
  resetUnit: 's',
});

const PHASE_ORDER = [
  'users',
  'organizations',
  'sessions',
  'daily_active_users',
] as const;

type ClerkPhase = (typeof PHASE_ORDER)[number];

type ClerkSyncCursor = ChunkedSyncCursor<ClerkPhase, string>;

const isClerkSyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

const USER_ENTITY = 'clerk_user';
const ORG_ENTITY = 'clerk_organization';
const SESSION_EVENT = 'clerk_session';
const DAU_METRIC = 'clerk_daily_active_users';

const PAGE_SIZE = 500;
const MAX_PAGES = 50;
const DEFAULT_DAU_LOOKBACK_DAYS = 30;
const DEFAULT_API_URL = 'https://api.clerk.com';
const DAY_MS = 24 * 60 * 60 * 1000;

const SESSION_STATUSES = [
  'abandoned',
  'active',
  'ended',
  'expired',
  'removed',
  'replaced',
  'revoked',
] as const;
type SessionStatus = (typeof SESSION_STATUSES)[number];

const idString = z.string().min(1);

const emailAddressSchema = z.object({
  id: z.string().optional(),
  email_address: z.string().nullish(),
  verification: z.object({ status: z.string().nullish() }).nullish(),
});

const userSchema = z.object({
  id: idString,
  primary_email_address_id: z.string().nullish(),
  email_addresses: z.array(emailAddressSchema).nullish(),
  first_name: z.string().nullish(),
  last_name: z.string().nullish(),
  username: z.string().nullish(),
  last_sign_in_at: z.number().nullish(),
  last_active_at: z.number().nullish(),
  created_at: z.number().nullish(),
  updated_at: z.number().nullish(),
  banned: z.boolean().nullish(),
  locked: z.boolean().nullish(),
});

const usersResponseSchema = z.array(userSchema);

const organizationSchema = z.object({
  id: idString,
  name: z.string().nullish(),
  slug: z.string().nullish(),
  members_count: z.number().nullish(),
  created_at: z.number().nullish(),
  updated_at: z.number().nullish(),
});

const organizationsResponseSchema = z.union([
  z.object({
    data: z.array(organizationSchema),
    total_count: z.number().optional(),
  }),
  z.array(organizationSchema),
]);

const sessionSchema = z.object({
  id: idString,
  user_id: z.string().nullish(),
  client_id: z.string().nullish(),
  status: z.string(),
  last_active_at: z.number().nullish(),
  expire_at: z.number().nullish(),
  abandon_at: z.number().nullish(),
  created_at: z.number().nullish(),
  updated_at: z.number().nullish(),
});

const sessionsResponseSchema = z.array(sessionSchema);

export const clerkResources = defineResources({
  [USER_ENTITY]: {
    shape: 'entity',
    filterable: [
      { field: 'banned', ops: ['eq'], values: ['true', 'false'] },
      { field: 'locked', ops: ['eq'], values: ['true', 'false'] },
    ],
    description:
      'Clerk users keyed by user id, with primary email, sign-in / activity timestamps, and banned / locked flags.',
    endpoint: 'GET /v1/users',
    notes:
      'Uses offset pagination (limit / offset) capped at 50 pages (~25,000 users) per sync. Incremental syncs pass options.since through as the last_active_at_since filter.',
    fields: [
      { name: 'email', description: 'Primary email address (when present).' },
      {
        name: 'emailVerified',
        description:
          'Whether the primary email address is verified (null if no email is set).',
      },
      {
        name: 'lastSignInAt',
        description: 'Most recent sign-in timestamp (Unix ms).',
      },
      {
        name: 'lastActiveAt',
        description:
          'Most recent activity timestamp (Unix ms). Clerk updates this on every successful client request.',
      },
      {
        name: 'banned',
        description: 'Whether the user has been banned.',
      },
      {
        name: 'locked',
        description: 'Whether the user is locked from signing in.',
      },
      {
        name: 'createdAt',
        description: 'When the user account was created (Unix ms).',
      },
    ],
    responses: { users: usersResponseSchema },
  },
  [ORG_ENTITY]: {
    shape: 'entity',
    filterable: [],
    description:
      'Clerk organizations keyed by organization id, with display name, slug, and members count.',
    endpoint: 'GET /v1/organizations',
    notes:
      'Uses offset pagination (limit / offset) capped at 50 pages. Clerk has no created_at / updated_at filter for organizations, so each sync re-scans the full list and short-circuits once a page is entirely older than options.since.',
    fields: [
      { name: 'name', description: 'Organization display name.' },
      { name: 'slug', description: 'Organization URL slug.' },
      {
        name: 'membersCount',
        description: 'Number of users in the organization at sync time.',
      },
      {
        name: 'createdAt',
        description: 'When the organization was created (Unix ms).',
      },
    ],
    responses: { organizations: organizationsResponseSchema },
  },
  [SESSION_EVENT]: {
    shape: 'event',
    filterable: [
      {
        field: 'status',
        ops: ['eq'],
        values: SESSION_STATUSES as unknown as string[],
      },
    ],
    description:
      'Clerk session events. One event per session row with start_ts set to created_at and attributes carrying user id, status, and last activity.',
    endpoint: 'GET /v1/sessions',
    notes:
      'Uses offset pagination (limit / offset) capped at 50 pages. Clerk has no since filter on /v1/sessions, so the sync walks newest-first and stops once a page is entirely older than options.since.',
    fields: [
      { name: 'sessionId', description: 'Clerk session id.' },
      { name: 'userId', description: 'User the session belongs to.' },
      {
        name: 'status',
        description:
          'Session status (active | ended | expired | abandoned | removed | replaced | revoked).',
      },
      {
        name: 'lastActiveAt',
        description: 'Most recent activity timestamp on the session (Unix ms).',
      },
    ],
    responses: { sessions: sessionsResponseSchema },
  },
  [DAU_METRIC]: {
    shape: 'metric',
    description:
      'Daily active users derived from the Clerk users endpoint: one sample per UTC day in the configured lookback window, counting users whose last_active_at fell on that day.',
    endpoint: 'GET /v1/users',
    unit: 'count',
    granularity: '1d',
    dimensions: [],
    responses: { dau_users: usersResponseSchema },
  },
});

export const id = 'clerk';

type ClerkUser = z.infer<typeof userSchema>;
type ClerkOrganization = z.infer<typeof organizationSchema>;
type ClerkSession = z.infer<typeof sessionSchema>;
type OrganizationsResponse = z.infer<typeof organizationsResponseSchema>;

function primaryEmail(user: ClerkUser): {
  email: string | null;
  verified: boolean | null;
} {
  const list = user.email_addresses ?? [];
  if (list.length === 0) {
    return { email: null, verified: null };
  }
  const primaryId = user.primary_email_address_id ?? null;
  const primary =
    (primaryId !== null ? list.find((e) => e.id === primaryId) : undefined) ??
    list[0]!;
  const verified =
    primary.verification?.status === 'verified'
      ? true
      : primary.verification?.status
        ? false
        : null;
  return { email: primary.email_address ?? null, verified };
}

function isSessionStatus(value: string): value is SessionStatus {
  return (SESSION_STATUSES as readonly string[]).includes(value);
}

function dayBucket(tsMs: number): number {
  return Math.floor(tsMs / DAY_MS) * DAY_MS;
}

function unwrapOrganizations(body: OrganizationsResponse): {
  items: ClerkOrganization[];
  totalCount: number | null;
} {
  if (Array.isArray(body)) {
    return { items: body, totalCount: null };
  }
  return { items: body.data, totalCount: body.total_count ?? null };
}

export class ClerkConnector extends BaseConnector<
  ClerkSettings,
  ClerkCredentials
> {
  static readonly id = id;

  static readonly resources = clerkResources;

  static readonly schemas = schemasFromResources(clerkResources);

  static create(input: unknown, ctx?: ConnectorContext): ClerkConnector {
    const parsed = configFields.parse(input);
    return new ClerkConnector(
      {
        apiUrl: parsed.apiUrl,
        resources: parsed.resources,
        dauLookbackDays: parsed.dauLookbackDays,
      },
      {
        secretKey: parsed.secretKey,
      },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = clerkCredentials;

  private dauBuckets = new Map<number, Set<string>>();

  private baseUrl(): string {
    const raw = this.settings.apiUrl ?? DEFAULT_API_URL;
    return raw.replace(/\/+$/, '');
  }

  private dauLookbackDays(): number {
    return this.settings.dauLookbackDays ?? DEFAULT_DAU_LOOKBACK_DAYS;
  }

  private dauCutoffMs(): number {
    return Date.now() - this.dauLookbackDays() * DAY_MS;
  }

  private parsePageCursor(page: string | null): number {
    if (!page) {
      return 0;
    }
    const n = Number.parseInt(page, 10);
    if (!Number.isFinite(n) || n < 0) {
      return 0;
    }
    return n;
  }

  private async apiGet<T>(
    url: string,
    resource: string,
    signal: AbortSignal | undefined,
  ) {
    return this.get<T>(url, {
      resource,
      headers: {
        Authorization: `Bearer ${this.creds.secretKey}`,
        Accept: 'application/json',
        'User-Agent': connectorUserAgent('clerk'),
      },
      rateLimit: clerkRateLimit,
      signal,
    });
  }

  private buildUsersUrl(offset: number, options: SyncOptions): string {
    const u = new URL(`${this.baseUrl()}/v1/users`);
    u.searchParams.set('limit', String(PAGE_SIZE));
    u.searchParams.set('offset', String(offset));
    u.searchParams.set('order_by', '-last_active_at');
    if (options.since) {
      const sinceMs = Date.parse(options.since);
      if (Number.isFinite(sinceMs)) {
        u.searchParams.set('last_active_at_since', String(sinceMs));
      }
    }
    return u.toString();
  }

  private buildOrganizationsUrl(offset: number): string {
    const u = new URL(`${this.baseUrl()}/v1/organizations`);
    u.searchParams.set('limit', String(PAGE_SIZE));
    u.searchParams.set('offset', String(offset));
    u.searchParams.set('order_by', '-created_at');
    return u.toString();
  }

  private buildSessionsUrl(offset: number): string {
    const u = new URL(`${this.baseUrl()}/v1/sessions`);
    u.searchParams.set('limit', String(PAGE_SIZE));
    u.searchParams.set('offset', String(offset));
    return u.toString();
  }

  private buildDauUsersUrl(offset: number): string {
    const u = new URL(`${this.baseUrl()}/v1/users`);
    u.searchParams.set('limit', String(PAGE_SIZE));
    u.searchParams.set('offset', String(offset));
    u.searchParams.set('order_by', '-last_active_at');
    u.searchParams.set('last_active_at_since', String(this.dauCutoffMs()));
    return u.toString();
  }

  private async fetchUsersPage(
    page: string | null,
    options: SyncOptions,
    signal: AbortSignal | undefined,
  ): Promise<{ items: ClerkUser[]; next: string | null }> {
    const offset = this.parsePageCursor(page);
    const url = this.buildUsersUrl(offset, options);
    const res = await this.apiGet<ClerkUser[]>(url, 'users', signal);
    const items = res.body;
    const nextOffset = offset + PAGE_SIZE;
    const pageIndex = Math.floor(offset / PAGE_SIZE);
    const hasMore = items.length >= PAGE_SIZE && pageIndex + 1 < MAX_PAGES;
    return { items, next: hasMore ? String(nextOffset) : null };
  }

  private async fetchOrganizationsPage(
    page: string | null,
    options: SyncOptions,
    signal: AbortSignal | undefined,
  ): Promise<{ items: ClerkOrganization[]; next: string | null }> {
    const offset = this.parsePageCursor(page);
    const url = this.buildOrganizationsUrl(offset);
    const res = await this.apiGet<OrganizationsResponse>(
      url,
      'organizations',
      signal,
    );
    const { items } = unwrapOrganizations(res.body);
    const sinceMs = options.since ? Date.parse(options.since) : NaN;
    const allOlder =
      Number.isFinite(sinceMs) &&
      items.length > 0 &&
      items.every((o) => (o.created_at ?? 0) < sinceMs);
    const nextOffset = offset + PAGE_SIZE;
    const pageIndex = Math.floor(offset / PAGE_SIZE);
    const hasMore =
      items.length >= PAGE_SIZE && !allOlder && pageIndex + 1 < MAX_PAGES;
    return { items, next: hasMore ? String(nextOffset) : null };
  }

  private async fetchSessionsPage(
    page: string | null,
    options: SyncOptions,
    signal: AbortSignal | undefined,
  ): Promise<{ items: ClerkSession[]; next: string | null }> {
    const offset = this.parsePageCursor(page);
    const url = this.buildSessionsUrl(offset);
    const res = await this.apiGet<ClerkSession[]>(url, 'sessions', signal);
    const items = res.body;
    const sinceMs = options.since ? Date.parse(options.since) : NaN;
    const allOlder =
      Number.isFinite(sinceMs) &&
      items.length > 0 &&
      items.every((s) => (s.created_at ?? 0) < sinceMs);
    const nextOffset = offset + PAGE_SIZE;
    const pageIndex = Math.floor(offset / PAGE_SIZE);
    const hasMore =
      items.length >= PAGE_SIZE && !allOlder && pageIndex + 1 < MAX_PAGES;
    return { items, next: hasMore ? String(nextOffset) : null };
  }

  private async fetchDauUsersPage(
    page: string | null,
    signal: AbortSignal | undefined,
  ): Promise<{ items: ClerkUser[]; next: string | null }> {
    const offset = this.parsePageCursor(page);
    const url = this.buildDauUsersUrl(offset);
    const res = await this.apiGet<ClerkUser[]>(url, 'dau_users', signal);
    const items = res.body;
    const nextOffset = offset + PAGE_SIZE;
    const pageIndex = Math.floor(offset / PAGE_SIZE);
    const hasMore = items.length >= PAGE_SIZE && pageIndex + 1 < MAX_PAGES;
    return { items, next: hasMore ? String(nextOffset) : null };
  }

  private async writeUsers(
    storage: StorageHandle,
    items: ClerkUser[],
  ): Promise<void> {
    for (const u of items) {
      const { email, verified } = primaryEmail(u);
      const lastSignIn = parseEpoch(u.last_sign_in_at ?? null, 'ms');
      const lastActive = parseEpoch(u.last_active_at ?? null, 'ms');
      const createdAt = parseEpoch(u.created_at ?? null, 'ms');
      const updatedAt = parseEpoch(u.updated_at ?? null, 'ms');
      await storage.entity({
        type: USER_ENTITY,
        id: u.id,
        attributes: {
          email,
          emailVerified: verified,
          lastSignInAt: lastSignIn,
          lastActiveAt: lastActive,
          banned: u.banned ?? false,
          locked: u.locked ?? false,
          createdAt,
        },
        updated_at: updatedAt ?? createdAt ?? 0,
      });
    }
  }

  private async writeOrganizations(
    storage: StorageHandle,
    items: ClerkOrganization[],
  ): Promise<void> {
    for (const o of items) {
      const createdAt = parseEpoch(o.created_at ?? null, 'ms');
      const updatedAt = parseEpoch(o.updated_at ?? null, 'ms');
      await storage.entity({
        type: ORG_ENTITY,
        id: o.id,
        attributes: {
          name: o.name ?? null,
          slug: o.slug ?? null,
          membersCount: o.members_count ?? null,
          createdAt,
        },
        updated_at: updatedAt ?? createdAt ?? 0,
      });
    }
  }

  private async writeSessions(
    storage: StorageHandle,
    items: ClerkSession[],
  ): Promise<void> {
    for (const s of items) {
      const startTs = parseEpoch(s.created_at ?? null, 'ms');
      if (startTs === null) {
        continue;
      }
      const status = isSessionStatus(s.status) ? s.status : 'active';
      const lastActive = parseEpoch(s.last_active_at ?? null, 'ms');
      await storage.event({
        name: SESSION_EVENT,
        start_ts: startTs,
        end_ts: null,
        attributes: {
          sessionId: s.id,
          userId: s.user_id ?? null,
          status,
          lastActiveAt: lastActive,
        },
      });
    }
  }

  private accumulateDau(items: ClerkUser[]): void {
    const cutoff = this.dauCutoffMs();
    for (const u of items) {
      const ts = u.last_active_at;
      if (typeof ts !== 'number' || !Number.isFinite(ts) || ts < cutoff) {
        continue;
      }
      const bucket = dayBucket(ts);
      const set = this.dauBuckets.get(bucket) ?? new Set<string>();
      set.add(u.id);
      this.dauBuckets.set(bucket, set);
    }
  }

  private async writeDauSamples(storage: StorageHandle): Promise<void> {
    const samples = Array.from(this.dauBuckets.entries())
      .sort(([a], [b]) => a - b)
      .map(([ts, set]) => ({
        name: DAU_METRIC,
        ts,
        value: set.size,
        attributes: {},
      }));
    await storage.metrics(samples, { names: [DAU_METRIC] });
  }

  private async clearScopeOnFirstPage(
    storage: StorageHandle,
    phase: ClerkPhase,
    isFull: boolean,
  ): Promise<void> {
    if (phase === 'daily_active_users') {
      this.dauBuckets.clear();
      await storage.metrics([], { names: [DAU_METRIC] });
      return;
    }
    if (!isFull) {
      return;
    }
    switch (phase) {
      case 'users':
        await storage.entities([], { types: [USER_ENTITY] });
        return;
      case 'organizations':
        await storage.entities([], { types: [ORG_ENTITY] });
        return;
      case 'sessions':
        await storage.events([], { names: [SESSION_EVENT] });
        return;
    }
  }

  private resolveCursor(cursor: unknown): ClerkSyncCursor | undefined {
    return isClerkSyncCursor(cursor) ? cursor : undefined;
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const cursor = this.resolveCursor(options.cursor);
    const isFull = options.mode === 'full';

    const phases = selectActivePhases<ClerkResource, ClerkPhase>(
      (r) => r,
      PHASE_ORDER,
      this.settings.resources,
    );

    return paginateChunked<ClerkPhase, string>({
      phases,
      cursor,
      signal,
      logger: this.logger,
      fetchPage: async (phase, page, sig) => {
        switch (phase) {
          case 'users':
            return this.fetchUsersPage(page, options, sig);
          case 'organizations':
            return this.fetchOrganizationsPage(page, options, sig);
          case 'sessions':
            return this.fetchSessionsPage(page, options, sig);
          case 'daily_active_users':
            return this.fetchDauUsersPage(page, sig);
        }
      },
      writeBatch: async (phase, items, page) => {
        if (page === null) {
          await this.clearScopeOnFirstPage(storage, phase, isFull);
        }
        switch (phase) {
          case 'users':
            await this.writeUsers(storage, items as ClerkUser[]);
            return;
          case 'organizations':
            await this.writeOrganizations(
              storage,
              items as ClerkOrganization[],
            );
            return;
          case 'sessions':
            await this.writeSessions(storage, items as ClerkSession[]);
            return;
          case 'daily_active_users':
            this.accumulateDau(items as ClerkUser[]);
            await this.writeDauSamples(storage);
            return;
        }
      },
    });
  }
}
