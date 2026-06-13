import { afterEach, describe, expect, it, vi } from 'vitest';

import { OktaConnector, configFields } from './okta';

describe('configFields', () => {
  it('parses a valid minimal config', () => {
    const result = configFields.safeParse({
      host: 'acme.okta.com',
      apiToken: { $secret: 'OKTA_API_TOKEN' },
    });
    expect(result.success).toBe(true);
  });

  it('parses a config with explicit resources', () => {
    const result = configFields.safeParse({
      host: 'acme.okta.com',
      apiToken: { $secret: 'OKTA_API_TOKEN' },
      resources: ['users', 'auth_events'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a host that contains a slash or protocol', () => {
    expect(
      configFields.safeParse({
        host: 'https://acme.okta.com',
        apiToken: { $secret: 'OKTA_API_TOKEN' },
      }).success,
    ).toBe(false);
    expect(
      configFields.safeParse({
        host: 'acme.okta.com/api',
        apiToken: { $secret: 'OKTA_API_TOKEN' },
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown resource', () => {
    expect(
      configFields.safeParse({
        host: 'acme.okta.com',
        apiToken: { $secret: 'OKTA_API_TOKEN' },
        resources: ['users', 'apps'],
      }).success,
    ).toBe(false);
  });

  it('rejects a plain string apiToken instead of secret object', () => {
    expect(
      configFields.safeParse({
        host: 'acme.okta.com',
        apiToken: 'abc',
      }).success,
    ).toBe(false);
  });

  it('rejects a config missing required fields', () => {
    expect(configFields.safeParse({}).success).toBe(false);
    expect(
      configFields.safeParse({
        host: 'acme.okta.com',
      }).success,
    ).toBe(false);
  });
});

interface MockCall {
  url: string;
  method: string;
  headers: Record<string, string>;
}

function jsonResponse(
  body: unknown,
  extraHeaders?: Record<string, string>,
): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({
      'content-type': 'application/json',
      ...(extraHeaders ?? {}),
    }),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

function makeFetch(
  route: (
    url: string,
    method: string,
  ) => unknown | { body: unknown; headers?: Record<string, string> },
) {
  return vi.fn().mockImplementation((url: string | URL, init?: RequestInit) => {
    const u = typeof url === 'string' ? url : url.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    const explicit = route(u, method);
    if (explicit !== undefined) {
      if (
        explicit !== null &&
        typeof explicit === 'object' &&
        'body' in (explicit as Record<string, unknown>)
      ) {
        const rec = explicit as {
          body: unknown;
          headers?: Record<string, string>;
        };
        return Promise.resolve(jsonResponse(rec.body, rec.headers));
      }
      return Promise.resolve(jsonResponse(explicit));
    }
    if (u.includes('/api/v1/users')) {
      return Promise.resolve(jsonResponse([]));
    }
    if (u.includes('/api/v1/groups')) {
      return Promise.resolve(jsonResponse([]));
    }
    if (u.includes('/api/v1/logs')) {
      return Promise.resolve(jsonResponse([]));
    }
    return Promise.resolve(jsonResponse([]));
  });
}

function recordCalls(spy: ReturnType<typeof vi.fn>): MockCall[] {
  return spy.mock.calls.map((c: unknown[]) => {
    const init = (c[1] ?? {}) as RequestInit;
    return {
      url: String(c[0]),
      method: (init.method ?? 'GET').toUpperCase(),
      headers: (init.headers ?? {}) as Record<string, string>,
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

const TOKEN = 'OKTA_API_TOKEN' as unknown as { $secret: string };

function connector(
  overrides: {
    resources?: string[];
    host?: string;
  } = {},
) {
  return new OktaConnector(
    {
      host: overrides.host ?? 'acme.okta.com',
      ...(overrides.resources
        ? { resources: overrides.resources as never }
        : {}),
    },
    { apiToken: TOKEN },
  );
}

describe('OktaConnector.sync', () => {
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

  it('clears every entity scope and the event scope at the start of a full sync', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetch(() => undefined),
    );
    const storage = makeStorage();
    await connector().sync({ mode: 'full' }, storage);

    const clearedTypes = storage.entities.mock.calls
      .filter((c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0)
      .map((c) => (c[1] as { types: string[] }).types[0]);
    expect(clearedTypes).toContain('okta_user');
    expect(clearedTypes).toContain('okta_group');

    const clearedEvents = storage.events.mock.calls.map(
      (c) => (c[1] as { names: string[] }).names[0],
    );
    expect(clearedEvents).toContain('okta_auth_event');
  });

  it('does not clear scopes on an incremental sync', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetch(() => undefined),
    );
    const storage = makeStorage();
    await connector().sync(
      { mode: 'latest', since: new Date(Date.now() - 60_000).toISOString() },
      storage,
    );

    const entityClears = storage.entities.mock.calls.filter(
      (c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0,
    );
    expect(entityClears).toHaveLength(0);
    const eventClears = storage.events.mock.calls.filter(
      (c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0,
    );
    expect(eventClears).toHaveLength(0);
  });

  it('writes a user entity from /api/v1/users', async () => {
    const fetchSpy = makeFetch((url, method) => {
      if (method === 'GET' && url.includes('/api/v1/users')) {
        return [
          {
            id: '00u123',
            status: 'ACTIVE',
            created: '2024-01-01T00:00:00Z',
            activated: '2024-01-01T00:05:00Z',
            lastLogin: '2024-02-01T12:00:00Z',
            lastUpdated: '2024-02-01T12:00:00Z',
            profile: {
              firstName: 'Ada',
              lastName: 'Lovelace',
              email: 'ada@example.com',
              login: 'ada@example.com',
            },
          },
        ];
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector({ resources: ['users'] }).sync({ mode: 'full' }, storage);

    const entity = storage.entity.mock.calls[0]![0] as {
      type: string;
      id: string;
      attributes: {
        status: string;
        email: string;
        firstName: string;
        lastLogin: number;
        createdAt: number;
      };
      updated_at: number;
    };
    expect(entity.type).toBe('okta_user');
    expect(entity.id).toBe('00u123');
    expect(entity.attributes.status).toBe('ACTIVE');
    expect(entity.attributes.email).toBe('ada@example.com');
    expect(entity.attributes.firstName).toBe('Ada');
    expect(entity.attributes.lastLogin).toBe(
      Date.parse('2024-02-01T12:00:00Z'),
    );
    expect(entity.attributes.createdAt).toBe(
      Date.parse('2024-01-01T00:00:00Z'),
    );
    expect(entity.updated_at).toBe(Date.parse('2024-02-01T12:00:00Z'));
  });

  it('writes a group entity from /api/v1/groups', async () => {
    const fetchSpy = makeFetch((url, method) => {
      if (method === 'GET' && url.includes('/api/v1/groups')) {
        return [
          {
            id: '00g456',
            type: 'OKTA_GROUP',
            created: '2024-01-01T00:00:00Z',
            lastUpdated: '2024-01-02T00:00:00Z',
            lastMembershipUpdated: '2024-01-03T00:00:00Z',
            profile: { name: 'Engineering', description: 'All engineers' },
          },
        ];
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector({ resources: ['groups'] }).sync({ mode: 'full' }, storage);

    const entity = storage.entity.mock.calls[0]![0] as {
      type: string;
      id: string;
      attributes: { name: string; type: string; description: string };
    };
    expect(entity.type).toBe('okta_group');
    expect(entity.id).toBe('00g456');
    expect(entity.attributes.name).toBe('Engineering');
    expect(entity.attributes.type).toBe('OKTA_GROUP');
    expect(entity.attributes.description).toBe('All engineers');
  });

  it('writes auth events from /api/v1/logs with derived attributes', async () => {
    const fetchSpy = makeFetch((url) => {
      if (url.includes('/api/v1/logs')) {
        return [
          {
            uuid: 'evt-1',
            published: '2024-02-01T12:00:00Z',
            eventType: 'user.session.start',
            severity: 'INFO',
            displayMessage: 'User login',
            actor: {
              id: '00u123',
              type: 'User',
              displayName: 'Ada Lovelace',
              alternateId: 'ada@example.com',
            },
            client: {
              ipAddress: '1.2.3.4',
              userAgent: { browser: 'Chrome', os: 'Mac OS X' },
              geographicalContext: { country: 'United States' },
            },
            authenticationContext: {
              authenticationProvider: 'OKTA_AUTHENTICATION_PROVIDER',
              credentialType: 'PASSWORD',
            },
            outcome: { result: 'SUCCESS' },
          },
        ];
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector({ resources: ['auth_events'] }).sync(
      { mode: 'full' },
      storage,
    );

    const event = storage.event.mock.calls[0]![0] as {
      name: string;
      start_ts: number;
      attributes: {
        eventType: string;
        result: string;
        actorId: string;
        country: string;
        credentialType: string;
        uuid: string;
      };
    };
    expect(event.name).toBe('okta_auth_event');
    expect(event.start_ts).toBe(Date.parse('2024-02-01T12:00:00Z'));
    expect(event.attributes.eventType).toBe('user.session.start');
    expect(event.attributes.result).toBe('SUCCESS');
    expect(event.attributes.actorId).toBe('00u123');
    expect(event.attributes.country).toBe('United States');
    expect(event.attributes.credentialType).toBe('PASSWORD');
    expect(event.attributes.uuid).toBe('evt-1');
  });

  it('skips auth events at or before `since` in incremental mode', async () => {
    const fetchSpy = makeFetch((url) => {
      if (url.includes('/api/v1/logs')) {
        return [
          {
            uuid: 'evt-old',
            published: '2024-02-01T00:00:00Z',
            eventType: 'user.session.start',
            outcome: { result: 'SUCCESS' },
          },
          {
            uuid: 'evt-new',
            published: '2024-02-01T00:01:00Z',
            eventType: 'user.session.start',
            outcome: { result: 'SUCCESS' },
          },
        ];
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector({ resources: ['auth_events'] }).sync(
      { mode: 'latest', since: '2024-02-01T00:00:00.000Z' },
      storage,
    );

    const written = storage.event.mock.calls.map(
      (c) => (c[0] as { attributes: { uuid: string } }).attributes.uuid,
    );
    expect(written).toEqual(['evt-new']);
  });

  it('passes `since` as a SCIM lastUpdated filter to /api/v1/users', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    const since = '2024-01-01T00:00:00.000Z';
    await connector({ resources: ['users'] }).sync(
      { mode: 'latest', since },
      makeStorage(),
    );

    const req = recordCalls(fetchSpy).find((c) =>
      c.url.includes('/api/v1/users'),
    );
    expect(req).toBeDefined();
    const decoded = decodeURIComponent(req!.url.replace(/\+/g, ' '));
    expect(decoded).toContain(`filter=lastUpdated gt "${since}"`);
  });

  it('passes `since` as the logs `since` query param', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    const since = '2024-01-01T00:00:00.000Z';
    await connector({ resources: ['auth_events'] }).sync(
      { mode: 'latest', since },
      makeStorage(),
    );

    const req = recordCalls(fetchSpy).find((c) =>
      c.url.includes('/api/v1/logs'),
    );
    expect(req).toBeDefined();
    expect(req!.url).toContain(`since=${encodeURIComponent(since)}`);
  });

  it('follows the Link rel="next" cursor for /api/v1/users', async () => {
    let calls = 0;
    const fetchSpy = makeFetch((url) => {
      if (url.includes('/api/v1/users')) {
        calls += 1;
        if (calls === 1) {
          return {
            body: [{ id: '00u1', profile: { email: 'a@example.com' } }],
            headers: {
              link: '<https://acme.okta.com/api/v1/users?after=ABC>; rel="next"',
            },
          };
        }
        return { body: [{ id: '00u2', profile: { email: 'b@example.com' } }] };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    await connector({ resources: ['users'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const reqs = recordCalls(fetchSpy).filter((c) =>
      c.url.includes('/api/v1/users'),
    );
    expect(reqs).toHaveLength(2);
    expect(reqs[1]!.url).toContain('after=ABC');
  });

  it('stops following the System Log Link when the next page is empty', async () => {
    let calls = 0;
    const fetchSpy = makeFetch((url) => {
      if (url.includes('/api/v1/logs')) {
        calls += 1;
        if (calls === 1) {
          return {
            body: [
              {
                uuid: 'evt-1',
                published: '2024-02-01T12:00:00Z',
                eventType: 'user.session.start',
              },
            ],
            headers: {
              link: '<https://acme.okta.com/api/v1/logs?after=NEXT>; rel="next"',
            },
          };
        }
        return {
          body: [],
          headers: {
            link: '<https://acme.okta.com/api/v1/logs?after=NEXT2>; rel="next"',
          },
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    await connector({ resources: ['auth_events'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const reqs = recordCalls(fetchSpy).filter((c) =>
      c.url.includes('/api/v1/logs'),
    );
    expect(reqs).toHaveLength(2);
  });

  it('drops Link cursors that point to a different host', async () => {
    let calls = 0;
    const fetchSpy = makeFetch((url) => {
      if (url.includes('/api/v1/users')) {
        calls += 1;
        if (calls === 1) {
          return {
            body: [{ id: '00u1' }],
            headers: {
              link: '<https://attacker.example.com/api/v1/users?after=ABC>; rel="next"',
            },
          };
        }
        return { body: [{ id: '00u2' }] };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    await connector({ resources: ['users'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const reqs = recordCalls(fetchSpy).filter((c) =>
      c.url.includes('/api/v1/users'),
    );
    expect(reqs).toHaveLength(1);
  });

  it('only fetches the resources listed in settings.resources', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector({ resources: ['users', 'groups'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const urls = recordCalls(fetchSpy).map((c) => c.url);
    expect(urls.some((u) => u.includes('/api/v1/users'))).toBe(true);
    expect(urls.some((u) => u.includes('/api/v1/groups'))).toBe(true);
    expect(urls.some((u) => u.includes('/api/v1/logs'))).toBe(false);
  });

  it('resumes from a saved cursor, skipping earlier phases', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector().sync(
      {
        mode: 'full',
        cursor: {
          phase: 'groups',
          page: 'https://acme.okta.com/api/v1/groups?after=OLD',
        },
      },
      makeStorage(),
    );

    const urls = recordCalls(fetchSpy).map((c) => c.url);
    expect(urls.some((u) => u.includes('/api/v1/users'))).toBe(false);
    const groupsCall = urls.find((u) => u.includes('/api/v1/groups'));
    expect(groupsCall).toBeDefined();
    expect(groupsCall!).toContain('after=OLD');
  });

  it('pushes a single status filter onto the users request', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector({ resources: ['users'] }).sync(
      {
        mode: 'full',
        fetchSpecs: {
          okta_user: [
            { filter: [{ field: 'status', op: 'eq', value: 'ACTIVE' }] },
          ],
        },
      } as never,
      makeStorage(),
    );

    const req = recordCalls(fetchSpy).find((c) =>
      c.url.includes('/api/v1/users'),
    );
    expect(req).toBeDefined();
    const decoded = decodeURIComponent(req!.url.replace(/\+/g, ' '));
    expect(decoded).toContain('filter=status eq "ACTIVE"');
  });

  it('does not push a status filter when two specs are provided', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector({ resources: ['users'] }).sync(
      {
        mode: 'full',
        fetchSpecs: {
          okta_user: [
            { filter: [{ field: 'status', op: 'eq', value: 'ACTIVE' }] },
            { filter: [{ field: 'status', op: 'eq', value: 'SUSPENDED' }] },
          ],
        },
      } as never,
      makeStorage(),
    );

    const req = recordCalls(fetchSpy).find((c) =>
      c.url.includes('/api/v1/users'),
    );
    expect(req).toBeDefined();
    const decoded = decodeURIComponent(req!.url.replace(/\+/g, ' '));
    expect(decoded).not.toContain('filter=status eq');
  });

  it('sends the SSWS auth header and routes to the configured host', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector({ resources: ['users'], host: 'rawdash.okta.com' }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const call = recordCalls(fetchSpy)[0]!;
    expect(call.url).toContain('https://rawdash.okta.com/api/v1/users');
    expect(call.headers['authorization']).toBe('SSWS OKTA_API_TOKEN');
    expect(call.headers['accept']).toBe('application/json');
  });
});

describe('OktaConnector.create', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the connector instance directly', () => {
    vi.stubEnv('OKTA_API_TOKEN', 'test_token_fixture');
    const c = OktaConnector.create({
      host: 'acme.okta.com',
      apiToken: { $secret: 'OKTA_API_TOKEN' },
    });
    expect(c).toBeInstanceOf(OktaConnector);
    expect(c.id).toBe('okta');
  });

  it('resolves the env-backed apiToken into the outgoing auth header', async () => {
    vi.stubEnv('OKTA_API_TOKEN', 'test_token_fixture');
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    const c = OktaConnector.create({
      host: 'acme.okta.com',
      apiToken: { $secret: 'OKTA_API_TOKEN' },
      resources: ['users'],
    });
    await c.sync({ mode: 'full' }, makeStorage());

    const call = recordCalls(fetchSpy)[0]!;
    expect(call.headers['authorization']).toBe('SSWS test_token_fixture');
  });
});
