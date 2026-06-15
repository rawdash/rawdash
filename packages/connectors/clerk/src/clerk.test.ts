import { afterEach, describe, expect, it, vi } from 'vitest';

import { ClerkConnector, configFields } from './clerk';

describe('configFields', () => {
  it('parses a valid config', () => {
    const result = configFields.safeParse({
      secretKey: { $secret: 'CLERK_SECRET_KEY' },
    });
    expect(result.success).toBe(true);
  });

  it('parses a config with a resources allowlist and DAU lookback', () => {
    const result = configFields.safeParse({
      secretKey: { $secret: 'CLERK_SECRET_KEY' },
      resources: ['users', 'sessions'],
      dauLookbackDays: 14,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a plain-string secretKey', () => {
    const result = configFields.safeParse({
      secretKey: 'plain',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty secretKey', () => {
    const result = configFields.safeParse({
      secretKey: { $secret: '' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown resource name', () => {
    const result = configFields.safeParse({
      secretKey: { $secret: 'CLERK_SECRET_KEY' },
      resources: ['users', 'invitations'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a dauLookbackDays above 90', () => {
    const result = configFields.safeParse({
      secretKey: { $secret: 'CLERK_SECRET_KEY' },
      dauLookbackDays: 180,
    });
    expect(result.success).toBe(false);
  });

  it('rejects an apiUrl that is not a URL', () => {
    const result = configFields.safeParse({
      secretKey: { $secret: 'CLERK_SECRET_KEY' },
      apiUrl: 'api.clerk.com',
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
    if (u.includes('/v1/users')) {
      return Promise.resolve(jsonResponse([]));
    }
    if (u.includes('/v1/organizations')) {
      return Promise.resolve(jsonResponse({ data: [], total_count: 0 }));
    }
    if (u.includes('/v1/sessions')) {
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

const SECRET_KEY = 'CLERK_SECRET_KEY' as unknown as { $secret: string };

function connector(
  resources?: string[],
  overrides: { apiUrl?: string; dauLookbackDays?: number } = {},
) {
  return new ClerkConnector(
    {
      apiUrl: overrides.apiUrl,
      dauLookbackDays: overrides.dauLookbackDays,
      ...(resources ? { resources: resources as never } : {}),
    },
    { secretKey: SECRET_KEY },
  );
}

describe('ClerkConnector.sync', () => {
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

  it('sends the secret key as a bearer authorization header on API calls', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector(['users']).sync({ mode: 'full' }, makeStorage());

    const apiCall = recordCalls(fetchSpy).find((c) =>
      c.url.includes('/v1/users'),
    );
    expect(apiCall).toBeDefined();
    const authHeader =
      apiCall!.headers['Authorization'] ?? apiCall!.headers['authorization'];
    expect(authHeader).toBe('Bearer CLERK_SECRET_KEY');
  });

  it('writes a user entity from a users response', async () => {
    const fetchSpy = makeFetch((u) => {
      if (u.includes('/v1/users')) {
        return [
          {
            id: 'user_1',
            primary_email_address_id: 'idn_a',
            email_addresses: [
              {
                id: 'idn_a',
                email_address: 'alice@example.com',
                verification: { status: 'verified' },
              },
            ],
            last_sign_in_at: 1_700_000_000_000,
            last_active_at: 1_700_000_100_000,
            created_at: 1_690_000_000_000,
            updated_at: 1_700_000_100_000,
            banned: false,
            locked: false,
          },
        ];
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
        emailVerified: boolean | null;
        lastSignInAt: number;
        lastActiveAt: number;
        banned: boolean;
        createdAt: number;
      };
      updated_at: number;
    };
    expect(entity.type).toBe('clerk_user');
    expect(entity.id).toBe('user_1');
    expect(entity.attributes.email).toBe('alice@example.com');
    expect(entity.attributes.emailVerified).toBe(true);
    expect(entity.attributes.lastSignInAt).toBe(1_700_000_000_000);
    expect(entity.attributes.lastActiveAt).toBe(1_700_000_100_000);
    expect(entity.attributes.banned).toBe(false);
    expect(entity.updated_at).toBe(1_700_000_100_000);
  });

  it('falls back to the first email address when primary_email_address_id does not match', async () => {
    const fetchSpy = makeFetch((u) => {
      if (u.includes('/v1/users')) {
        return [
          {
            id: 'user_2',
            primary_email_address_id: 'idn_missing',
            email_addresses: [
              {
                id: 'idn_only',
                email_address: 'first@example.com',
                verification: { status: 'unverified' },
              },
            ],
            last_sign_in_at: null,
            last_active_at: null,
            created_at: 1_690_000_000_000,
            updated_at: 1_690_000_000_000,
          },
        ];
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['users']).sync({ mode: 'full' }, storage);

    const entity = storage.entity.mock.calls[0]![0] as {
      attributes: { email: string | null; emailVerified: boolean | null };
    };
    expect(entity.attributes.email).toBe('first@example.com');
    expect(entity.attributes.emailVerified).toBe(false);
  });

  it('writes an organization entity from a wrapped data response', async () => {
    const fetchSpy = makeFetch((u) => {
      if (u.includes('/v1/organizations')) {
        return {
          data: [
            {
              id: 'org_1',
              name: 'Acme',
              slug: 'acme',
              members_count: 4,
              created_at: 1_690_000_000_000,
              updated_at: 1_690_000_000_000,
            },
          ],
          total_count: 1,
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['organizations']).sync({ mode: 'full' }, storage);

    expect(storage.entity).toHaveBeenCalledTimes(1);
    const entity = storage.entity.mock.calls[0]![0] as {
      type: string;
      id: string;
      attributes: { name: string; slug: string; membersCount: number };
    };
    expect(entity.type).toBe('clerk_organization');
    expect(entity.id).toBe('org_1');
    expect(entity.attributes.name).toBe('Acme');
    expect(entity.attributes.slug).toBe('acme');
    expect(entity.attributes.membersCount).toBe(4);
  });

  it('emits a session event per session row with a parseable created_at', async () => {
    const fetchSpy = makeFetch((u) => {
      if (u.includes('/v1/sessions')) {
        return [
          {
            id: 'sess_1',
            user_id: 'user_1',
            status: 'active',
            last_active_at: 1_700_000_100_000,
            created_at: 1_700_000_000_000,
          },
          {
            id: 'sess_2',
            user_id: 'user_2',
            status: 'ended',
            last_active_at: 1_700_000_200_000,
            created_at: null,
          },
        ];
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['sessions']).sync({ mode: 'full' }, storage);

    expect(storage.event).toHaveBeenCalledTimes(1);
    const event = storage.event.mock.calls[0]![0] as {
      name: string;
      start_ts: number;
      attributes: { sessionId: string; userId: string; status: string };
    };
    expect(event.name).toBe('clerk_session');
    expect(event.start_ts).toBe(1_700_000_000_000);
    expect(event.attributes.sessionId).toBe('sess_1');
    expect(event.attributes.userId).toBe('user_1');
    expect(event.attributes.status).toBe('active');
  });

  it('only fetches the resources listed in settings.resources', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector(['users']).sync({ mode: 'full' }, makeStorage());

    const calls = recordCalls(fetchSpy);
    expect(calls.some((c) => c.url.includes('/v1/users'))).toBe(true);
    expect(calls.some((c) => c.url.includes('/v1/organizations'))).toBe(false);
    expect(calls.some((c) => c.url.includes('/v1/sessions'))).toBe(false);
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
    await connector(['sessions']).sync(
      { mode: 'latest', since: '2024-01-01T00:00:00Z' },
      storage,
    );
    expect(storage.events).not.toHaveBeenCalled();
  });

  it('pushes a since filter into the users last_active_at_since parameter', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector(['users']).sync(
      { mode: 'latest', since: '2024-01-01T00:00:00.000Z' },
      makeStorage(),
    );

    const queryCall = recordCalls(fetchSpy).find((c) =>
      c.url.includes('/v1/users'),
    );
    expect(queryCall).toBeDefined();
    const sinceParam = new URL(queryCall!.url).searchParams.get(
      'last_active_at_since',
    );
    expect(sinceParam).toBe(String(Date.parse('2024-01-01T00:00:00.000Z')));
  });

  it('paginates users via offset until items.length < limit', async () => {
    let call = 0;
    const fetchSpy = vi
      .fn()
      .mockImplementation((url: string | URL, init?: RequestInit) => {
        const u = typeof url === 'string' ? url : url.toString();
        const method = (init?.method ?? 'GET').toUpperCase();
        if (method === 'GET' && u.includes('/v1/users')) {
          call += 1;
          if (call === 1) {
            const users = Array.from({ length: 500 }, (_, i) => ({
              id: `user_${i}`,
              primary_email_address_id: null,
              email_addresses: [],
              last_sign_in_at: null,
              last_active_at: null,
              created_at: 1_690_000_000_000,
              updated_at: 1_690_000_000_000,
              banned: false,
              locked: false,
            }));
            return Promise.resolve(jsonResponse(users));
          }
          return Promise.resolve(
            jsonResponse([
              {
                id: 'user_extra',
                primary_email_address_id: null,
                email_addresses: [],
                last_sign_in_at: null,
                last_active_at: null,
                created_at: 1_690_000_000_000,
                updated_at: 1_690_000_000_000,
                banned: false,
                locked: false,
              },
            ]),
          );
        }
        return Promise.resolve(jsonResponse({}));
      });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['users']).sync({ mode: 'full' }, storage);

    expect(call).toBe(2);
    expect(storage.entity).toHaveBeenCalledTimes(501);
  });

  it('short-circuits sessions pagination once a page is entirely older than since', async () => {
    const sinceMs = Date.parse('2024-06-01T00:00:00.000Z');
    let call = 0;
    const fetchSpy = vi
      .fn()
      .mockImplementation((url: string | URL, init?: RequestInit) => {
        const u = typeof url === 'string' ? url : url.toString();
        const method = (init?.method ?? 'GET').toUpperCase();
        if (method === 'GET' && u.includes('/v1/sessions')) {
          call += 1;
          const sessions = Array.from({ length: 500 }, (_, i) => ({
            id: `sess_${call}_${i}`,
            user_id: `user_${i}`,
            status: 'active',
            last_active_at: sinceMs - 1_000,
            created_at: sinceMs - 1_000,
          }));
          return Promise.resolve(jsonResponse(sessions));
        }
        return Promise.resolve(jsonResponse({}));
      });
    vi.stubGlobal('fetch', fetchSpy);

    await connector(['sessions']).sync(
      { mode: 'latest', since: '2024-06-01T00:00:00.000Z' },
      makeStorage(),
    );

    expect(call).toBe(1);
  });

  it('resumes from a saved cursor, skipping earlier phases', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector().sync(
      { mode: 'full', cursor: { phase: 'sessions', page: '0' } },
      makeStorage(),
    );

    const calls = recordCalls(fetchSpy);
    expect(calls.some((c) => c.url.includes('/v1/organizations'))).toBe(false);
    expect(calls.some((c) => c.url.includes('/v1/sessions'))).toBe(true);
  });

  it('uses the configured apiUrl override', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector(['users'], { apiUrl: 'https://api.clerk.dev' }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const calls = recordCalls(fetchSpy);
    expect(
      calls.some((c) => c.url.startsWith('https://api.clerk.dev/v1/users')),
    ).toBe(true);
  });

  it('writes daily_active_users metric samples bucketed by day of last_active_at', async () => {
    const day0 = Math.floor(Date.now() / 86_400_000) * 86_400_000;
    const day1 = day0 - 86_400_000;
    const fetchSpy = makeFetch((u) => {
      if (u.includes('/v1/users')) {
        return [
          {
            id: 'user_a',
            primary_email_address_id: null,
            email_addresses: [],
            last_sign_in_at: null,
            last_active_at: day0 + 1_000,
            created_at: 1_690_000_000_000,
            updated_at: 1_690_000_000_000,
            banned: false,
          },
          {
            id: 'user_b',
            primary_email_address_id: null,
            email_addresses: [],
            last_sign_in_at: null,
            last_active_at: day0 + 5_000,
            created_at: 1_690_000_000_000,
            updated_at: 1_690_000_000_000,
            banned: false,
          },
          {
            id: 'user_c',
            primary_email_address_id: null,
            email_addresses: [],
            last_sign_in_at: null,
            last_active_at: day1 + 5_000,
            created_at: 1_690_000_000_000,
            updated_at: 1_690_000_000_000,
            banned: false,
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
    }>;
    const scope = lastCall![1] as { names: string[] };
    expect(scope.names).toEqual(['clerk_daily_active_users']);
    expect(samples).toHaveLength(2);
    const byDay = new Map(samples.map((s) => [s.ts, s.value]));
    expect(byDay.get(day0)).toBe(2);
    expect(byDay.get(day1)).toBe(1);
    expect(samples[0]!.name).toBe('clerk_daily_active_users');
  });
});

describe('ClerkConnector.create', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns a configured instance from JSON input', () => {
    vi.stubEnv('CLERK_SECRET_KEY', 'sk_test_abc');
    const c = ClerkConnector.create({
      secretKey: { $secret: 'CLERK_SECRET_KEY' },
    });
    expect(c).toBeInstanceOf(ClerkConnector);
    expect(c.id).toBe('clerk');
  });
});
