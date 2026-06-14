import { afterEach, describe, expect, it, vi } from 'vitest';

import { WorkOSConnector, configFields } from './workos';

describe('configFields', () => {
  it('parses a minimal valid config', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'WORKOS_API_KEY' },
    });
    expect(result.success).toBe(true);
  });

  it('parses a config with a resources allowlist and lookback', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'WORKOS_API_KEY' },
      resources: ['organizations', 'auth_events'],
      authEventsLookbackDays: 14,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a plain-string apiKey', () => {
    const result = configFields.safeParse({
      apiKey: 'plain',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown resource name', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'WORKOS_API_KEY' },
      resources: ['organizations', 'users'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a lookback above 90', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'WORKOS_API_KEY' },
      authEventsLookbackDays: 365,
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

function emptyList() {
  return { data: [], list_metadata: { before: null, after: null } };
}

function makeFetch(route: (url: string, method: string) => unknown) {
  return vi.fn().mockImplementation((url: string | URL, init?: RequestInit) => {
    const u = typeof url === 'string' ? url : url.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    const explicit = route(u, method);
    if (explicit !== undefined) {
      return Promise.resolve(jsonResponse(explicit));
    }
    return Promise.resolve(jsonResponse(emptyList()));
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

const API_KEY = 'WORKOS_API_KEY' as unknown as { $secret: string };

function connector(
  resources?: string[],
  overrides: { authEventsLookbackDays?: number } = {},
) {
  return new WorkOSConnector(
    {
      ...(resources ? { resources: resources as never } : {}),
      authEventsLookbackDays: overrides.authEventsLookbackDays,
    },
    { apiKey: API_KEY },
  );
}

describe('WorkOSConnector.sync', () => {
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

  it('sends the API key as a bearer token', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector(['organizations']).sync({ mode: 'full' }, makeStorage());

    const call = recordCalls(fetchSpy).find((c) =>
      c.url.includes('/organizations'),
    );
    expect(call).toBeDefined();
    const auth =
      call!.headers['Authorization'] ?? call!.headers['authorization'];
    expect(auth).toBe('Bearer WORKOS_API_KEY');
  });

  it('writes an organization entity from a list response', async () => {
    const fetchSpy = makeFetch((u) => {
      if (u.includes('/organizations')) {
        return {
          data: [
            {
              id: 'org_01',
              name: 'Acme',
              domains: [
                { domain: 'acme.com', state: 'verified' },
                { domain: 'acme.io', state: 'verified' },
              ],
              created_at: '2024-01-01T00:00:00.000Z',
              updated_at: '2024-02-01T00:00:00.000Z',
            },
          ],
          list_metadata: { before: null, after: null },
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
      attributes: { name: string; domains: string; createdAt: number };
      updated_at: number;
    };
    expect(entity.type).toBe('workos_organization');
    expect(entity.id).toBe('org_01');
    expect(entity.attributes.name).toBe('Acme');
    expect(entity.attributes.domains).toBe('acme.com, acme.io');
    expect(entity.attributes.createdAt).toBe(
      Date.parse('2024-01-01T00:00:00.000Z'),
    );
    expect(entity.updated_at).toBe(Date.parse('2024-02-01T00:00:00.000Z'));
  });

  it('writes a connection entity from a list response', async () => {
    const fetchSpy = makeFetch((u) => {
      if (u.includes('/connections')) {
        return {
          data: [
            {
              id: 'conn_01',
              name: 'Acme Okta SAML',
              organization_id: 'org_01',
              connection_type: 'OktaSAML',
              state: 'active',
              created_at: '2024-01-01T00:00:00.000Z',
              updated_at: '2024-02-01T00:00:00.000Z',
            },
          ],
          list_metadata: { before: null, after: null },
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['connections']).sync({ mode: 'full' }, storage);

    expect(storage.entity).toHaveBeenCalledTimes(1);
    const entity = storage.entity.mock.calls[0]![0] as {
      type: string;
      id: string;
      attributes: {
        connectionType: string;
        organizationId: string;
        state: string;
      };
    };
    expect(entity.type).toBe('workos_connection');
    expect(entity.id).toBe('conn_01');
    expect(entity.attributes.connectionType).toBe('OktaSAML');
    expect(entity.attributes.organizationId).toBe('org_01');
    expect(entity.attributes.state).toBe('active');
  });

  it('writes a directory entity from a list response', async () => {
    const fetchSpy = makeFetch((u) => {
      if (u.includes('/directories')) {
        return {
          data: [
            {
              id: 'directory_01',
              name: 'Acme Azure AD',
              organization_id: 'org_01',
              type: 'azure scim v2.0',
              state: 'linked',
              created_at: '2024-01-01T00:00:00.000Z',
            },
          ],
          list_metadata: { before: null, after: null },
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['directories']).sync({ mode: 'full' }, storage);

    expect(storage.entity).toHaveBeenCalledTimes(1);
    const entity = storage.entity.mock.calls[0]![0] as {
      type: string;
      attributes: { directoryType: string; state: string };
    };
    expect(entity.type).toBe('workos_directory');
    expect(entity.attributes.directoryType).toBe('azure scim v2.0');
    expect(entity.attributes.state).toBe('linked');
  });

  it('emits an auth event with outcome and method parsed from the event type', async () => {
    const fetchSpy = makeFetch((u) => {
      if (u.includes('/events')) {
        return {
          data: [
            {
              id: 'event_01',
              event: 'authentication.sso_succeeded',
              created_at: '2024-03-01T00:00:00.000Z',
              data: {
                organization_id: 'org_01',
                user_id: 'user_01',
                connection_id: 'conn_01',
                connection_type: 'OktaSAML',
                ip_address: '203.0.113.10',
              },
            },
            {
              id: 'event_02',
              event: 'authentication.password_failed',
              created_at: '2024-03-02T00:00:00.000Z',
              data: {
                email: 'attacker@example.com',
                ip_address: '198.51.100.20',
              },
            },
            {
              id: 'event_03',
              event: 'organization.created',
              created_at: '2024-03-03T00:00:00.000Z',
              data: {},
            },
          ],
          list_metadata: { before: null, after: null },
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['auth_events']).sync({ mode: 'full' }, storage);

    expect(storage.event).toHaveBeenCalledTimes(2);
    const first = storage.event.mock.calls[0]![0] as {
      name: string;
      start_ts: number;
      attributes: {
        eventType: string;
        outcome: string;
        method: string;
        connectionType: string;
      };
    };
    expect(first.name).toBe('workos_auth_event');
    expect(first.attributes.eventType).toBe('authentication.sso_succeeded');
    expect(first.attributes.outcome).toBe('succeeded');
    expect(first.attributes.method).toBe('sso');
    expect(first.attributes.connectionType).toBe('OktaSAML');
    expect(first.start_ts).toBe(Date.parse('2024-03-01T00:00:00.000Z'));

    const second = storage.event.mock.calls[1]![0] as {
      attributes: { outcome: string; method: string };
    };
    expect(second.attributes.outcome).toBe('failed');
    expect(second.attributes.method).toBe('password');
  });

  it('only fetches the resources listed in settings.resources', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector(['organizations']).sync({ mode: 'full' }, makeStorage());

    const calls = recordCalls(fetchSpy);
    expect(calls.some((c) => c.url.includes('/organizations'))).toBe(true);
    expect(calls.some((c) => c.url.includes('/connections'))).toBe(false);
    expect(calls.some((c) => c.url.includes('/directories'))).toBe(false);
    expect(calls.some((c) => c.url.includes('/events'))).toBe(false);
  });

  it('does not clear entity scopes on incremental sync', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetch(() => undefined),
    );
    const storage = makeStorage();
    await connector(['organizations']).sync(
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
    await connector(['auth_events']).sync(
      { mode: 'latest', since: '2024-01-01T00:00:00Z' },
      storage,
    );
    expect(storage.events).not.toHaveBeenCalled();
  });

  it('pushes options.since into the events range_start parameter', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector(['auth_events']).sync(
      { mode: 'latest', since: '2024-05-01T00:00:00.000Z' },
      makeStorage(),
    );

    const eventsCall = recordCalls(fetchSpy).find((c) =>
      c.url.includes('/events'),
    );
    expect(eventsCall).toBeDefined();
    const url = new URL(eventsCall!.url);
    expect(url.searchParams.get('range_start')).toBe(
      '2024-05-01T00:00:00.000Z',
    );
  });

  it('uses lookback window when no since is provided', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector(['auth_events'], { authEventsLookbackDays: 7 }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const eventsCall = recordCalls(fetchSpy).find((c) =>
      c.url.includes('/events'),
    );
    expect(eventsCall).toBeDefined();
    const url = new URL(eventsCall!.url);
    const rangeStart = url.searchParams.get('range_start');
    expect(rangeStart).toBeTruthy();
    const ageMs = Date.now() - Date.parse(rangeStart!);
    const expected = 7 * 24 * 60 * 60 * 1000;
    expect(ageMs).toBeGreaterThan(expected - 60_000);
    expect(ageMs).toBeLessThan(expected + 60_000);
  });

  it('filters the events request to the authentication event family', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector(['auth_events']).sync({ mode: 'full' }, makeStorage());

    const eventsCall = recordCalls(fetchSpy).find((c) =>
      c.url.includes('/events'),
    );
    expect(eventsCall).toBeDefined();
    const url = new URL(eventsCall!.url);
    const events = url.searchParams.getAll('events');
    expect(events.length).toBeGreaterThan(0);
    for (const t of events) {
      expect(t.startsWith('authentication.')).toBe(true);
    }
    expect(events).toContain('authentication.sso_succeeded');
    expect(events).toContain('authentication.sso_failed');
  });

  it('paginates organizations using the after cursor from list_metadata', async () => {
    let call = 0;
    const fetchSpy = vi.fn().mockImplementation((url: string | URL) => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.includes('/organizations')) {
        call += 1;
        if (call === 1) {
          return Promise.resolve(
            jsonResponse({
              data: [
                {
                  id: 'org_01',
                  name: 'Acme',
                  domains: [],
                  created_at: '2024-01-01T00:00:00.000Z',
                },
              ],
              list_metadata: { before: null, after: 'cursor_next' },
            }),
          );
        }
        return Promise.resolve(
          jsonResponse({
            data: [
              {
                id: 'org_02',
                name: 'Bravo',
                domains: [],
                created_at: '2024-01-02T00:00:00.000Z',
              },
            ],
            list_metadata: { before: null, after: null },
          }),
        );
      }
      return Promise.resolve(jsonResponse(emptyList()));
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['organizations']).sync({ mode: 'full' }, storage);

    expect(call).toBe(2);
    expect(storage.entity).toHaveBeenCalledTimes(2);
    const secondCall = recordCalls(fetchSpy).filter((c) =>
      c.url.includes('/organizations'),
    )[1]!;
    expect(new URL(secondCall.url).searchParams.get('after')).toBe(
      'cursor_next',
    );
  });

  it('resumes from a saved cursor, skipping earlier phases', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector().sync(
      { mode: 'full', cursor: { phase: 'connections', page: null } },
      makeStorage(),
    );

    const calls = recordCalls(fetchSpy);
    expect(calls.some((c) => c.url.includes('/organizations'))).toBe(false);
    expect(calls.some((c) => c.url.includes('/connections'))).toBe(true);
  });

  it('drops events older than options.since on the client', async () => {
    const fetchSpy = makeFetch((u) => {
      if (u.includes('/events')) {
        return {
          data: [
            {
              id: 'event_old',
              event: 'authentication.sso_succeeded',
              created_at: '2023-12-31T00:00:00.000Z',
              data: {},
            },
            {
              id: 'event_new',
              event: 'authentication.sso_succeeded',
              created_at: '2024-06-01T00:00:00.000Z',
              data: {},
            },
          ],
          list_metadata: { before: null, after: null },
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['auth_events']).sync(
      { mode: 'latest', since: '2024-01-01T00:00:00.000Z' },
      storage,
    );

    expect(storage.event).toHaveBeenCalledTimes(1);
    const call = storage.event.mock.calls[0]![0] as {
      attributes: { eventId: string };
    };
    expect(call.attributes.eventId).toBe('event_new');
  });
});

describe('WorkOSConnector.create', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns a configured instance from JSON input', () => {
    vi.stubEnv('WORKOS_API_KEY', 'sk_test');
    const c = WorkOSConnector.create({
      apiKey: { $secret: 'WORKOS_API_KEY' },
    });
    expect(c).toBeInstanceOf(WorkOSConnector);
    expect(c.id).toBe('workos');
  });
});
