import { afterEach, describe, expect, it, vi } from 'vitest';

import { KlaviyoConnector, configFields } from './klaviyo';

describe('configFields', () => {
  it('parses a valid config with only apiKey', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'KLAVIYO_KEY' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.apiRevision).toBe('2024-10-15');
      expect(result.data.channel).toBe('email');
    }
  });

  it('parses a config with explicit revision, channel, and resources', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'KLAVIYO_KEY' },
      apiRevision: '2024-07-15',
      channel: 'sms',
      resources: ['campaigns', 'flows'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an apiRevision in the wrong format', () => {
    expect(
      configFields.safeParse({
        apiKey: { $secret: 'KLAVIYO_KEY' },
        apiRevision: '2024',
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown resource', () => {
    expect(
      configFields.safeParse({
        apiKey: { $secret: 'KLAVIYO_KEY' },
        resources: ['campaigns', 'profiles'],
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown channel', () => {
    expect(
      configFields.safeParse({
        apiKey: { $secret: 'KLAVIYO_KEY' },
        channel: 'push',
      }).success,
    ).toBe(false);
  });

  it('rejects a plain string apiKey instead of a secret object', () => {
    expect(configFields.safeParse({ apiKey: 'pk_xxx' }).success).toBe(false);
  });

  it('rejects a config missing apiKey', () => {
    expect(configFields.safeParse({}).success).toBe(false);
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

function makeFetch(route: (url: string) => unknown) {
  return vi.fn().mockImplementation((url: string | URL) => {
    const u = typeof url === 'string' ? url : url.toString();
    const explicit = route(u);
    if (explicit !== undefined) {
      return Promise.resolve(jsonResponse(explicit));
    }
    return Promise.resolve(jsonResponse({ data: [], links: {} }));
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

const KEY = 'KLAVIYO_KEY' as unknown as { $secret: string };

function connector(
  overrides: {
    resources?: string[];
    apiRevision?: string;
    channel?: 'email' | 'sms' | 'mobile_push';
  } = {},
) {
  return new KlaviyoConnector(
    {
      apiRevision: overrides.apiRevision ?? '2024-10-15',
      channel: overrides.channel ?? 'email',
      ...(overrides.resources
        ? { resources: overrides.resources as never }
        : {}),
    },
    { apiKey: KEY },
  );
}

describe('KlaviyoConnector.sync', () => {
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
    expect(clearedTypes).toContain('klaviyo_list');
    expect(clearedTypes).toContain('klaviyo_segment');
    expect(clearedTypes).toContain('klaviyo_campaign');
    expect(clearedTypes).toContain('klaviyo_flow');
  });

  it('does not clear scopes on an incremental tick', async () => {
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
  });

  it('writes a list entity', async () => {
    const fetchSpy = makeFetch((url) => {
      if (url.includes('/api/lists')) {
        return {
          data: [
            {
              type: 'list',
              id: 'list_1',
              attributes: {
                name: 'VIP',
                opt_in_process: 'single_opt_in',
                created: '2024-04-01T00:00:00.000Z',
                updated: '2024-05-01T00:00:00.000Z',
              },
            },
          ],
          links: {},
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector({ resources: ['lists'] }).sync({ mode: 'full' }, storage);

    const entity = storage.entity.mock.calls[0]![0] as {
      type: string;
      id: string;
      attributes: { name: string; optInProcess: string };
      updated_at: number;
    };
    expect(entity.type).toBe('klaviyo_list');
    expect(entity.id).toBe('list_1');
    expect(entity.attributes.name).toBe('VIP');
    expect(entity.attributes.optInProcess).toBe('single_opt_in');
    expect(entity.updated_at).toBe(Date.parse('2024-05-01T00:00:00.000Z'));
  });

  it('writes a campaign entity with sendStrategy method and sendTime', async () => {
    const fetchSpy = makeFetch((url) => {
      if (url.includes('/api/campaigns')) {
        return {
          data: [
            {
              type: 'campaign',
              id: 'cmp_1',
              attributes: {
                name: 'Black Friday',
                status: 'Sent',
                archived: false,
                channel: 'email',
                send_time: '2024-11-29T10:00:00.000Z',
                send_strategy: { method: 'static' },
                created_at: '2024-10-01T00:00:00.000Z',
                updated_at: '2024-11-29T10:30:00.000Z',
              },
            },
          ],
          links: {},
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector({ resources: ['campaigns'] }).sync(
      { mode: 'full' },
      storage,
    );

    const entity = storage.entity.mock.calls[0]![0] as {
      type: string;
      attributes: {
        name: string;
        status: string;
        sendStrategy: string;
        sendTime: number;
      };
    };
    expect(entity.type).toBe('klaviyo_campaign');
    expect(entity.attributes.name).toBe('Black Friday');
    expect(entity.attributes.status).toBe('Sent');
    expect(entity.attributes.sendStrategy).toBe('static');
    expect(entity.attributes.sendTime).toBe(
      Date.parse('2024-11-29T10:00:00.000Z'),
    );
  });

  it('requires a channel filter on the campaigns request', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector({ resources: ['campaigns'], channel: 'sms' }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const call = recordCalls(fetchSpy).find((c) =>
      c.url.includes('/api/campaigns'),
    );
    expect(call).toBeDefined();
    expect(call!.url).toContain(
      'filter=equals%28messages.channel%2C%27sms%27%29',
    );
  });

  it('applies a greater-than(updated,...) filter when since is set', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    const since = '2024-01-01T00:00:00.000Z';
    await connector({ resources: ['lists'] }).sync(
      { mode: 'latest', since },
      makeStorage(),
    );

    const call = recordCalls(fetchSpy).find((c) =>
      c.url.includes('/api/lists'),
    );
    expect(call).toBeDefined();
    expect(decodeURIComponent(call!.url)).toContain(
      `greater-than(updated,${since})`,
    );
  });

  it('uses updated_at on the campaigns filter (not updated)', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    const since = '2024-01-01T00:00:00.000Z';
    await connector({ resources: ['campaigns'] }).sync(
      { mode: 'latest', since },
      makeStorage(),
    );

    const call = recordCalls(fetchSpy).find((c) =>
      c.url.includes('/api/campaigns'),
    );
    expect(call).toBeDefined();
    expect(decodeURIComponent(call!.url)).toContain(
      `greater-than(updated_at,${since})`,
    );
  });

  it('omits the date filter when there is no since (full backfill)', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector({ resources: ['lists'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const call = recordCalls(fetchSpy).find((c) =>
      c.url.includes('/api/lists'),
    );
    expect(call).toBeDefined();
    expect(decodeURIComponent(call!.url)).not.toContain('greater-than');
  });

  it('follows the links.next cursor on a second page', async () => {
    let calls = 0;
    const fetchSpy = makeFetch((url) => {
      if (url.includes('/api/lists')) {
        calls += 1;
        if (calls === 1) {
          return {
            data: [
              {
                type: 'list',
                id: 'a',
                attributes: {
                  name: 'A',
                  created: '2024-01-01T00:00:00.000Z',
                  updated: '2024-01-01T00:00:00.000Z',
                },
              },
            ],
            links: {
              next: 'https://a.klaviyo.com/api/lists?page%5Bcursor%5D=NEXT',
            },
          };
        }
        return {
          data: [
            {
              type: 'list',
              id: 'b',
              attributes: {
                name: 'B',
                created: '2024-02-01T00:00:00.000Z',
                updated: '2024-02-01T00:00:00.000Z',
              },
            },
          ],
          links: {},
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    await connector({ resources: ['lists'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const urls = recordCalls(fetchSpy)
      .map((c) => c.url)
      .filter((u) => u.includes('/api/lists'));
    expect(urls).toHaveLength(2);
    expect(urls[1]).toContain('page%5Bcursor%5D=NEXT');
  });

  it('drops a next URL pointing at a different host', async () => {
    let calls = 0;
    const fetchSpy = makeFetch((url) => {
      if (url.includes('/api/lists')) {
        calls += 1;
        if (calls === 1) {
          return {
            data: [
              {
                type: 'list',
                id: 'a',
                attributes: { name: 'A', created: null, updated: null },
              },
            ],
            links: { next: 'https://evil.example.com/api/lists?page=2' },
          };
        }
        return { data: [], links: {} };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    await connector({ resources: ['lists'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const urls = recordCalls(fetchSpy)
      .map((c) => c.url)
      .filter((u) => u.includes('/api/lists'));
    expect(urls).toHaveLength(1);
  });

  it('only fetches the resources listed in settings.resources', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector({ resources: ['lists', 'flows'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const urls = recordCalls(fetchSpy).map((c) => c.url);
    expect(urls.some((u) => u.includes('/api/lists'))).toBe(true);
    expect(urls.some((u) => u.includes('/api/flows'))).toBe(true);
    expect(urls.some((u) => u.includes('/api/segments'))).toBe(false);
    expect(urls.some((u) => u.includes('/api/campaigns'))).toBe(false);
  });

  it('sends the Klaviyo-API-Key auth and revision headers', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector({
      resources: ['lists'],
      apiRevision: '2024-07-15',
    }).sync({ mode: 'full' }, makeStorage());

    const headers = recordCalls(fetchSpy)[0]!.headers;
    expect(headers['authorization']).toBe('Klaviyo-API-Key KLAVIYO_KEY');
    expect(headers['revision']).toBe('2024-07-15');
    expect(headers['accept']).toBe('application/vnd.api+json');
  });

  it('resumes from a saved cursor, skipping earlier phases', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector().sync(
      {
        mode: 'full',
        cursor: {
          phase: 'campaigns',
          page: 'https://a.klaviyo.com/api/campaigns?page%5Bcursor%5D=OLD',
        },
      },
      makeStorage(),
    );

    const calls = recordCalls(fetchSpy);
    expect(calls.some((c) => c.url.includes('/api/lists'))).toBe(false);
    expect(calls.some((c) => c.url.includes('/api/segments'))).toBe(false);
    const camp = calls.find((c) => c.url.includes('/api/campaigns'));
    expect(camp).toBeDefined();
    expect(camp!.url).toContain('page%5Bcursor%5D=OLD');
  });
});

describe('KlaviyoConnector.create', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the connector instance directly', () => {
    vi.stubEnv('KLAVIYO_KEY', 'test_key_fixture');
    const c = KlaviyoConnector.create({
      apiKey: { $secret: 'KLAVIYO_KEY' },
    });
    expect(c).toBeInstanceOf(KlaviyoConnector);
    expect(c.id).toBe('klaviyo');
  });
});
