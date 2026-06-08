import { afterEach, describe, expect, it, vi } from 'vitest';

import { ZendeskConnector, configFields } from './zendesk';

describe('configFields', () => {
  it('parses a valid minimal config', () => {
    const result = configFields.safeParse({
      subdomain: 'acme',
      email: 'agent@acme.com',
      apiToken: { $secret: 'ZENDESK_TOKEN' },
    });
    expect(result.success).toBe(true);
  });

  it('parses a config with explicit resources', () => {
    const result = configFields.safeParse({
      subdomain: 'acme',
      email: 'agent@acme.com',
      apiToken: { $secret: 'ZENDESK_TOKEN' },
      resources: ['tickets', 'users'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a subdomain that contains a slash or protocol', () => {
    expect(
      configFields.safeParse({
        subdomain: 'https://acme.zendesk.com',
        email: 'agent@acme.com',
        apiToken: { $secret: 'ZENDESK_TOKEN' },
      }).success,
    ).toBe(false);
    expect(
      configFields.safeParse({
        subdomain: 'acme/something',
        email: 'agent@acme.com',
        apiToken: { $secret: 'ZENDESK_TOKEN' },
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown resource', () => {
    expect(
      configFields.safeParse({
        subdomain: 'acme',
        email: 'agent@acme.com',
        apiToken: { $secret: 'ZENDESK_TOKEN' },
        resources: ['tickets', 'organizations'],
      }).success,
    ).toBe(false);
  });

  it('rejects a plain string apiToken instead of secret object', () => {
    expect(
      configFields.safeParse({
        subdomain: 'acme',
        email: 'agent@acme.com',
        apiToken: 'abc',
      }).success,
    ).toBe(false);
  });

  it('rejects a config missing required fields', () => {
    expect(configFields.safeParse({}).success).toBe(false);
    expect(
      configFields.safeParse({
        subdomain: 'acme',
        apiToken: { $secret: 'ZENDESK_TOKEN' },
      }).success,
    ).toBe(false);
  });
});

interface MockCall {
  url: string;
  method: string;
  headers: Record<string, string>;
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
    if (u.includes('/api/v2/users.json')) {
      return Promise.resolve(jsonResponse({ users: [], meta: {} }));
    }
    if (u.includes('/api/v2/groups.json')) {
      return Promise.resolve(jsonResponse({ groups: [], meta: {} }));
    }
    if (u.includes('/api/v2/incremental/tickets/cursor.json')) {
      return Promise.resolve(
        jsonResponse({ tickets: [], end_of_stream: true }),
      );
    }
    if (u.includes('/api/v2/satisfaction_ratings.json')) {
      return Promise.resolve(
        jsonResponse({ satisfaction_ratings: [], meta: {} }),
      );
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

function expectedBasicAuth(raw: string): string {
  if (typeof btoa === 'function') {
    return `Basic ${btoa(raw)}`;
  }
  const bufferCtor = (
    globalThis as {
      Buffer?: { from: (s: string) => { toString: (enc: string) => string } };
    }
  ).Buffer;
  return `Basic ${bufferCtor!.from(raw).toString('base64')}`;
}

const TOKEN = 'ZENDESK_TOKEN' as unknown as { $secret: string };

function connector(
  overrides: {
    resources?: string[];
    subdomain?: string;
  } = {},
) {
  return new ZendeskConnector(
    {
      subdomain: overrides.subdomain ?? 'acme',
      ...(overrides.resources
        ? { resources: overrides.resources as never }
        : {}),
    },
    { email: 'agent@acme.com', apiToken: TOKEN },
  );
}

describe('ZendeskConnector.sync', () => {
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

  it('clears every entity scope at the start of a full sync', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetch(() => undefined),
    );
    const storage = makeStorage();
    await connector().sync({ mode: 'full' }, storage);

    const clearedTypes = storage.entities.mock.calls
      .filter((c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0)
      .map((c) => (c[1] as { types: string[] }).types[0]);
    expect(clearedTypes).toContain('zendesk_user');
    expect(clearedTypes).toContain('zendesk_group');
    expect(clearedTypes).toContain('zendesk_ticket');
    expect(clearedTypes).toContain('zendesk_satisfaction_rating');
  });

  it('always clears the ticket-event scope, even on an incremental tick', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetch(() => undefined),
    );
    const storage = makeStorage();
    await connector().sync(
      { mode: 'latest', since: new Date(Date.now() - 60_000).toISOString() },
      storage,
    );

    const clearedEvents = storage.events.mock.calls.map(
      (c) => (c[1] as { names: string[] }).names[0],
    );
    expect(clearedEvents).toContain('zendesk_ticket_state_change');

    const entityClears = storage.entities.mock.calls.filter(
      (c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0,
    );
    expect(entityClears).toHaveLength(0);
  });

  it('writes a user entity from /users.json', async () => {
    const fetchSpy = makeFetch((url, method) => {
      if (method === 'GET' && url.includes('/api/v2/users.json')) {
        return {
          users: [
            {
              id: 7,
              name: 'Ada',
              email: 'ada@example.com',
              role: 'agent',
              active: true,
              suspended: false,
              default_group_id: 42,
              created_at: '2024-01-01T00:00:00Z',
              updated_at: '2024-01-02T00:00:00Z',
            },
          ],
          meta: {},
        };
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
        name: string;
        email: string;
        role: string;
        defaultGroupId: string;
        createdAt: number;
      };
      updated_at: number;
    };
    expect(entity.type).toBe('zendesk_user');
    expect(entity.id).toBe('7');
    expect(entity.attributes.name).toBe('Ada');
    expect(entity.attributes.role).toBe('agent');
    expect(entity.attributes.defaultGroupId).toBe('42');
    expect(entity.attributes.createdAt).toBe(
      Date.parse('2024-01-01T00:00:00Z'),
    );
    expect(entity.updated_at).toBe(Date.parse('2024-01-02T00:00:00Z'));
  });

  it('writes a ticket entity with channel resolved via.channel then channel', async () => {
    const fetchSpy = makeFetch((url) => {
      if (url.includes('/incremental/tickets/cursor.json')) {
        return {
          tickets: [
            {
              id: 101,
              subject: 'help',
              status: 'open',
              priority: 'high',
              type: 'incident',
              channel: 'email',
              assignee_id: 7,
              requester_id: 9,
              group_id: 3,
              tags: ['billing', 'urgent'],
              via: { channel: 'web' },
              satisfaction_rating: { score: 'good' },
              created_at: '2024-01-01T00:00:00Z',
              updated_at: '2024-01-02T00:00:00Z',
            },
          ],
          end_of_stream: true,
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector({ resources: ['tickets'] }).sync({ mode: 'full' }, storage);

    const entity = storage.entity.mock.calls[0]![0] as {
      type: string;
      id: string;
      attributes: {
        subject: string;
        status: string;
        priority: string;
        channel: string;
        assigneeId: string;
        groupId: string;
        tags: string[];
        satisfactionScore: string;
      };
    };
    expect(entity.type).toBe('zendesk_ticket');
    expect(entity.id).toBe('101');
    expect(entity.attributes.channel).toBe('web');
    expect(entity.attributes.assigneeId).toBe('7');
    expect(entity.attributes.groupId).toBe('3');
    expect(entity.attributes.tags).toEqual(['billing', 'urgent']);
    expect(entity.attributes.satisfactionScore).toBe('good');
  });

  it('treats an unassigned ticket (null assignee/group) as null', async () => {
    const fetchSpy = makeFetch((url) => {
      if (url.includes('/incremental/tickets/cursor.json')) {
        return {
          tickets: [
            {
              id: 102,
              status: 'new',
              assignee_id: null,
              group_id: null,
              created_at: '2024-01-01T00:00:00Z',
              updated_at: '2024-01-01T00:00:00Z',
            },
          ],
          end_of_stream: true,
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector({ resources: ['tickets'] }).sync({ mode: 'full' }, storage);

    const entity = storage.entity.mock.calls[0]![0] as {
      attributes: { assigneeId: string | null; groupId: string | null };
    };
    expect(entity.attributes.assigneeId).toBeNull();
    expect(entity.attributes.groupId).toBeNull();
  });

  it('emits a created event for every ticket and a solved event for terminal status', async () => {
    const fetchSpy = makeFetch((url) => {
      if (url.includes('/incremental/tickets/cursor.json')) {
        return {
          tickets: [
            {
              id: 200,
              status: 'open',
              created_at: '2024-01-01T00:00:00Z',
              updated_at: '2024-01-02T00:00:00Z',
            },
            {
              id: 201,
              status: 'solved',
              created_at: '2024-01-01T00:00:00Z',
              updated_at: '2024-01-03T00:00:00Z',
            },
            {
              id: 202,
              status: 'closed',
              created_at: '2024-01-01T00:00:00Z',
              updated_at: '2024-01-04T00:00:00Z',
            },
          ],
          end_of_stream: true,
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector({ resources: ['ticket_events'] }).sync(
      { mode: 'full' },
      storage,
    );

    const transitions = storage.event.mock.calls.map(
      (c) =>
        (c[0] as { attributes: { transition: string } }).attributes.transition,
    );
    expect(transitions.filter((t) => t === 'created')).toHaveLength(3);
    expect(transitions.filter((t) => t === 'solved')).toHaveLength(2);

    const solvedEvents = storage.event.mock.calls
      .map(
        (c) =>
          c[0] as {
            name: string;
            start_ts: number;
            attributes: { ticketId: string; transition: string };
          },
      )
      .filter((e) => e.attributes.transition === 'solved');
    expect(solvedEvents[0]!.name).toBe('zendesk_ticket_state_change');
    expect(solvedEvents.map((e) => e.attributes.ticketId).sort()).toEqual([
      '201',
      '202',
    ]);
  });

  it('routes incremental tickets with start_time on the first page and cursor on later pages', async () => {
    let calls = 0;
    const fetchSpy = makeFetch((url) => {
      if (url.includes('/incremental/tickets/cursor.json')) {
        calls += 1;
        if (calls === 1) {
          return {
            tickets: [{ id: 1, created_at: '2024-01-01T00:00:00Z' }],
            after_cursor: 'NEXT_CURSOR',
            end_of_stream: false,
          };
        }
        return {
          tickets: [{ id: 2, created_at: '2024-01-02T00:00:00Z' }],
          end_of_stream: true,
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const since = '2024-01-01T00:00:00.000Z';
    await connector({ resources: ['tickets'] }).sync(
      { mode: 'latest', since },
      makeStorage(),
    );

    const reqs = recordCalls(fetchSpy).filter((c) =>
      c.url.includes('/incremental/tickets/cursor.json'),
    );
    expect(reqs).toHaveLength(2);
    expect(reqs[0]!.url).toContain(
      `start_time=${Math.floor(Date.parse(since) / 1000)}`,
    );
    expect(reqs[1]!.url).toContain('cursor=NEXT_CURSOR');
    expect(reqs[1]!.url).not.toContain('start_time');
  });

  it('forwards page[after] cursors from users.json meta', async () => {
    let calls = 0;
    const fetchSpy = makeFetch((url) => {
      if (url.includes('/api/v2/users.json')) {
        calls += 1;
        if (calls === 1) {
          return {
            users: [{ id: 1 }],
            meta: { has_more: true, after_cursor: 'AFTER_1' },
          };
        }
        return { users: [{ id: 2 }], meta: { has_more: false } };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    await connector({ resources: ['users'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const reqs = recordCalls(fetchSpy).filter((c) =>
      c.url.includes('/api/v2/users.json'),
    );
    expect(reqs).toHaveLength(2);
    expect(reqs[1]!.url).toContain('page%5Bafter%5D=AFTER_1');
  });

  it('only fetches the resources listed in settings.resources', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector({ resources: ['users', 'groups'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const urls = recordCalls(fetchSpy).map((c) => c.url);
    expect(urls.some((u) => u.includes('/api/v2/users.json'))).toBe(true);
    expect(urls.some((u) => u.includes('/api/v2/groups.json'))).toBe(true);
    expect(
      urls.some((u) => u.includes('/incremental/tickets/cursor.json')),
    ).toBe(false);
    expect(
      urls.some((u) => u.includes('/api/v2/satisfaction_ratings.json')),
    ).toBe(false);
  });

  it('resumes from a saved cursor, skipping earlier phases', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector().sync(
      {
        mode: 'full',
        cursor: { phase: 'tickets', page: 'OLD_CURSOR' },
      },
      makeStorage(),
    );

    const urls = recordCalls(fetchSpy).map((c) => c.url);
    expect(urls.some((u) => u.includes('/api/v2/users.json'))).toBe(false);
    expect(urls.some((u) => u.includes('/api/v2/groups.json'))).toBe(false);
    const ticketsCall = urls.find((u) =>
      u.includes('/incremental/tickets/cursor.json'),
    );
    expect(ticketsCall).toBeDefined();
    expect(ticketsCall!).toContain('cursor=OLD_CURSOR');
  });

  it('sends basic auth and routes to the configured subdomain', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector({ resources: ['users'], subdomain: 'rawdash' }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const call = recordCalls(fetchSpy)[0]!;
    expect(call.url).toContain('https://rawdash.zendesk.com/api/v2/users.json');
    const expected = expectedBasicAuth('agent@acme.com/token:ZENDESK_TOKEN');
    expect(call.headers['authorization']).toBe(expected);
    expect(call.headers['accept']).toBe('application/json');
  });
});

describe('ZendeskConnector.create', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the connector instance directly', () => {
    vi.stubEnv('ZENDESK_TOKEN', 'test_token_fixture');
    const c = ZendeskConnector.create({
      subdomain: 'acme',
      email: 'agent@acme.com',
      apiToken: { $secret: 'ZENDESK_TOKEN' },
    });
    expect(c).toBeInstanceOf(ZendeskConnector);
    expect(c.id).toBe('zendesk');
  });

  it('resolves the env-backed apiToken into the outgoing auth header', async () => {
    vi.stubEnv('ZENDESK_TOKEN', 'test_token_fixture');
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    const c = ZendeskConnector.create({
      subdomain: 'acme',
      email: 'agent@acme.com',
      apiToken: { $secret: 'ZENDESK_TOKEN' },
      resources: ['users'],
    });
    await c.sync({ mode: 'full' }, makeStorage());

    const call = recordCalls(fetchSpy)[0]!;
    const expected = expectedBasicAuth(
      'agent@acme.com/token:test_token_fixture',
    );
    expect(call.headers['authorization']).toBe(expected);
  });
});
