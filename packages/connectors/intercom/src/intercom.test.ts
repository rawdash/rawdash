import { afterEach, describe, expect, it, vi } from 'vitest';

import { IntercomConnector, configFields } from './intercom';

describe('configFields', () => {
  it('parses a valid config with only accessToken', () => {
    const result = configFields.safeParse({
      accessToken: { $secret: 'INTERCOM_TOKEN' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.apiVersion).toBe('2.11');
      expect(result.data.region).toBe('us');
    }
  });

  it('parses a config with explicit api version, region, and resources', () => {
    const result = configFields.safeParse({
      accessToken: { $secret: 'INTERCOM_TOKEN' },
      apiVersion: '2.10',
      region: 'eu',
      resources: ['conversations', 'admins'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an apiVersion with a leading v', () => {
    expect(
      configFields.safeParse({
        accessToken: { $secret: 'INTERCOM_TOKEN' },
        apiVersion: 'v2.11',
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown resource', () => {
    expect(
      configFields.safeParse({
        accessToken: { $secret: 'INTERCOM_TOKEN' },
        resources: ['conversations', 'tickets'],
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown region', () => {
    expect(
      configFields.safeParse({
        accessToken: { $secret: 'INTERCOM_TOKEN' },
        region: 'apac',
      }).success,
    ).toBe(false);
  });

  it('rejects a plain string accessToken instead of secret object', () => {
    expect(
      configFields.safeParse({ accessToken: 'dG9rOjxoZWxsbz4=' }).success,
    ).toBe(false);
  });

  it('rejects a config missing accessToken', () => {
    expect(configFields.safeParse({}).success).toBe(false);
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
    if (u.endsWith('/admins')) {
      return Promise.resolve(jsonResponse({ admins: [] }));
    }
    if (u.endsWith('/teams')) {
      return Promise.resolve(jsonResponse({ teams: [] }));
    }
    if (u.endsWith('/contacts/search')) {
      return Promise.resolve(jsonResponse({ data: [], pages: {} }));
    }
    if (u.endsWith('/conversations/search')) {
      return Promise.resolve(jsonResponse({ conversations: [], pages: {} }));
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
      body: init.body ? JSON.parse(init.body as string) : undefined,
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

const TOKEN = 'INTERCOM_TOKEN' as unknown as { $secret: string };

function connector(
  overrides: {
    resources?: string[];
    apiVersion?: string;
    region?: 'us' | 'eu' | 'au';
  } = {},
) {
  return new IntercomConnector(
    {
      apiVersion: overrides.apiVersion ?? '2.11',
      region: overrides.region ?? 'us',
      ...(overrides.resources
        ? { resources: overrides.resources as never }
        : {}),
    },
    { accessToken: TOKEN },
  );
}

describe('IntercomConnector.sync', () => {
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
    expect(clearedTypes).toContain('intercom_admin');
    expect(clearedTypes).toContain('intercom_team');
    expect(clearedTypes).toContain('intercom_contact');
    expect(clearedTypes).toContain('intercom_conversation');
  });

  it('always clears the conversation-event scope, even on an incremental tick', async () => {
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
    expect(clearedEvents).toContain('intercom_conversation_state_change');

    const entityClears = storage.entities.mock.calls.filter(
      (c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0,
    );
    expect(entityClears).toHaveLength(0);
  });

  it('writes an admin entity from /admins', async () => {
    const fetchSpy = makeFetch((url, method) => {
      if (method === 'GET' && url.endsWith('/admins')) {
        return {
          admins: [
            {
              id: '7',
              name: 'Ada',
              email: 'ada@example.com',
              job_title: 'Support Lead',
              away_mode_enabled: false,
              has_inbox_seat: true,
            },
          ],
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector({ resources: ['admins'] }).sync({ mode: 'full' }, storage);

    const entity = storage.entity.mock.calls[0]![0] as {
      type: string;
      id: string;
      attributes: { name: string; email: string; awayMode: boolean };
    };
    expect(entity.type).toBe('intercom_admin');
    expect(entity.id).toBe('7');
    expect(entity.attributes.name).toBe('Ada');
    expect(entity.attributes.email).toBe('ada@example.com');
    expect(entity.attributes.awayMode).toBe(false);
  });

  it('writes a team entity with adminCount from admin_ids length', async () => {
    const fetchSpy = makeFetch((url, method) => {
      if (method === 'GET' && url.endsWith('/teams')) {
        return {
          teams: [
            { id: '42', name: 'Support', admin_ids: [1, 2, 3] },
            { id: '43', name: 'Onboarding', admin_ids: [] },
          ],
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector({ resources: ['teams'] }).sync({ mode: 'full' }, storage);

    const entities = storage.entity.mock.calls.map(
      (c) =>
        c[0] as {
          id: string;
          attributes: { name: string; adminCount: number };
        },
    );
    expect(entities).toHaveLength(2);
    expect(entities[0]!.attributes.adminCount).toBe(3);
    expect(entities[1]!.attributes.adminCount).toBe(0);
  });

  it('writes a conversation entity with state, priority, and tag names', async () => {
    const fetchSpy = makeFetch((url, method) => {
      if (method === 'POST' && url.endsWith('/conversations/search')) {
        return {
          conversations: [
            {
              id: 'c_1',
              state: 'open',
              priority: 'priority',
              admin_assignee_id: 7,
              team_assignee_id: 42,
              created_at: 1_700_000_000,
              updated_at: 1_700_000_500,
              snoozed_until: null,
              tags: {
                tags: [
                  { id: 't_1', name: 'billing' },
                  { id: 't_2', name: 'urgent' },
                ],
              },
              statistics: {
                first_contact_reply_at: 1_700_000_010,
                first_admin_reply_at: 1_700_000_050,
                count_conversation_parts: 9,
                count_assignments: 2,
                count_reopens: 1,
              },
            },
          ],
          pages: {},
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector({ resources: ['conversations'] }).sync(
      { mode: 'full' },
      storage,
    );

    const entity = storage.entity.mock.calls[0]![0] as {
      type: string;
      id: string;
      attributes: {
        state: string;
        priority: string;
        adminAssigneeId: string;
        teamAssigneeId: string;
        tags: string[];
        firstAdminReplyAt: number;
        countConversationParts: number;
      };
      updated_at: number;
    };
    expect(entity.type).toBe('intercom_conversation');
    expect(entity.id).toBe('c_1');
    expect(entity.attributes.state).toBe('open');
    expect(entity.attributes.priority).toBe('priority');
    expect(entity.attributes.adminAssigneeId).toBe('7');
    expect(entity.attributes.teamAssigneeId).toBe('42');
    expect(entity.attributes.tags).toEqual(['billing', 'urgent']);
    expect(entity.attributes.firstAdminReplyAt).toBe(1_700_000_050_000);
    expect(entity.attributes.countConversationParts).toBe(9);
    expect(entity.updated_at).toBe(1_700_000_500_000);
  });

  it('treats an unassigned conversation (assignee 0) as null', async () => {
    const fetchSpy = makeFetch((url, method) => {
      if (method === 'POST' && url.endsWith('/conversations/search')) {
        return {
          conversations: [
            {
              id: 'c_2',
              state: 'open',
              admin_assignee_id: 0,
              team_assignee_id: 0,
              created_at: 1_700_000_000,
              updated_at: 1_700_000_500,
            },
          ],
          pages: {},
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector({ resources: ['conversations'] }).sync(
      { mode: 'full' },
      storage,
    );

    const entity = storage.entity.mock.calls[0]![0] as {
      attributes: {
        adminAssigneeId: string | null;
        teamAssigneeId: string | null;
      };
    };
    expect(entity.attributes.adminAssigneeId).toBeNull();
    expect(entity.attributes.teamAssigneeId).toBeNull();
  });

  it('emits state-change events from conversation statistics', async () => {
    const fetchSpy = makeFetch((url, method) => {
      if (method === 'POST' && url.endsWith('/conversations/search')) {
        return {
          conversations: [
            {
              id: 'c_3',
              state: 'closed',
              created_at: 1_700_000_000,
              updated_at: 1_700_000_900,
              statistics: {
                last_assignment_at: 1_700_000_300,
                last_close_at: 1_700_000_900,
              },
            },
          ],
          pages: {},
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector({ resources: ['conversation_events'] }).sync(
      { mode: 'full' },
      storage,
    );

    const transitions = storage.event.mock.calls.map(
      (c) =>
        (c[0] as { attributes: { transition: string }; start_ts: number })
          .attributes.transition,
    );
    expect(transitions).toEqual(['created', 'assigned', 'closed']);

    const closed = storage.event.mock.calls.find(
      (c) =>
        (c[0] as { attributes: { transition: string } }).attributes
          .transition === 'closed',
    );
    expect((closed![0] as { name: string }).name).toBe(
      'intercom_conversation_state_change',
    );
    expect((closed![0] as { start_ts: number }).start_ts).toBe(
      1_700_000_900_000,
    );
  });

  it('emits a snoozed event only when the conversation is currently snoozed', async () => {
    const fetchSpy = makeFetch((url, method) => {
      if (method === 'POST' && url.endsWith('/conversations/search')) {
        return {
          conversations: [
            {
              id: 'c_4',
              state: 'open',
              created_at: 1_700_000_000,
              updated_at: 1_700_000_500,
              snoozed_until: 1_700_999_999,
            },
            {
              id: 'c_5',
              state: 'snoozed',
              created_at: 1_700_000_000,
              updated_at: 1_700_000_500,
              snoozed_until: 1_700_999_999,
            },
          ],
          pages: {},
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector({ resources: ['conversation_events'] }).sync(
      { mode: 'full' },
      storage,
    );

    const snoozed = storage.event.mock.calls.filter(
      (c) =>
        (c[0] as { attributes: { transition: string } }).attributes
          .transition === 'snoozed',
    );
    expect(snoozed).toHaveLength(1);
    expect(
      (snoozed[0]![0] as { attributes: { conversationId: string } }).attributes
        .conversationId,
    ).toBe('c_5');
  });

  it('applies the since filter as a Unix-seconds updated_at > clause', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    const since = '2024-01-01T00:00:00.000Z';
    await connector({ resources: ['conversations'] }).sync(
      { mode: 'latest', since },
      makeStorage(),
    );

    const call = recordCalls(fetchSpy).find((c) =>
      c.url.endsWith('/conversations/search'),
    );
    expect(call).toBeDefined();
    const body = call!.body as {
      query?: { field: string; operator: string; value: number };
    };
    expect(body.query).toEqual({
      field: 'updated_at',
      operator: '>',
      value: Math.floor(Date.parse(since) / 1000),
    });
  });

  it('omits the query filter when there is no since (full backfill)', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector({ resources: ['conversations'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const call = recordCalls(fetchSpy).find((c) =>
      c.url.endsWith('/conversations/search'),
    );
    expect(call).toBeDefined();
    const body = call!.body as { query?: unknown };
    expect(body.query).toBeUndefined();
  });

  it('forwards starting_after cursors from the pages.next block', async () => {
    let calls = 0;
    const fetchSpy = makeFetch((url, method) => {
      if (method === 'POST' && url.endsWith('/conversations/search')) {
        calls += 1;
        if (calls === 1) {
          return {
            conversations: [{ id: 'a', created_at: 1, updated_at: 1 }],
            pages: { next: { starting_after: 'AFTER_A' } },
          };
        }
        return {
          conversations: [{ id: 'b', created_at: 2, updated_at: 2 }],
          pages: {},
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    await connector({ resources: ['conversations'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const reqs = recordCalls(fetchSpy).filter((c) =>
      c.url.endsWith('/conversations/search'),
    );
    expect(reqs).toHaveLength(2);
    expect(
      (reqs[1]!.body as { pagination: { starting_after?: string } }).pagination
        .starting_after,
    ).toBe('AFTER_A');
  });

  it('only fetches the resources listed in settings.resources', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector({ resources: ['admins', 'teams'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const urls = recordCalls(fetchSpy).map((c) => c.url);
    expect(urls.some((u) => u.endsWith('/admins'))).toBe(true);
    expect(urls.some((u) => u.endsWith('/teams'))).toBe(true);
    expect(urls.some((u) => u.endsWith('/contacts/search'))).toBe(false);
    expect(urls.some((u) => u.endsWith('/conversations/search'))).toBe(false);
  });

  it('resumes from a saved cursor, skipping earlier phases', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector().sync(
      {
        mode: 'full',
        cursor: { phase: 'contacts', page: 'AFTER_OLD' },
      },
      makeStorage(),
    );

    const calls = recordCalls(fetchSpy);
    expect(calls.some((c) => c.url.endsWith('/admins'))).toBe(false);
    expect(calls.some((c) => c.url.endsWith('/teams'))).toBe(false);
    const contactsCall = calls.find((c) => c.url.endsWith('/contacts/search'));
    expect(contactsCall).toBeDefined();
    const body = contactsCall!.body as {
      pagination: { starting_after?: string };
    };
    expect(body.pagination.starting_after).toBe('AFTER_OLD');
  });

  it('routes requests to the EU host when region is eu', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector({ region: 'eu', resources: ['admins'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const call = recordCalls(fetchSpy)[0]!;
    expect(call.url).toBe('https://api.eu.intercom.io/admins');
  });

  it('routes requests to the AU host when region is au', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector({ region: 'au', resources: ['admins'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const call = recordCalls(fetchSpy)[0]!;
    expect(call.url).toBe('https://api.au.intercom.io/admins');
  });

  it('sends bearer auth and the Intercom-Version header', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector({ resources: ['admins'], apiVersion: '2.10' }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const headers = recordCalls(fetchSpy)[0]!.headers;
    expect(headers['authorization']).toBe('Bearer INTERCOM_TOKEN');
    expect(headers['intercom-version']).toBe('2.10');
    expect(headers['accept']).toBe('application/json');
  });
});

describe('IntercomConnector filter pushdown', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function conversationSearchQuery(
    fetchSpecs: Record<string, { filter: unknown[] }[]>,
  ): Promise<unknown> {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);
    await connector({ resources: ['conversations'] }).sync(
      { mode: 'full', fetchSpecs: fetchSpecs as never },
      makeStorage(),
    );
    const call = recordCalls(fetchSpy).find(
      (c) => c.method === 'POST' && c.url.endsWith('/conversations/search'),
    );
    expect(call).toBeDefined();
    return (call!.body as { query?: unknown }).query;
  }

  it('pushes a declared state filter into the conversation search query', async () => {
    const query = await conversationSearchQuery({
      intercom_conversation: [
        { filter: [{ field: 'state', op: 'eq', value: 'open' }] },
      ],
    });
    expect(query).toEqual({ field: 'state', operator: '=', value: 'open' });
  });

  it('does not push when multiple specs target the resource', async () => {
    const query = await conversationSearchQuery({
      intercom_conversation: [
        { filter: [{ field: 'state', op: 'eq', value: 'open' }] },
        { filter: [{ field: 'state', op: 'eq', value: 'closed' }] },
      ],
    });
    expect(query).toBeUndefined();
  });

  async function contactSearchQuery(
    fetchSpecs: Record<string, { filter: unknown[] }[]>,
  ): Promise<unknown> {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);
    await connector({ resources: ['contacts'] }).sync(
      { mode: 'full', fetchSpecs: fetchSpecs as never },
      makeStorage(),
    );
    const call = recordCalls(fetchSpy).find(
      (c) => c.method === 'POST' && c.url.endsWith('/contacts/search'),
    );
    expect(call).toBeDefined();
    return (call!.body as { query?: unknown }).query;
  }

  it('pushes a declared role filter into the contact search query', async () => {
    const query = await contactSearchQuery({
      intercom_contact: [
        { filter: [{ field: 'role', op: 'eq', value: 'user' }] },
      ],
    });
    expect(query).toEqual({ field: 'role', operator: '=', value: 'user' });
  });

  it('does not push when multiple specs target the contact resource', async () => {
    const query = await contactSearchQuery({
      intercom_contact: [
        { filter: [{ field: 'role', op: 'eq', value: 'user' }] },
        { filter: [{ field: 'role', op: 'eq', value: 'lead' }] },
      ],
    });
    expect(query).toBeUndefined();
  });
});

describe('IntercomConnector.create', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the connector instance directly', () => {
    vi.stubEnv('INTERCOM_TOKEN', 'test_token_fixture');
    const c = IntercomConnector.create({
      accessToken: { $secret: 'INTERCOM_TOKEN' },
    });
    expect(c).toBeInstanceOf(IntercomConnector);
    expect(c.id).toBe('intercom');
  });
});
