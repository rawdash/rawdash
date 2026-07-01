import { afterEach, describe, expect, it, vi } from 'vitest';

import { BillConnector, configFields } from './bill';

const DEV_KEY = 'BILL_DEV_KEY' as unknown as { $secret: string };
const PASSWORD = 'BILL_PASSWORD' as unknown as { $secret: string };

function makeConnector(settings?: {
  orgId?: string;
  resources?: string[];
}): BillConnector {
  return new BillConnector(
    {
      orgId: settings?.orgId ?? '00801ABCDEFGHIJKLMNO',
      resources: settings?.resources as never,
    },
    { devKey: DEV_KEY, username: 'api-user@example.com', password: PASSWORD },
  );
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

function jsonResponse(status: number, body: object): Response {
  return {
    ok: status < 400,
    status,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'application/json' }),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

function mockFetch(responsesByUrl: Record<string, object>) {
  return vi.fn().mockImplementation((url: string) => {
    const urlStr = typeof url === 'string' ? url : String(url);
    if (urlStr.includes('/login')) {
      return Promise.resolve(jsonResponse(200, { sessionId: 'session-1' }));
    }
    for (const [pattern, body] of Object.entries(responsesByUrl)) {
      if (urlStr.includes(pattern)) {
        return Promise.resolve(jsonResponse(200, body));
      }
    }
    return Promise.resolve(jsonResponse(200, { results: [], nextPage: null }));
  });
}

describe('configFields', () => {
  it('parses a valid config', () => {
    const result = configFields.safeParse({
      devKey: { $secret: 'k' },
      username: 'api-user@example.com',
      password: { $secret: 'p' },
      orgId: 'org_1',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a config missing devKey', () => {
    const result = configFields.safeParse({
      username: 'api-user@example.com',
      password: { $secret: 'p' },
      orgId: 'org_1',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a plain string password instead of a secret object', () => {
    const result = configFields.safeParse({
      devKey: { $secret: 'k' },
      username: 'api-user@example.com',
      password: 'plaintext',
      orgId: 'org_1',
    });
    expect(result.success).toBe(false);
  });

  it('treats resources as optional', () => {
    const result = configFields.safeParse({
      devKey: { $secret: 'k' },
      username: 'api-user@example.com',
      password: { $secret: 'p' },
      orgId: 'org_1',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.resources).toBeUndefined();
    }
  });
});

describe('BillConnector.sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns done:true when all phases return empty pages', async () => {
    vi.stubGlobal('fetch', mockFetch({}));
    const result = await makeConnector().sync({ mode: 'full' }, makeStorage());
    expect(result.done).toBe(true);
  });

  it('signs in once with the developer key, credentials, and org id', async () => {
    const fetchSpy = mockFetch({});
    vi.stubGlobal('fetch', fetchSpy);
    await makeConnector().sync({ mode: 'full' }, makeStorage());

    const loginCalls = fetchSpy.mock.calls.filter((c: unknown[]) =>
      String(c[0]).includes('/login'),
    );
    expect(loginCalls).toHaveLength(1);
    const body = JSON.parse(
      (loginCalls[0]![1] as { body: string }).body,
    ) as Record<string, string>;
    expect(body).toEqual({
      username: 'api-user@example.com',
      password: 'BILL_PASSWORD',
      organizationId: '00801ABCDEFGHIJKLMNO',
      devKey: 'BILL_DEV_KEY',
    });
  });

  it('sends the session id and developer key headers on list requests', async () => {
    const fetchSpy = mockFetch({});
    vi.stubGlobal('fetch', fetchSpy);
    await makeConnector({ resources: ['vendors'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );
    const listCall = fetchSpy.mock.calls.find((c: unknown[]) =>
      String(c[0]).includes('/vendors'),
    );
    const headers = (listCall![1] as { headers: Record<string, string> })
      .headers;
    expect(headers.sessionid).toBe('session-1');
    expect(headers.devkey).toBe('BILL_DEV_KEY');
  });

  it('clears entity types and event names at the start of a full sync', async () => {
    const storage = makeStorage();
    vi.stubGlobal('fetch', mockFetch({}));
    await makeConnector().sync({ mode: 'full' }, storage);

    const clearedTypes = storage.entities.mock.calls
      .filter((c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0)
      .map((c) => (c[1] as { types: string[] }).types[0]);
    const clearedNames = storage.events.mock.calls
      .filter((c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0)
      .map((c) => (c[1] as { names: string[] }).names[0]);

    expect(clearedTypes).toContain('bill_vendor');
    expect(clearedTypes).toContain('bill_bill');
    expect(clearedNames).toContain('bill_payment');
  });

  it('does not clear storage in incremental (latest) mode', async () => {
    const storage = makeStorage();
    vi.stubGlobal('fetch', mockFetch({}));
    await makeConnector().sync(
      { mode: 'latest', since: new Date(Date.now() - 60_000).toISOString() },
      storage,
    );

    const entityClears = storage.entities.mock.calls.filter(
      (c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0,
    );
    const eventClears = storage.events.mock.calls.filter(
      (c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0,
    );
    expect(entityClears).toHaveLength(0);
    expect(eventClears).toHaveLength(0);
  });

  it('filters on updatedTime when syncing incrementally', async () => {
    const fetchSpy = mockFetch({});
    vi.stubGlobal('fetch', fetchSpy);
    const since = '2026-01-01T00:00:00.000Z';
    await makeConnector({ resources: ['bills'] }).sync(
      { mode: 'latest', since },
      makeStorage(),
    );
    const billsUrl = fetchSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .find((u) => u.includes('/bills'));
    expect(billsUrl).toBeDefined();
    const filters = new URL(billsUrl!).searchParams.get('filters');
    expect(filters).toBe(`updatedTime:gte:"${since}"`);
  });

  it('writes bill entities with mapped attributes', async () => {
    const storage = makeStorage();
    vi.stubGlobal(
      'fetch',
      mockFetch({
        '/bills': {
          results: [
            {
              id: '00n01BILL',
              vendorId: '00901VENDOR',
              amount: 228.99,
              dueDate: '2026-01-31',
              invoice: { invoiceNumber: '202601', invoiceDate: '2026-01-01' },
              paymentStatus: 'UNPAID',
              approvalStatus: 'UNASSIGNED',
              archived: false,
              createdTime: '2026-01-01T00:00:00.000+00:00',
              updatedTime: '2026-01-02T00:00:00.000+00:00',
            },
          ],
          nextPage: null,
        },
      }),
    );
    await makeConnector({ resources: ['bills'] }).sync(
      { mode: 'full' },
      storage,
    );

    const call = storage.entity.mock.calls.find(
      (c) => (c[0] as { id: string }).id === '00n01BILL',
    );
    expect(call).toBeDefined();
    const arg = call![0] as {
      type: string;
      attributes: Record<string, unknown>;
    };
    expect(arg.type).toBe('bill_bill');
    expect(arg.attributes.vendorId).toBe('00901VENDOR');
    expect(arg.attributes.invoiceNumber).toBe('202601');
    expect(arg.attributes.amount).toBe(228.99);
    expect(arg.attributes.paymentStatus).toBe('UNPAID');
    expect(arg.attributes.dueDate).toBe(Date.parse('2026-01-31'));
  });

  it('writes payment events timestamped at the process date', async () => {
    const storage = makeStorage();
    vi.stubGlobal(
      'fetch',
      mockFetch({
        '/payments': {
          results: [
            {
              id: 'stp01PAYMENT',
              vendorId: '00901VENDOR',
              billId: '00n01BILL',
              amount: 228.99,
              processDate: '2026-01-15',
              status: 'SCHEDULED',
              description: 'Inv #202601',
              createdTime: '2026-01-14T00:00:00.000+00:00',
              updatedTime: '2026-01-14T00:00:00.000+00:00',
            },
          ],
          nextPage: null,
        },
      }),
    );
    await makeConnector({ resources: ['payments'] }).sync(
      { mode: 'full' },
      storage,
    );

    const call = storage.event.mock.calls.find(
      (c) =>
        (c[0] as { attributes: { id: string } }).attributes.id ===
        'stp01PAYMENT',
    );
    expect(call).toBeDefined();
    const arg = call![0] as {
      name: string;
      start_ts: number;
      attributes: Record<string, unknown>;
    };
    expect(arg.name).toBe('bill_payment');
    expect(arg.start_ts).toBe(Date.parse('2026-01-15'));
    expect(arg.attributes.status).toBe('SCHEDULED');
    expect(arg.attributes.billId).toBe('00n01BILL');
  });

  it('only fetches the resources listed in settings.resources', async () => {
    const fetchSpy = mockFetch({});
    vi.stubGlobal('fetch', fetchSpy);
    await makeConnector({ resources: ['vendors'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );
    const urls = fetchSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(urls.some((u) => u.includes('/vendors'))).toBe(true);
    expect(urls.some((u) => u.includes('/bills'))).toBe(false);
    expect(urls.some((u) => u.includes('/payments'))).toBe(false);
  });

  it('re-establishes the session and retries once on a 401', async () => {
    let listCalls = 0;
    const fetchSpy = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('/login')) {
        return Promise.resolve(jsonResponse(200, { sessionId: 'session-2' }));
      }
      listCalls += 1;
      if (listCalls === 1) {
        return Promise.resolve(jsonResponse(401, { error: 'expired' }));
      }
      return Promise.resolve(
        jsonResponse(200, { results: [], nextPage: null }),
      );
    });
    vi.stubGlobal('fetch', fetchSpy);

    await makeConnector({ resources: ['vendors'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const loginCalls = fetchSpy.mock.calls.filter((c: unknown[]) =>
      String(c[0]).includes('/login'),
    );
    expect(loginCalls.length).toBeGreaterThanOrEqual(2);
    expect(listCalls).toBeGreaterThanOrEqual(2);
  });
});

describe('BillConnector.create', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the connector instance directly', () => {
    vi.stubEnv('BILL_DEV_KEY_FIXTURE', 'dev-key');
    vi.stubEnv('BILL_PASSWORD_FIXTURE', 'pw');
    const connector = BillConnector.create({
      devKey: { $secret: 'BILL_DEV_KEY_FIXTURE' },
      username: 'api-user@example.com',
      password: { $secret: 'BILL_PASSWORD_FIXTURE' },
      orgId: 'org_1',
    });
    expect(connector).toBeInstanceOf(BillConnector);
    expect(connector.id).toBe('bill');
  });
});
