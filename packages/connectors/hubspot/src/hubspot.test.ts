import { afterEach, describe, expect, it, vi } from 'vitest';

import { HubSpotConnector, configFields } from './hubspot';

// ---------------------------------------------------------------------------
// configFields
// ---------------------------------------------------------------------------

describe('configFields', () => {
  it('parses a valid config with only accessToken', () => {
    const result = configFields.safeParse({
      accessToken: { $secret: 'HUBSPOT_TOKEN' },
    });
    expect(result.success).toBe(true);
  });

  it('parses a valid config with accessToken and resources', () => {
    const result = configFields.safeParse({
      accessToken: { $secret: 'HUBSPOT_TOKEN' },
      resources: ['contacts', 'deals'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a config missing accessToken', () => {
    expect(configFields.safeParse({}).success).toBe(false);
  });

  it('rejects a plain string accessToken instead of secret object', () => {
    const result = configFields.safeParse({ accessToken: 'pat-na1-plain' });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown resource name', () => {
    const result = configFields.safeParse({
      accessToken: { $secret: 'HUBSPOT_TOKEN' },
      resources: ['contacts', 'tickets'],
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Fetch + storage mocks
// ---------------------------------------------------------------------------

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

// Routes a request to a body based on URL + method. Returns endpoint-shaped
// empty defaults for anything not explicitly overridden.
function makeFetch(route: (url: string, method: string) => unknown) {
  return vi.fn().mockImplementation((url: string | URL, init?: RequestInit) => {
    const u = typeof url === 'string' ? url : url.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    const explicit = route(u, method);
    if (explicit !== undefined) {
      return Promise.resolve(jsonResponse(explicit));
    }
    if (u.includes('/search')) {
      return Promise.resolve(jsonResponse({ total: 0, results: [] }));
    }
    if (/\/email\/public\/v1\/campaigns\/[^?]/.test(u)) {
      return Promise.resolve(jsonResponse({ id: 0, counters: {} }));
    }
    if (u.includes('/email/public/v1/campaigns')) {
      return Promise.resolve(jsonResponse({ campaigns: [], hasMore: false }));
    }
    // CRM list (deal history)
    return Promise.resolve(jsonResponse({ results: [] }));
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

const TOKEN = 'HUBSPOT_TOKEN' as unknown as { $secret: string };

function connector(resources?: string[]) {
  return new HubSpotConnector(
    resources ? { resources: resources as never } : {},
    { accessToken: TOKEN },
  );
}

// ---------------------------------------------------------------------------
// sync — phase orchestration
// ---------------------------------------------------------------------------

describe('HubSpotConnector.sync', () => {
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

  it('clears entity types at the start of a full sync', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetch(() => undefined),
    );
    const storage = makeStorage();
    await connector().sync({ mode: 'full' }, storage);

    const clearedTypes = storage.entities.mock.calls
      .filter((c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0)
      .map((c) => (c[1] as { types: string[] }).types[0]);
    expect(clearedTypes).toContain('hubspot_contact');
    expect(clearedTypes).toContain('hubspot_company');
    expect(clearedTypes).toContain('hubspot_deal');
    expect(clearedTypes).toContain('hubspot_email_campaign');
  });

  it('always clears event + metric scopes, even in latest mode', async () => {
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
    const clearedMetrics = storage.metrics.mock.calls.map(
      (c) => (c[1] as { names: string[] }).names[0],
    );
    expect(clearedEvents).toContain('hubspot_deal_stage_change');
    expect(clearedMetrics).toContain('hubspot_email_stats');

    // Entity types must NOT be cleared in incremental mode.
    const entityClears = storage.entities.mock.calls.filter(
      (c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0,
    );
    expect(entityClears).toHaveLength(0);
  });

  it('writes a contact entity from a CRM search response', async () => {
    const fetchSpy = makeFetch((url, method) => {
      if (method === 'POST' && url.includes('/contacts/search')) {
        return {
          total: 1,
          results: [
            {
              id: '101',
              properties: {
                email: 'alice@example.com',
                lifecyclestage: 'lead',
                hs_lead_status: 'NEW',
                createdate: '1700000000000',
                lastmodifieddate: '1700000500000',
                hubspot_owner_id: '55',
              },
              createdAt: '2023-11-14T22:13:20.000Z',
              updatedAt: '2023-11-14T22:21:40.000Z',
            },
          ],
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['contacts']).sync({ mode: 'full' }, storage);

    const call = storage.entity.mock.calls.find(
      (c) => (c[0] as { id: string }).id === '101',
    );
    expect(call).toBeDefined();
    const entity = call![0] as {
      type: string;
      attributes: { email: string; leadStatus: string };
      updated_at: number;
    };
    expect(entity.type).toBe('hubspot_contact');
    expect(entity.attributes.email).toBe('alice@example.com');
    expect(entity.attributes.leadStatus).toBe('NEW');
    expect(entity.updated_at).toBe(Date.parse('2023-11-14T22:21:40.000Z'));
  });

  it('parses deal amount into a finite number', async () => {
    const fetchSpy = makeFetch((url, method) => {
      if (method === 'POST' && url.includes('/deals/search')) {
        return {
          results: [
            {
              id: 'deal_1',
              properties: {
                dealname: 'Acme',
                dealstage: 'closedwon',
                pipeline: 'default',
                amount: '4200.50',
                closedate: '1700000000000',
                createdate: '1699000000000',
              },
              createdAt: '2023-11-03T00:00:00.000Z',
              updatedAt: '2023-11-14T22:21:40.000Z',
            },
          ],
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['deals']).sync({ mode: 'full' }, storage);

    const entity = storage.entity.mock.calls[0]![0] as {
      attributes: { amount: number; dealStage: string };
    };
    expect(entity.attributes.amount).toBe(4200.5);
    expect(entity.attributes.dealStage).toBe('closedwon');
  });

  it('emits deal stage-change events from property history', async () => {
    const fetchSpy = makeFetch((url, method) => {
      if (method === 'GET' && /\/crm\/v3\/objects\/deals\?/.test(url)) {
        return {
          results: [
            {
              id: 'deal_9',
              propertiesWithHistory: {
                dealstage: [
                  {
                    value: 'closedwon',
                    timestamp: '2024-02-01T00:00:00.000Z',
                    sourceType: 'CRM_UI',
                  },
                  {
                    value: 'qualifiedtobuy',
                    timestamp: '2024-01-01T00:00:00.000Z',
                    sourceType: 'CRM_UI',
                  },
                ],
              },
            },
          ],
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['deal_events']).sync({ mode: 'full' }, storage);

    expect(storage.event).toHaveBeenCalledTimes(2);
    const first = storage.event.mock.calls[0]![0] as {
      name: string;
      start_ts: number;
      attributes: { dealId: string; stage: string };
    };
    expect(first.name).toBe('hubspot_deal_stage_change');
    expect(first.attributes.dealId).toBe('deal_9');
    expect(first.attributes.stage).toBe('closedwon');
    expect(first.start_ts).toBe(Date.parse('2024-02-01T00:00:00.000Z'));
  });

  it('rewrites the full deal stage-change history on incremental sync', async () => {
    const fetchSpy = makeFetch((url, method) => {
      if (method === 'GET' && /\/crm\/v3\/objects\/deals\?/.test(url)) {
        return {
          results: [
            {
              id: 'deal_9',
              propertiesWithHistory: {
                dealstage: [
                  { value: 'b', timestamp: '2024-02-01T00:00:00.000Z' },
                  { value: 'a', timestamp: '2024-01-01T00:00:00.000Z' },
                ],
              },
            },
          ],
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['deal_events']).sync(
      { mode: 'latest', since: '2024-01-15T00:00:00.000Z' },
      storage,
    );

    expect(storage.event).toHaveBeenCalledTimes(2);
    const stages = storage.event.mock.calls.map(
      (c) => (c[0] as { attributes: { stage: string } }).attributes.stage,
    );
    expect(stages).toEqual(['b', 'a']);
  });

  it('enumerates campaigns and writes campaign entities + stats', async () => {
    const detail = {
      id: 314,
      name: 'Spring Launch',
      subject: 'Big news',
      fromName: 'Marketing',
      type: 'BATCH_EMAIL',
      lastProcessingFinishedAt: 1700000000000,
      numIncluded: 1000,
      counters: {
        sent: 1000,
        delivered: 950,
        open: 400,
        click: 120,
        bounce: 50,
        unsubscribed: 5,
      },
    };
    const fetchSpy = makeFetch((url) => {
      if (/\/email\/public\/v1\/campaigns\/314/.test(url)) {
        return detail;
      }
      if (url.includes('/email/public/v1/campaigns')) {
        return { campaigns: [{ id: 314 }], hasMore: false };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['email_campaigns', 'email_stats']).sync(
      { mode: 'full' },
      storage,
    );

    const entity = storage.entity.mock.calls[0]![0] as {
      type: string;
      attributes: { subject: string; fromName: string };
    };
    expect(entity.type).toBe('hubspot_email_campaign');
    expect(entity.attributes.subject).toBe('Big news');
    expect(entity.attributes.fromName).toBe('Marketing');

    const metric = storage.metric.mock.calls[0]![0] as {
      name: string;
      value: number;
      ts: number;
      attributes: { opened: number; clicked: number; bounced: number };
    };
    expect(metric.name).toBe('hubspot_email_stats');
    expect(metric.value).toBe(1000);
    expect(metric.ts).toBe(1700000000000);
    expect(metric.attributes.opened).toBe(400);
    expect(metric.attributes.clicked).toBe(120);
    expect(metric.attributes.bounced).toBe(50);
  });

  it('resumes from a saved cursor, skipping earlier phases', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector().sync(
      { mode: 'full', cursor: { phase: 'deals', page: 'after_123' } },
      makeStorage(),
    );

    const calls = recordCalls(fetchSpy);
    expect(calls.some((c) => c.url.includes('/contacts/search'))).toBe(false);
    expect(calls.some((c) => c.url.includes('/companies/search'))).toBe(false);
    const dealsCall = calls.find((c) => c.url.includes('/deals/search'));
    expect(dealsCall).toBeDefined();
    expect((dealsCall!.body as { after?: string }).after).toBe('after_123');
  });

  it('only fetches the resources listed in settings.resources', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector(['contacts', 'email_stats']).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const calls = recordCalls(fetchSpy);
    expect(calls.some((c) => c.url.includes('/contacts/search'))).toBe(true);
    expect(
      calls.some((c) => c.url.includes('/email/public/v1/campaigns')),
    ).toBe(true);
    expect(calls.some((c) => c.url.includes('/companies/search'))).toBe(false);
    expect(calls.some((c) => c.url.includes('/deals/search'))).toBe(false);
  });

  it('applies the since filter as an hs_lastmodifieddate GTE search filter', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    const since = '2024-01-01T00:00:00.000Z';
    await connector(['deals']).sync({ mode: 'latest', since }, makeStorage());

    const dealsCall = recordCalls(fetchSpy).find((c) =>
      c.url.includes('/deals/search'),
    );
    const body = dealsCall!.body as {
      filterGroups: Array<{
        filters: Array<{
          propertyName: string;
          operator: string;
          value: string;
        }>;
      }>;
    };
    expect(body.filterGroups).toHaveLength(1);
    expect(body.filterGroups[0]!.filters[0]).toEqual({
      propertyName: 'hs_lastmodifieddate',
      operator: 'GTE',
      value: String(Date.parse(since)),
    });
  });

  it('sends a bearer Authorization header', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector(['contacts']).sync({ mode: 'full' }, makeStorage());

    const headers = recordCalls(fetchSpy)[0]!.headers;
    expect(headers['authorization']).toBe('Bearer HUBSPOT_TOKEN');
  });
});

// ---------------------------------------------------------------------------
// aggregate — count via the CRM search total
// ---------------------------------------------------------------------------

describe('HubSpotConnector.aggregate', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the search total for a count on deals', async () => {
    const fetchSpy = makeFetch((url, method) => {
      if (method === 'POST' && url.includes('/deals/search')) {
        return { total: 42, results: [] };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const value = await connector().aggregate({
      fn: 'count',
      resource: 'hubspot_deal',
    });
    expect(value).toBe(42);
  });

  it('translates filters into a single AND filter group', async () => {
    const fetchSpy = makeFetch((url, method) => {
      if (method === 'POST' && url.includes('/deals/search')) {
        return { total: 7, results: [] };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    await connector().aggregate({
      fn: 'count',
      resource: 'hubspot_deal',
      filter: [{ field: 'dealstage', op: 'eq', value: 'closedwon' }],
    });

    const body = recordCalls(fetchSpy)[0]!.body as {
      filterGroups: Array<{ filters: unknown[] }>;
    };
    expect(body.filterGroups[0]!.filters[0]).toEqual({
      propertyName: 'dealstage',
      operator: 'EQ',
      value: 'closedwon',
    });
  });

  it('throws for unsupported resources and falls back to storage', async () => {
    await expect(
      connector().aggregate({
        fn: 'count',
        resource: 'hubspot_email_campaign',
      }),
    ).rejects.toThrow(/unsupported/);
  });

  it('throws for latest aggregates', async () => {
    await expect(
      connector().aggregate({
        fn: 'latest',
        resource: 'hubspot_deal',
        field: 'amount',
      }),
    ).rejects.toThrow(/unsupported/);
  });
});

describe('HubSpotConnector.validateCountFilter', () => {
  it('accepts supported resources and operators', () => {
    expect(() =>
      connector().validateCountFilter('hubspot_contact', [
        { field: 'lifecyclestage', op: 'eq', value: 'customer' },
      ]),
    ).not.toThrow();
  });

  it('rejects an unsupported resource', () => {
    expect(() =>
      connector().validateCountFilter('hubspot_email_campaign', []),
    ).toThrow(/unsupported resource/);
  });

  it('rejects OR filter clauses', () => {
    expect(() =>
      connector().validateCountFilter('hubspot_deal', [
        { or: [{ field: 'dealstage', op: 'eq', value: 'a' }] },
      ]),
    ).toThrow(/OR filter/);
  });
});

describe('HubSpotConnector.create', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the connector instance directly', () => {
    vi.stubEnv('HUBSPOT_TOKEN', 'test_token_fixture');
    const c = HubSpotConnector.create({
      accessToken: { $secret: 'HUBSPOT_TOKEN' },
    });
    expect(c).toBeInstanceOf(HubSpotConnector);
    expect(c.id).toBe('hubspot');
  });
});
