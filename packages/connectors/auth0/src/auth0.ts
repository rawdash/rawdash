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
    domain: z
      .string()
      .min(1)
      .regex(
        /^[a-z0-9-]+(\.[a-z0-9-]+)*\.auth0\.com$/i,
        'Auth0 tenant domain, e.g. "acme.us.auth0.com" (no scheme).',
      )
      .meta({
        label: 'Tenant domain',
        description:
          'Auth0 tenant domain (e.g. "acme.us.auth0.com" or a custom domain ending in .auth0.com). Used as the API host and as the audience when minting M2M tokens.',
        placeholder: 'acme.us.auth0.com',
      }),
    clientId: z.string().min(1).meta({
      label: 'M2M application client ID',
      description:
        'Client ID of the Auth0 Machine-to-Machine application authorized to call the Management API.',
      placeholder: 'AbCdEf...',
    }),
    clientSecret: z.object({ $secret: z.string().min(1) }).meta({
      label: 'M2M application client secret',
      description:
        'Client secret of the Auth0 Machine-to-Machine application. Stored as a secret.',
      placeholder: 'AUTH0_CLIENT_SECRET',
      secret: true,
    }),
    resources: z
      .array(z.enum(['users', 'login_events', 'daily_active_users']))
      .nonempty()
      .optional()
      .meta({
        label: 'Resources',
        description:
          'Which Auth0 resources to sync. Omit to sync all of them. The M2M application only needs the Management API scopes for the resources listed here (read:users, read:logs, read:stats).',
      }),
    statsLookbackDays: z.number().int().positive().max(30).optional().meta({
      label: 'Stats lookback (days)',
      description:
        'How many days of daily-active-user / signup stats to refresh on each sync. Defaults to 30 (the maximum the Auth0 Daily Stats endpoint returns).',
      placeholder: '30',
    }),
  }),
);

export const doc: ConnectorDoc = defineConnectorDoc({
  displayName: 'Auth0',
  category: 'security',
  brandColor: '#EB5424',
  tagline:
    'Sync users, login events, and daily active-user / signup metrics from an Auth0 tenant for identity, sign-up, and failed-login dashboards.',
  vendor: {
    name: 'Auth0',
    domain: 'auth0.com',
    apiDocs: 'https://auth0.com/docs/api/management/v2',
    website: 'https://auth0.com',
  },
  auth: {
    summary:
      'OAuth 2.0 client-credentials flow against a Machine-to-Machine application authorized for the Auth0 Management API.',
    setup: [
      'In the Auth0 Dashboard, open Applications -> Applications and create a new Machine to Machine Application.',
      'Authorize the M2M app for the Auth0 Management API (Applications -> APIs -> Auth0 Management API -> Machine to Machine Applications).',
      'Grant the M2M app the read:users, read:logs, and read:stats scopes (only the ones for the resources you intend to sync are required).',
      'Copy the Domain (e.g. "acme.us.auth0.com"), Client ID, and Client Secret from the M2M application Settings tab.',
      'Store the client secret as a rawdash secret and reference it from the connector config as `clientSecret: secret("AUTH0_CLIENT_SECRET")`.',
    ],
  },
  rateLimit:
    'Auth0 publishes X-RateLimit-Limit / X-RateLimit-Remaining / X-RateLimit-Reset response headers on Management API calls; the shared HTTP client backs off on 429 with the standard rate-limit policy.',
  limitations: [
    'User enumeration uses offset pagination (page/per_page) and is capped at the first 1000 users per sync; tenants with more than 1000 users updated since the last run should increase sync frequency so each window stays under the cap.',
    'Action / hook / branding configuration objects are out of scope.',
    'Only Auth0 tenants on the *.auth0.com hostname suffix are supported; custom-domain tenants must still expose a *.auth0.com hostname for the Management API.',
  ],
});

export type Auth0Resource = 'users' | 'login_events' | 'daily_active_users';

export interface Auth0Settings {
  domain: string;
  resources?: readonly Auth0Resource[];
  statsLookbackDays?: number;
}

const auth0Credentials = {
  clientId: {
    description: 'Auth0 Machine-to-Machine application client ID',
    auth: 'required' as const,
  },
  clientSecret: {
    description: 'Auth0 Machine-to-Machine application client secret',
    auth: 'required' as const,
  },
} satisfies CredentialsSchema;

type Auth0Credentials = typeof auth0Credentials;

const auth0RateLimit = standardRateLimitPolicy({
  remainingHeader: 'x-ratelimit-remaining',
  resetHeader: 'x-ratelimit-reset',
  resetUnit: 's',
});

const PHASE_ORDER = ['users', 'login_events', 'daily_active_users'] as const;

type Auth0Phase = (typeof PHASE_ORDER)[number];

type Auth0SyncCursor = ChunkedSyncCursor<Auth0Phase, string>;

const isAuth0SyncCursor = makeChunkedCursorGuard(PHASE_ORDER);

const USER_ENTITY = 'auth0_user';
const LOGIN_EVENT = 'auth0_login_event';
const DAILY_METRIC = 'auth0_daily_active_users';

const PAGE_SIZE = 100;
const MAX_USER_PAGES = 10;
const DEFAULT_STATS_LOOKBACK_DAYS = 30;

const LOG_EVENT_TYPES = ['s', 'f', 'seacft', 'fp'] as const;
type LogEventType = (typeof LOG_EVENT_TYPES)[number];

const idString = z.string().min(1);

const oauthTokenSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().optional(),
  expires_in: z.number().optional(),
});

const userIdentitySchema = z.object({
  connection: z.string().nullish(),
  provider: z.string().nullish(),
  user_id: z.union([z.string(), z.number()]).nullish(),
  isSocial: z.boolean().nullish(),
});

const userSchema = z.object({
  user_id: idString,
  email: z.string().nullish(),
  email_verified: z.boolean().nullish(),
  identities: z.array(userIdentitySchema).nullish(),
  last_login: z.string().nullish(),
  logins_count: z.number().nullish(),
  created_at: z.string().nullish(),
  updated_at: z.string().nullish(),
  blocked: z.boolean().nullish(),
});

const usersResponseSchema = z.object({
  start: z.number().optional(),
  limit: z.number().optional(),
  length: z.number().optional(),
  total: z.number().optional(),
  users: z.array(userSchema),
});

const logSchema = z.object({
  _id: idString,
  log_id: z.string().nullish(),
  date: z.string(),
  type: z.string(),
  user_id: z.string().nullish(),
  user_name: z.string().nullish(),
  client_id: z.string().nullish(),
  ip: z.string().nullish(),
  connection: z.string().nullish(),
  strategy: z.string().nullish(),
});

const logsResponseSchema = z.array(logSchema);

const dailyStatSchema = z.object({
  date: z.string(),
  logins: z.number().nullish(),
  signups: z.number().nullish(),
  leaked_passwords: z.number().nullish(),
  updated_at: z.string().nullish(),
  created_at: z.string().nullish(),
});

const dailyStatsResponseSchema = z.array(dailyStatSchema);

export const auth0Resources = defineResources({
  [USER_ENTITY]: {
    shape: 'entity',
    filterable: [
      { field: 'blocked', ops: ['eq'], values: ['true', 'false'] },
      { field: 'identityProvider', ops: ['eq'] },
    ],
    description:
      'Auth0 users keyed by user_id, with email, primary identity provider, last login, login count, and blocked flag.',
    endpoint: 'GET /api/v2/users',
    notes:
      'Uses offset pagination (page / per_page) and is capped at the first 1000 users per sync. Incremental syncs filter on updated_at via the q parameter.',
    fields: [
      { name: 'email', description: 'Primary email address.' },
      {
        name: 'identityProvider',
        description:
          'Provider of the primary identity (e.g. auth0, google-oauth2, samlp).',
      },
      {
        name: 'lastLogin',
        description: 'Most recent login timestamp (Unix ms).',
      },
      {
        name: 'loginsCount',
        description: 'Total successful logins (counter maintained by Auth0).',
      },
      {
        name: 'blocked',
        description: 'Whether the user has been administratively blocked.',
      },
      {
        name: 'createdAt',
        description: 'When the user record was created (Unix ms).',
      },
    ],
    responses: {
      oauth_token: oauthTokenSchema,
      users: usersResponseSchema,
    },
  },
  [LOGIN_EVENT]: {
    shape: 'event',
    filterable: [
      {
        field: 'type',
        ops: ['eq'],
        values: ['s', 'f', 'seacft', 'fp'],
      },
    ],
    description:
      'Login / authentication events from the Auth0 Logs endpoint. One event per log row of type s (success), f (failure), seacft (token exchange success), or fp (failed change password).',
    endpoint: 'GET /api/v2/logs',
    notes:
      'Uses offset pagination (page / per_page) and is capped at the first 1000 events per sync. Incremental syncs filter on date via the q parameter.',
    fields: [
      { name: 'logId', description: 'Auth0 log row id.' },
      {
        name: 'type',
        description: 'Auth0 log type (s, f, seacft, fp).',
      },
      {
        name: 'userId',
        description: 'Auth0 user_id the event belongs to (may be null).',
      },
      { name: 'ip', description: 'Source IP of the login attempt.' },
      {
        name: 'connection',
        description: 'Connection name used for the login.',
      },
      {
        name: 'strategy',
        description:
          'Identity provider strategy (e.g. auth0, google-oauth2, samlp).',
      },
    ],
    responses: { logs: logsResponseSchema },
  },
  [DAILY_METRIC]: {
    shape: 'metric',
    description:
      'Daily logins and signups, one sample per day for the configured lookback window (up to 30 days, the Daily Stats endpoint maximum).',
    endpoint: 'GET /api/v2/stats/daily',
    unit: 'count',
    granularity: '1d',
    dimensions: [
      {
        name: 'kind',
        description: 'Either "logins" or "signups".',
      },
    ],
    responses: { daily_stats: dailyStatsResponseSchema },
  },
});

export const id = 'auth0';

type UsersResponse = z.infer<typeof usersResponseSchema>;
type LogsResponse = z.infer<typeof logsResponseSchema>;
type DailyStatsResponse = z.infer<typeof dailyStatsResponseSchema>;
type OauthTokenResponse = z.infer<typeof oauthTokenSchema>;
type Auth0User = z.infer<typeof userSchema>;
type Auth0Log = z.infer<typeof logSchema>;
type Auth0DailyStat = z.infer<typeof dailyStatSchema>;

function escapeLuceneRange(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return d.toISOString();
}

function isLogEventType(value: string): value is LogEventType {
  return (LOG_EVENT_TYPES as readonly string[]).includes(value);
}

function primaryIdentityProvider(user: Auth0User): string | null {
  const identities = user.identities ?? [];
  const first = identities[0];
  if (!first) {
    const id = user.user_id;
    const sep = id.indexOf('|');
    return sep > 0 ? id.slice(0, sep) : null;
  }
  return first.provider ?? null;
}

function yyyymmdd(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

export class Auth0Connector extends BaseConnector<
  Auth0Settings,
  Auth0Credentials
> {
  static readonly id = id;

  static readonly resources = auth0Resources;

  static readonly schemas = schemasFromResources(auth0Resources);

  static create(input: unknown, ctx?: ConnectorContext): Auth0Connector {
    const parsed = configFields.parse(input);
    return new Auth0Connector(
      {
        domain: parsed.domain,
        resources: parsed.resources,
        statsLookbackDays: parsed.statsLookbackDays,
      },
      {
        clientId: parsed.clientId,
        clientSecret: parsed.clientSecret,
      },
      ctx,
    );
  }

  readonly id = id;
  override readonly credentials = auth0Credentials;

  private accessToken: string | null = null;

  private baseUrl(): string {
    return `https://${this.settings.domain}`;
  }

  private audience(): string {
    return `https://${this.settings.domain}/api/v2/`;
  }

  private async refreshAccessToken(signal?: AbortSignal): Promise<string> {
    const res = await this.post<OauthTokenResponse>(
      `${this.baseUrl()}/oauth/token`,
      {
        resource: 'oauth_token',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': connectorUserAgent('auth0'),
        },
        body: JSON.stringify({
          grant_type: 'client_credentials',
          client_id: this.creds.clientId,
          client_secret: this.creds.clientSecret,
          audience: this.audience(),
        }),
        signal,
      },
    );
    return res.body.access_token;
  }

  private async getAccessToken(signal?: AbortSignal): Promise<string> {
    if (!this.accessToken) {
      this.accessToken = await this.refreshAccessToken(signal);
    }
    return this.accessToken;
  }

  private async apiGet<T>(
    url: string,
    resource: string,
    signal?: AbortSignal,
  ): Promise<HttpResponse<T>> {
    const token = await this.getAccessToken(signal);
    return this.get<T>(url, {
      resource,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'User-Agent': connectorUserAgent('auth0'),
      },
      rateLimit: auth0RateLimit,
      signal,
    });
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

  private buildUsersUrl(page: number, options: SyncOptions): string {
    const u = new URL(`${this.baseUrl()}/api/v2/users`);
    u.searchParams.set('page', String(page));
    u.searchParams.set('per_page', String(PAGE_SIZE));
    u.searchParams.set('include_totals', 'true');
    u.searchParams.set('sort', 'updated_at:1');
    if (options.since) {
      const iso = escapeLuceneRange(options.since);
      u.searchParams.set('q', `updated_at:[${iso} TO *]`);
      u.searchParams.set('search_engine', 'v3');
    }
    return u.toString();
  }

  private buildLogsUrl(page: number, options: SyncOptions): string {
    const u = new URL(`${this.baseUrl()}/api/v2/logs`);
    u.searchParams.set('page', String(page));
    u.searchParams.set('per_page', String(PAGE_SIZE));
    u.searchParams.set('include_totals', 'false');
    u.searchParams.set('sort', 'date:1');
    const typeClause = LOG_EVENT_TYPES.map((t) => `type:"${t}"`).join(' OR ');
    const clauses: string[] = [`(${typeClause})`];
    if (options.since) {
      clauses.push(`date:[${escapeLuceneRange(options.since)} TO *]`);
    }
    u.searchParams.set('q', clauses.join(' AND '));
    return u.toString();
  }

  private buildDailyStatsUrl(options: SyncOptions): string {
    const lookback =
      this.settings.statsLookbackDays ?? DEFAULT_STATS_LOOKBACK_DAYS;
    const to = new Date();
    let from = new Date(to.getTime() - (lookback - 1) * 24 * 60 * 60 * 1000);
    if (options.since) {
      const sinceMs = Date.parse(options.since);
      if (Number.isFinite(sinceMs)) {
        const sinceDate = new Date(sinceMs);
        if (sinceDate.getTime() > from.getTime()) {
          from = sinceDate;
        }
      }
    }
    const u = new URL(`${this.baseUrl()}/api/v2/stats/daily`);
    u.searchParams.set('from', yyyymmdd(from));
    u.searchParams.set('to', yyyymmdd(to));
    return u.toString();
  }

  private async fetchUsersPage(
    page: string | null,
    options: SyncOptions,
    signal: AbortSignal | undefined,
  ): Promise<{ items: Auth0User[]; next: string | null }> {
    const pageNum = this.parsePageCursor(page);
    const url = this.buildUsersUrl(pageNum, options);
    const res = await this.apiGet<UsersResponse>(url, 'users', signal);
    const users = res.body.users;
    const length = res.body.length ?? users.length;
    const nextPage = pageNum + 1;
    const hasMore = length >= PAGE_SIZE && nextPage < MAX_USER_PAGES;
    return { items: users, next: hasMore ? String(nextPage) : null };
  }

  private async fetchLogsPage(
    page: string | null,
    options: SyncOptions,
    signal: AbortSignal | undefined,
  ): Promise<{ items: Auth0Log[]; next: string | null }> {
    const pageNum = this.parsePageCursor(page);
    const url = this.buildLogsUrl(pageNum, options);
    const res = await this.apiGet<LogsResponse>(url, 'logs', signal);
    const logs = res.body;
    const nextPage = pageNum + 1;
    const hasMore = logs.length >= PAGE_SIZE && nextPage < MAX_USER_PAGES;
    return { items: logs, next: hasMore ? String(nextPage) : null };
  }

  private async fetchDailyStats(
    page: string | null,
    options: SyncOptions,
    signal: AbortSignal | undefined,
  ): Promise<{ items: Auth0DailyStat[]; next: string | null }> {
    if (page !== null) {
      return { items: [], next: null };
    }
    const url = this.buildDailyStatsUrl(options);
    const res = await this.apiGet<DailyStatsResponse>(
      url,
      'daily_stats',
      signal,
    );
    return { items: res.body, next: null };
  }

  private async writeUsers(
    storage: StorageHandle,
    items: Auth0User[],
  ): Promise<void> {
    for (const u of items) {
      const lastLoginMs = parseEpoch(u.last_login ?? null, 'iso');
      const createdMs = parseEpoch(u.created_at ?? null, 'iso');
      const updatedMs = parseEpoch(u.updated_at ?? null, 'iso');
      await storage.entity({
        type: USER_ENTITY,
        id: u.user_id,
        attributes: {
          email: u.email ?? null,
          identityProvider: primaryIdentityProvider(u),
          lastLogin: lastLoginMs,
          loginsCount: u.logins_count ?? null,
          blocked: u.blocked ?? false,
          createdAt: createdMs,
        },
        updated_at: updatedMs ?? createdMs ?? 0,
      });
    }
  }

  private async writeLogs(
    storage: StorageHandle,
    items: Auth0Log[],
  ): Promise<void> {
    for (const log of items) {
      const ts = parseEpoch(log.date, 'iso');
      if (ts === null) {
        continue;
      }
      if (!isLogEventType(log.type)) {
        continue;
      }
      await storage.event({
        name: LOGIN_EVENT,
        start_ts: ts,
        end_ts: null,
        attributes: {
          logId: log._id,
          type: log.type,
          userId: log.user_id ?? null,
          ip: log.ip ?? null,
          connection: log.connection ?? null,
          strategy: log.strategy ?? null,
        },
      });
    }
  }

  private async writeDailyStats(
    storage: StorageHandle,
    items: Auth0DailyStat[],
  ): Promise<void> {
    const samples: Array<{
      name: string;
      ts: number;
      value: number;
      attributes: Record<string, string | number>;
    }> = [];
    for (const stat of items) {
      const ts = parseEpoch(stat.date, 'iso');
      if (ts === null) {
        continue;
      }
      if (typeof stat.logins === 'number' && Number.isFinite(stat.logins)) {
        samples.push({
          name: DAILY_METRIC,
          ts,
          value: stat.logins,
          attributes: { kind: 'logins' },
        });
      }
      if (typeof stat.signups === 'number' && Number.isFinite(stat.signups)) {
        samples.push({
          name: DAILY_METRIC,
          ts,
          value: stat.signups,
          attributes: { kind: 'signups' },
        });
      }
    }
    if (samples.length > 0) {
      await storage.metrics(samples, { names: [DAILY_METRIC] });
    }
  }

  private async writePhase(
    storage: StorageHandle,
    phase: Auth0Phase,
    items: unknown[],
  ): Promise<void> {
    switch (phase) {
      case 'users':
        return this.writeUsers(storage, items as Auth0User[]);
      case 'login_events':
        return this.writeLogs(storage, items as Auth0Log[]);
      case 'daily_active_users':
        return this.writeDailyStats(storage, items as Auth0DailyStat[]);
    }
  }

  private async clearScopeOnFirstPage(
    storage: StorageHandle,
    phase: Auth0Phase,
    isFull: boolean,
  ): Promise<void> {
    if (!isFull) {
      return;
    }
    switch (phase) {
      case 'users':
        await storage.entities([], { types: [USER_ENTITY] });
        return;
      case 'login_events':
        await storage.events([], { names: [LOGIN_EVENT] });
        return;
      case 'daily_active_users':
        await storage.metrics([], { names: [DAILY_METRIC] });
        return;
    }
  }

  private resolveCursor(cursor: unknown): Auth0SyncCursor | undefined {
    return isAuth0SyncCursor(cursor) ? cursor : undefined;
  }

  async sync(
    options: SyncOptions,
    storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const cursor = this.resolveCursor(options.cursor);
    const isFull = options.mode === 'full';

    const phases = selectActivePhases<Auth0Resource, Auth0Phase>(
      (r) => r,
      PHASE_ORDER,
      this.settings.resources,
    );

    return paginateChunked<Auth0Phase, string>({
      phases,
      cursor,
      signal,
      logger: this.logger,
      fetchPage: async (phase, page, sig) => {
        switch (phase) {
          case 'users':
            return this.fetchUsersPage(page, options, sig);
          case 'login_events':
            return this.fetchLogsPage(page, options, sig);
          case 'daily_active_users':
            return this.fetchDailyStats(page, options, sig);
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
