import { afterEach, describe, expect, it, vi } from 'vitest';

import { Auth0Connector, configFields } from './auth0';

describe('configFields', () => {
  it('parses a valid config', () => {
    const result = configFields.safeParse({
      domain: 'acme.us.auth0.com',
      clientId: 'AbCdEf',
      clientSecret: { $secret: 'AUTH0_CLIENT_SECRET' },
    });
    expect(result.success).toBe(true);
  });

  it('parses a config with a resources allowlist and stats lookback', () => {
    const result = configFields.safeParse({
      domain: 'acme.us.auth0.com',
      clientId: 'AbCdEf',
      clientSecret: { $secret: 'AUTH0_CLIENT_SECRET' },
      resources: ['users', 'login_events'],
      statsLookbackDays: 7,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a plain-string clientSecret', () => {
    const result = configFields.safeParse({
      domain: 'acme.us.auth0.com',
      clientId: 'AbCdEf',
      clientSecret: 'plain',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-auth0.com domain', () => {
    const result = configFields.safeParse({
      domain: 'acme.example.com',
      clientId: 'AbCdEf',
      clientSecret: { $secret: 'AUTH0_CLIENT_SECRET' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a domain with a scheme', () => {
    const result = configFields.safeParse({
      domain: 'https://acme.us.auth0.com',
      clientId: 'AbCdEf',
      clientSecret: { $secret: 'AUTH0_CLIENT_SECRET' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown resource name', () => {
    const result = configFields.safeParse({
      domain: 'acme.us.auth0.com',
      clientId: 'AbCdEf',
      clientSecret: { $secret: 'AUTH0_CLIENT_SECRET' },
      resources: ['users', 'rules'],
    });
    expect(result.success).toBe(false);
  });

  it('accepts a statsLookbackDays above 30', () => {
    const result = configFields.safeParse({
      domain: 'acme.us.auth0.com',
      clientId: 'AbCdEf',
      clientSecret: { $secret: 'AUTH0_CLIENT_SECRET' },
      statsLookbackDays: 90,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a non-positive statsLookbackDays', () => {
    const result = configFields.safeParse({
      domain: 'acme.us.auth0.com',
      clientId: 'AbCdEf',
      clientSecret: { $secret: 'AUTH0_CLIENT_SECRET' },
      statsLookbackDays: 0,
    });
    expect(result.success).toBe(false);
  });
});

interface MockCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'application/json' }),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

function makeFetch(route: (url: string, method: string) => unknown) {
  return vi.fn().mockImplementation((url: string | URL, init?: RequestInit) => {
    const u = typeof url === 'string' ? url : url.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    const explicit = route(u, method);
    if (explicit !== undefined) {
      return Promise.resolve(jsonResponse(explicit));
    }
    if (u.includes('/oauth/token')) {
      return Promise.resolve(jsonResponse({ access_token: 'tok' }));
    }
    if (u.includes('/api/v2/users')) {
      return Promise.resolve(jsonResponse({ users: [], length: 0 }));
    }
    if (u.includes('/api/v2/logs')) {
      return Promise.resolve(jsonResponse([]));
    }
    if (u.includes('/api/v2/stats/daily')) {
      return Promise.resolve(jsonResponse([]));
    }
    return Promise.resolve(jsonResponse({}));
  });
}

function recordCalls(spy: ReturnType<typeof vi.fn>): MockCall[] {
  return spy.mock.calls.map((c: unknown[]) => {
    const init = (c[1] ?? {}) as RequestInit;
    return {
      url: String(c[0]),
      method: (init.method ?? 'GET').toUpperCase(),
      headers: (init.headers ?? {}) as Record<string, string>,
      body:
        typeof init.body === 'string'
          ? init.body
          : init.body === undefined
            ? undefined
            : String(init.body),
    };
  });
}

function makeStorage() {
  return {
    event: vi.fn().mockResolvedValue(undefined),
    entity: vi.fn().mockResolvedValue(undefined),
    metric: vi.fn().mockResolvedValue(undefined),
    edge: vi.fn().mockResolvedValue(undefined),
    distribution: vi.fn().mockResolvedValue(undefined),
    events: vi.fn().mockResolvedValue(undefined),
    entities: vi.fn().mockResolvedValue(undefined),
    metrics: vi.fn().mockResolvedValue(undefined),
    edges: vi.fn().mockResolvedValue(undefined),
    distributions: vi.fn().mockResolvedValue(undefined),
    queryEvents: vi.fn().mockResolvedValue([]),
    getEntity: vi.fn().mockResolvedValue(null),
    queryEntities: vi.fn().mockResolvedValue([]),
    queryMetrics: vi.fn().mockResolvedValue([]),
    traverse: vi.fn().mockResolvedValue([]),
    queryDistributions: vi.fn().mockResolvedValue([]),
    deleteOlderThan: vi.fn().mockResolvedValue({ rowsDeleted: 0 }),
  };
}

const CLIENT_SECRET = 'AUTH0_CLIENT_SECRET' as unknown as { $secret: string };

function connector(
  resources?: string[],
  overrides: { domain?: string; statsLookbackDays?: number } = {},
) {
  return new Auth0Connector(
    {
      domain: overrides.domain ?? 'acme.us.auth0.com',
      statsLookbackDays: overrides.statsLookbackDays,
      ...(resources ? { resources: resources as never } : {}),
    },
    {
      clientId: 'AbCdEf',
      clientSecret: CLIENT_SECRET,
    },
  );
}

describe('Auth0Connector.sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns done:true when every phase is empty', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetch(() => undefined),
    );
    const result = await connector().sync({ mode: 'full' }, makeStorage());
    expect(result.done).toBe(true);
  });

  it('mints an M2M access token once and reuses it across phases', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector().sync({ mode: 'full' }, makeStorage());

    const tokenCalls = recordCalls(fetchSpy).filter((c) =>
      c.url.includes('/oauth/token'),
    );
    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0]!.method).toBe('POST');
    const body = JSON.parse(String(tokenCalls[0]!.body));
    expect(body.grant_type).toBe('client_credentials');
    expect(body.client_id).toBe('AbCdEf');
    expect(body.client_secret).toBe('AUTH0_CLIENT_SECRET');
    expect(body.audience).toBe('https://acme.us.auth0.com/api/v2/');
  });

  it('sends the access token as a bearer authorization header on API calls', async () => {
    const fetchSpy = makeFetch((u) => {
      if (u.includes('/oauth/token')) {
        return { access_token: 'real_access_token' };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    await connector(['users']).sync({ mode: 'full' }, makeStorage());

    const apiCall = recordCalls(fetchSpy).find((c) =>
      c.url.includes('/api/v2/users'),
    );
    expect(apiCall).toBeDefined();
    const authHeader =
      apiCall!.headers['Authorization'] ?? apiCall!.headers['authorization'];
    expect(authHeader).toBe('Bearer real_access_token');
  });

  it('writes a user entity from a users response', async () => {
    const fetchSpy = makeFetch((u) => {
      if (u.includes('/api/v2/users')) {
        return {
          users: [
            {
              user_id: 'auth0|user_1',
              email: 'alice@example.com',
              email_verified: true,
              identities: [
                {
                  provider: 'google-oauth2',
                  connection: 'google',
                  isSocial: true,
                },
              ],
              last_login: '2024-03-15T12:00:00.000Z',
              logins_count: 17,
              created_at: '2024-01-01T00:00:00.000Z',
              updated_at: '2024-03-15T12:00:00.000Z',
              blocked: false,
            },
          ],
          length: 1,
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['users']).sync({ mode: 'full' }, storage);

    expect(storage.entity).toHaveBeenCalledTimes(1);
    const entity = storage.entity.mock.calls[0]![0] as {
      type: string;
      id: string;
      attributes: {
        email: string;
        identityProvider: string;
        loginsCount: number;
        blocked: boolean;
        lastLogin: number;
      };
      updated_at: number;
    };
    expect(entity.type).toBe('auth0_user');
    expect(entity.id).toBe('auth0|user_1');
    expect(entity.attributes.email).toBe('alice@example.com');
    expect(entity.attributes.identityProvider).toBe('google-oauth2');
    expect(entity.attributes.loginsCount).toBe(17);
    expect(entity.attributes.blocked).toBe(false);
    expect(entity.attributes.lastLogin).toBe(
      Date.parse('2024-03-15T12:00:00.000Z'),
    );
    expect(entity.updated_at).toBe(Date.parse('2024-03-15T12:00:00.000Z'));
  });

  it('derives identityProvider from the user_id prefix when identities is empty', async () => {
    const fetchSpy = makeFetch((u) => {
      if (u.includes('/api/v2/users')) {
        return {
          users: [
            {
              user_id: 'samlp|tenant|user_2',
              email: null,
              identities: [],
              last_login: null,
              logins_count: 0,
              created_at: '2024-01-02T00:00:00.000Z',
              updated_at: '2024-01-02T00:00:00.000Z',
              blocked: false,
            },
          ],
          length: 1,
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['users']).sync({ mode: 'full' }, storage);

    const entity = storage.entity.mock.calls[0]![0] as {
      attributes: { identityProvider: string | null };
    };
    expect(entity.attributes.identityProvider).toBe('samlp');
  });

  it('emits a login event per log row with a known type', async () => {
    const fetchSpy = makeFetch((u) => {
      if (u.includes('/api/v2/logs')) {
        if (new URL(u).searchParams.get('from')) {
          return [];
        }
        return [
          {
            _id: 'log_1',
            date: '2024-02-01T00:00:00.000Z',
            type: 's',
            user_id: 'auth0|user_1',
            ip: '203.0.113.10',
            connection: 'Username-Password-Authentication',
            strategy: 'auth0',
          },
          {
            _id: 'log_2',
            date: '2024-02-02T00:00:00.000Z',
            type: 'f',
            user_id: 'auth0|user_2',
            ip: '203.0.113.20',
            connection: 'Username-Password-Authentication',
            strategy: 'auth0',
          },
          {
            _id: 'log_3',
            date: '2024-02-03T00:00:00.000Z',
            type: 'depnote',
            user_id: null,
          },
        ];
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['login_events']).sync({ mode: 'full' }, storage);

    expect(storage.event).toHaveBeenCalledTimes(2);
    const first = storage.event.mock.calls[0]![0] as {
      name: string;
      start_ts: number;
      attributes: { logId: string; type: string };
    };
    expect(first.name).toBe('auth0_login_event');
    expect(first.start_ts).toBe(Date.parse('2024-02-01T00:00:00.000Z'));
    expect(first.attributes.logId).toBe('log_1');
    expect(first.attributes.type).toBe('s');
  });

  it('writes one metric sample per (date, kind) from the daily stats endpoint', async () => {
    const fetchSpy = makeFetch((u) => {
      if (u.includes('/api/v2/stats/daily')) {
        return [
          {
            date: '2024-04-01T00:00:00.000Z',
            logins: 120,
            signups: 8,
          },
          {
            date: '2024-04-02T00:00:00.000Z',
            logins: 95,
            signups: 0,
          },
        ];
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['daily_active_users']).sync({ mode: 'full' }, storage);

    expect(storage.metrics).toHaveBeenCalled();
    const lastCall =
      storage.metrics.mock.calls[storage.metrics.mock.calls.length - 1];
    const samples = lastCall![0] as Array<{
      name: string;
      ts: number;
      value: number;
      attributes: { kind: string };
    }>;
    expect(samples).toHaveLength(4);
    expect(samples[0]!.attributes.kind).toBe('logins');
    expect(samples[0]!.value).toBe(120);
    expect(samples[1]!.attributes.kind).toBe('signups');
    expect(samples[1]!.value).toBe(8);
  });

  it('only fetches the resources listed in settings.resources', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector(['users']).sync({ mode: 'full' }, makeStorage());

    const calls = recordCalls(fetchSpy);
    expect(calls.some((c) => c.url.includes('/api/v2/users'))).toBe(true);
    expect(calls.some((c) => c.url.includes('/api/v2/logs'))).toBe(false);
    expect(calls.some((c) => c.url.includes('/api/v2/stats/daily'))).toBe(
      false,
    );
  });

  it('does not clear entity scopes on incremental sync', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetch(() => undefined),
    );
    const storage = makeStorage();
    await connector(['users']).sync(
      { mode: 'latest', since: '2024-01-01T00:00:00Z' },
      storage,
    );
    expect(storage.entities).not.toHaveBeenCalled();
  });

  it('clears event scope only on full sync, not on incremental', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetch(() => undefined),
    );
    const storage = makeStorage();
    await connector(['login_events']).sync(
      { mode: 'latest', since: '2024-01-01T00:00:00Z' },
      storage,
    );
    expect(storage.events).not.toHaveBeenCalled();
  });

  it('pushes a since filter into the users q parameter', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector(['users']).sync(
      { mode: 'latest', since: '2024-01-01T00:00:00.000Z' },
      makeStorage(),
    );

    const queryCall = recordCalls(fetchSpy).find((c) =>
      c.url.includes('/api/v2/users'),
    );
    expect(queryCall).toBeDefined();
    const q = new URL(queryCall!.url).searchParams.get('q');
    expect(q).toContain('updated_at:');
    expect(q).toContain('2024-01-01T00:00:00.000Z');
  });

  it('paginates logs past 1000 events via checkpoint from', async () => {
    const TOTAL = 1100;
    const all = Array.from({ length: TOTAL }, (_, i) => ({
      _id: `log_${String(i).padStart(5, '0')}`,
      date: '2024-02-01T00:00:00.000Z',
      type: 's' as const,
      user_id: `auth0|user_${i}`,
      ip: '203.0.113.10',
      connection: 'Username-Password-Authentication',
      strategy: 'auth0',
    }));
    const fetchSpy = makeFetch((u) => {
      if (u.includes('/api/v2/logs')) {
        const from = new URL(u).searchParams.get('from');
        const startIdx = from ? all.findIndex((l) => l._id === from) + 1 : 0;
        return all.slice(startIdx, startIdx + 100);
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['login_events']).sync({ mode: 'full' }, storage);

    expect(storage.event).toHaveBeenCalledTimes(TOTAL);
  });

  it('advances the logs checkpoint by the last seen log_id', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      _id: `log_a_${String(i).padStart(3, '0')}`,
      date: '2024-02-01T00:00:00.000Z',
      type: 's' as const,
      user_id: `auth0|user_${i}`,
    }));
    const fetchSpy = makeFetch((u) => {
      if (u.includes('/api/v2/logs')) {
        const from = new URL(u).searchParams.get('from');
        if (!from) {
          return page1;
        }
        return [];
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    await connector(['login_events']).sync({ mode: 'full' }, makeStorage());

    const logCalls = recordCalls(fetchSpy).filter((c) =>
      c.url.includes('/api/v2/logs'),
    );
    expect(logCalls.length).toBeGreaterThanOrEqual(2);
    expect(new URL(logCalls[0]!.url).searchParams.get('from')).toBeNull();
    expect(new URL(logCalls[1]!.url).searchParams.get('from')).toBe(
      'log_a_099',
    );
  });

  it('applies the client-side type filter under checkpoint pagination', async () => {
    const fetchSpy = makeFetch((u) => {
      if (u.includes('/api/v2/logs')) {
        if (new URL(u).searchParams.get('from')) {
          return [];
        }
        return [
          { _id: 'log_1', date: '2024-02-01T00:00:00.000Z', type: 's' },
          { _id: 'log_2', date: '2024-02-02T00:00:00.000Z', type: 'sapi' },
          { _id: 'log_3', date: '2024-02-03T00:00:00.000Z', type: 'f' },
          { _id: 'log_4', date: '2024-02-04T00:00:00.000Z', type: 'depnote' },
        ];
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['login_events']).sync({ mode: 'full' }, storage);

    expect(storage.event).toHaveBeenCalledTimes(2);
    const types = storage.event.mock.calls.map(
      (c) => (c[0] as { attributes: { type: string } }).attributes.type,
    );
    expect(types).toEqual(['s', 'f']);
  });

  it('seeds the logs checkpoint from the last ingested log_id on an incremental sync', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    storage.queryEvents.mockResolvedValue([
      { name: 'auth0_login_event', attributes: { logId: 'log_seed_42' } },
      { name: 'auth0_login_event', attributes: { logId: 'log_seed_07' } },
    ]);

    await connector(['login_events']).sync(
      { mode: 'latest', since: '2024-02-01T00:00:00.000Z' },
      storage,
    );

    const firstLogCall = recordCalls(fetchSpy).find((c) =>
      c.url.includes('/api/v2/logs'),
    );
    expect(firstLogCall).toBeDefined();
    expect(new URL(firstLogCall!.url).searchParams.get('from')).toBe(
      'log_seed_42',
    );
  });

  it('checkpoints on log_id and persists it as logId when it differs from _id', async () => {
    const fetchSpy = makeFetch((u) => {
      if (u.includes('/api/v2/logs')) {
        if (new URL(u).searchParams.get('from')) {
          return [];
        }
        return [
          {
            _id: 'mongo_oid_1',
            log_id: '90020230101000000000000000000001',
            date: '2024-02-01T00:00:00.000Z',
            type: 's',
          },
        ];
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['login_events']).sync({ mode: 'full' }, storage);

    const written = storage.event.mock.calls[0]![0] as {
      attributes: { logId: string };
    };
    expect(written.attributes.logId).toBe('90020230101000000000000000000001');

    const logCalls = recordCalls(fetchSpy).filter((c) =>
      c.url.includes('/api/v2/logs'),
    );
    expect(new URL(logCalls[1]!.url).searchParams.get('from')).toBe(
      '90020230101000000000000000000001',
    );
  });

  it('drops logs older than the since bound client-side', async () => {
    const fetchSpy = makeFetch((u) => {
      if (u.includes('/api/v2/logs')) {
        if (new URL(u).searchParams.get('from')) {
          return [];
        }
        return [
          { _id: 'log_old', date: '2024-01-01T00:00:00.000Z', type: 's' },
          { _id: 'log_new', date: '2024-03-01T00:00:00.000Z', type: 's' },
        ];
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['login_events']).sync(
      { mode: 'latest', since: '2024-02-01T00:00:00.000Z' },
      storage,
    );

    expect(storage.event).toHaveBeenCalledTimes(1);
    const written = storage.event.mock.calls[0]![0] as {
      attributes: { logId: string };
    };
    expect(written.attributes.logId).toBe('log_new');
  });

  it('paginates users via page=N until length < per_page', async () => {
    let call = 0;
    const fetchSpy = vi
      .fn()
      .mockImplementation((url: string | URL, init?: RequestInit) => {
        const u = typeof url === 'string' ? url : url.toString();
        const method = (init?.method ?? 'GET').toUpperCase();
        if (u.includes('/oauth/token')) {
          return Promise.resolve(jsonResponse({ access_token: 'tok' }));
        }
        if (method === 'GET' && u.includes('/api/v2/users')) {
          call += 1;
          if (call === 1) {
            const users = Array.from({ length: 100 }, (_, i) => ({
              user_id: `auth0|user_${i}`,
              email: null,
              identities: [],
              last_login: null,
              logins_count: 0,
              created_at: '2024-01-01T00:00:00.000Z',
              updated_at: '2024-01-01T00:00:00.000Z',
              blocked: false,
            }));
            return Promise.resolve(jsonResponse({ users, length: 100 }));
          }
          return Promise.resolve(
            jsonResponse({
              users: [
                {
                  user_id: 'auth0|user_extra',
                  identities: [],
                  email: null,
                  last_login: null,
                  logins_count: 0,
                  created_at: '2024-01-02T00:00:00.000Z',
                  updated_at: '2024-01-02T00:00:00.000Z',
                  blocked: false,
                },
              ],
              length: 1,
            }),
          );
        }
        return Promise.resolve(jsonResponse({}));
      });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['users']).sync({ mode: 'full' }, storage);

    expect(call).toBe(2);
    expect(storage.entity).toHaveBeenCalledTimes(101);
  });

  it('resumes from a saved cursor, skipping earlier phases', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector().sync(
      { mode: 'full', cursor: { phase: 'login_events', page: '0' } },
      makeStorage(),
    );

    const calls = recordCalls(fetchSpy);
    expect(calls.some((c) => c.url.includes('/api/v2/users'))).toBe(false);
    expect(calls.some((c) => c.url.includes('/api/v2/logs'))).toBe(true);
  });

  it('uses the tenant domain for both the audience and the API host', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector(['users'], { domain: 'tenant.eu.auth0.com' }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const calls = recordCalls(fetchSpy);
    const tokenCall = calls.find((c) => c.url.includes('/oauth/token'))!;
    expect(tokenCall.url).toBe('https://tenant.eu.auth0.com/oauth/token');
    expect(JSON.parse(String(tokenCall.body)).audience).toBe(
      'https://tenant.eu.auth0.com/api/v2/',
    );
    expect(
      calls.some((c) =>
        c.url.startsWith('https://tenant.eu.auth0.com/api/v2/users'),
      ),
    ).toBe(true);
  });

  it('caps stats lookback at the configured number of days', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector(['daily_active_users'], { statsLookbackDays: 7 }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const statsCall = recordCalls(fetchSpy).find((c) =>
      c.url.includes('/api/v2/stats/daily'),
    );
    expect(statsCall).toBeDefined();
    const url = new URL(statsCall!.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    expect(from).toMatch(/^\d{8}$/);
    expect(to).toMatch(/^\d{8}$/);
    const fromDate = new Date(
      `${from!.slice(0, 4)}-${from!.slice(4, 6)}-${from!.slice(6, 8)}T00:00:00Z`,
    );
    const toDate = new Date(
      `${to!.slice(0, 4)}-${to!.slice(4, 6)}-${to!.slice(6, 8)}T00:00:00Z`,
    );
    const diffDays = Math.round(
      (toDate.getTime() - fromDate.getTime()) / (24 * 60 * 60 * 1000),
    );
    expect(diffDays).toBe(6);
  });
});

describe('Auth0Connector.create', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns a configured instance from JSON input', () => {
    vi.stubEnv('AUTH0_CLIENT_SECRET', 'cs_test');
    const c = Auth0Connector.create({
      domain: 'acme.us.auth0.com',
      clientId: 'AbCdEf',
      clientSecret: { $secret: 'AUTH0_CLIENT_SECRET' },
    });
    expect(c).toBeInstanceOf(Auth0Connector);
    expect(c.id).toBe('auth0');
  });
});
