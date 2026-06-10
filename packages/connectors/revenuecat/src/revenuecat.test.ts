import { afterEach, describe, expect, it, vi } from 'vitest';

import { RevenueCatConnector, configFields } from './revenuecat';

const SECRET = 'sk_test_abc' as unknown as { $secret: string };

describe('configFields', () => {
  it('parses a valid config', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'REVENUECAT_API_KEY' },
      projectId: 'proj_abc',
    });
    expect(result.success).toBe(true);
  });

  it('requires projectId', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'REVENUECAT_API_KEY' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a plain string apiKey', () => {
    const result = configFields.safeParse({
      apiKey: 'sk_test_plain',
      projectId: 'proj_abc',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a resources allowlist', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'REVENUECAT_API_KEY' },
      projectId: 'proj_abc',
      resources: ['products', 'events'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.resources).toEqual(['products', 'events']);
    }
  });

  it('rejects unknown resources', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'REVENUECAT_API_KEY' },
      projectId: 'proj_abc',
      resources: ['products', 'unknown'],
    });
    expect(result.success).toBe(false);
  });
});

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

function emptyListBody(): {
  object: 'list';
  items: unknown[];
  next_page: string | null;
} {
  return { object: 'list', items: [], next_page: null };
}

function emptyOverviewBody(): { object: 'list'; metrics: unknown[] } {
  return { object: 'list', metrics: [] };
}

function mockFetch(responsesByUrl: Record<string, object>) {
  return vi.fn().mockImplementation((url: string) => {
    const urlStr = typeof url === 'string' ? url : String(url);
    for (const [pattern, body] of Object.entries(responsesByUrl)) {
      if (urlStr.includes(pattern)) {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(body)),
        } as Response);
      }
    }
    const body = urlStr.includes('/metrics/overview')
      ? emptyOverviewBody()
      : emptyListBody();
    return Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      text: () => Promise.resolve(JSON.stringify(body)),
    } as Response);
  });
}

const BASE_SETTINGS = { projectId: 'proj_abc' };

describe('RevenueCatConnector.sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns done:true when all phases return empty', async () => {
    const connector = new RevenueCatConnector(BASE_SETTINGS, {
      apiKey: SECRET,
    });
    vi.stubGlobal('fetch', mockFetch({}));
    const storage = makeStorage();
    const result = await connector.sync({ mode: 'full' }, storage);
    expect(result.done).toBe(true);
  });

  it('clears entity types at start of full-sync phases', async () => {
    const connector = new RevenueCatConnector(BASE_SETTINGS, {
      apiKey: SECRET,
    });
    vi.stubGlobal('fetch', mockFetch({}));
    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const clearedTypes = storage.entities.mock.calls
      .filter((c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0)
      .flatMap((c) => (c[1] as { types: string[] }).types);

    expect(clearedTypes).toContain('revenuecat_product');
    expect(clearedTypes).toContain('revenuecat_entitlement');
    expect(clearedTypes).toContain('revenuecat_customer');
    expect(clearedTypes).toContain('revenuecat_subscription');
  });

  it('clears event names at start of full-sync events phase', async () => {
    const connector = new RevenueCatConnector(BASE_SETTINGS, {
      apiKey: SECRET,
    });
    vi.stubGlobal('fetch', mockFetch({}));
    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const clearedEventNames = storage.events.mock.calls
      .filter((c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0)
      .flatMap((c) => (c[1] as { names: string[] }).names);

    expect(clearedEventNames).toContain('revenuecat_event');
  });

  it('does not clear storage in incremental (latest) mode', async () => {
    const connector = new RevenueCatConnector(BASE_SETTINGS, {
      apiKey: SECRET,
    });
    vi.stubGlobal('fetch', mockFetch({}));
    const storage = makeStorage();
    await connector.sync(
      { mode: 'latest', since: new Date(Date.now() - 60_000).toISOString() },
      storage,
    );
    const entityClears = storage.entities.mock.calls.filter(
      (c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0,
    );
    expect(entityClears).toHaveLength(0);
  });

  it('writes a product entity from the API response', async () => {
    const product = {
      id: 'prod_1',
      store_identifier: 'com.example.pro_monthly',
      type: 'subscription',
      app_id: 'app_1',
      display_name: 'Pro Monthly',
      created_at: 1700000000,
    };
    const connector = new RevenueCatConnector(BASE_SETTINGS, {
      apiKey: SECRET,
    });
    vi.stubGlobal(
      'fetch',
      mockFetch({
        '/products': {
          object: 'list',
          items: [product],
          next_page: null,
        },
      }),
    );
    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const call = storage.entity.mock.calls.find(
      (c) => (c[0] as { id: string }).id === 'prod_1',
    );
    expect(call).toBeDefined();
    const arg = call![0] as {
      type: string;
      attributes: { storeIdentifier: string; displayName: string };
    };
    expect(arg.type).toBe('revenuecat_product');
    expect(arg.attributes.storeIdentifier).toBe('com.example.pro_monthly');
    expect(arg.attributes.displayName).toBe('Pro Monthly');
  });

  it('extracts subscription entities embedded in customer responses', async () => {
    const customer = {
      id: 'cust_1',
      first_seen_at: 1700000000,
      last_seen_at: 1710000000,
      active_entitlements: { items: [{ entitlement_id: 'entl_pro' }] },
      subscriptions: {
        items: [
          {
            id: 'sub_1',
            product_id: 'prod_1',
            store: 'app_store',
            status: 'active',
            starts_at: 1700000000,
            current_period_ends_at: 1710000000,
            gives_access: true,
            auto_renewal_status: 'will_renew',
          },
        ],
      },
    };
    const connector = new RevenueCatConnector(BASE_SETTINGS, {
      apiKey: SECRET,
    });
    vi.stubGlobal(
      'fetch',
      mockFetch({
        '/customers': {
          object: 'list',
          items: [customer],
          next_page: null,
        },
      }),
    );
    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const customerCall = storage.entity.mock.calls.find(
      (c) => (c[0] as { id: string }).id === 'cust_1',
    );
    expect(customerCall).toBeDefined();
    expect((customerCall![0] as { type: string }).type).toBe(
      'revenuecat_customer',
    );

    const subCall = storage.entity.mock.calls.find(
      (c) => (c[0] as { id: string }).id === 'sub_1',
    );
    expect(subCall).toBeDefined();
    const arg = subCall![0] as {
      type: string;
      attributes: { customerId: string; productId: string; status: string };
    };
    expect(arg.type).toBe('revenuecat_subscription');
    expect(arg.attributes.customerId).toBe('cust_1');
    expect(arg.attributes.productId).toBe('prod_1');
    expect(arg.attributes.status).toBe('active');
  });

  it('writes subscription events as event rows', async () => {
    const event = {
      id: 'evt_1',
      type: 'INITIAL_PURCHASE',
      timestamp_ms: 1700000000000,
      app_user_id: 'user_1',
      product_id: 'prod_1',
      store: 'app_store',
      environment: 'production',
      price_in_purchased_currency: 9.99,
      currency: 'USD',
    };
    const connector = new RevenueCatConnector(BASE_SETTINGS, {
      apiKey: SECRET,
    });
    vi.stubGlobal(
      'fetch',
      mockFetch({
        '/events': {
          object: 'list',
          items: [event],
          next_page: null,
        },
      }),
    );
    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const eventCall = storage.event.mock.calls.find(
      (c) => (c[0] as { attributes: { id: string } }).attributes.id === 'evt_1',
    );
    expect(eventCall).toBeDefined();
    const arg = eventCall![0] as {
      name: string;
      start_ts: number;
      attributes: { type: string; currency: string };
    };
    expect(arg.name).toBe('revenuecat_event');
    expect(arg.start_ts).toBe(1700000000000);
    expect(arg.attributes.type).toBe('INITIAL_PURCHASE');
    expect(arg.attributes.currency).toBe('USD');
  });

  it('emits one metric sample per overview metric returned', async () => {
    const connector = new RevenueCatConnector(BASE_SETTINGS, {
      apiKey: SECRET,
    });
    vi.stubGlobal(
      'fetch',
      mockFetch({
        '/metrics/overview': {
          object: 'list',
          metrics: [
            { id: 'mrr', value: 12345, unit: 'USD' },
            { id: 'active_subscriptions', value: 200, unit: 'count' },
          ],
        },
      }),
    );
    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const metricsCall = storage.metrics.mock.calls.find(
      (c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 2,
    );
    expect(metricsCall).toBeDefined();
    const samples = metricsCall![0] as Array<{
      name: string;
      value: number;
      attributes: { metric: string; unit: string };
    }>;
    const byMetric = Object.fromEntries(
      samples.map((s) => [s.attributes.metric, s]),
    );
    expect(byMetric['mrr']!.value).toBe(12345);
    expect(byMetric['mrr']!.attributes.unit).toBe('USD');
    expect(byMetric['active_subscriptions']!.value).toBe(200);
  });

  it('resumes from a saved cursor mid-phase', async () => {
    const connector = new RevenueCatConnector(BASE_SETTINGS, {
      apiKey: SECRET,
    });
    const fetchSpy = mockFetch({});
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector.sync(
      {
        mode: 'full',
        cursor: { phase: 'events', page: 'evt_prev' },
      },
      storage,
    );

    const urls: string[] = fetchSpy.mock.calls.map(
      (c: unknown[]) => c[0] as string,
    );
    expect(urls.some((u) => u.includes('/products'))).toBe(false);
    expect(urls.some((u) => u.includes('/customers'))).toBe(false);
    const resumed = urls.find((u) => u.includes('/events'));
    expect(resumed).toBeDefined();
    expect(resumed!).toContain('starting_after=evt_prev');
  });

  it('only fetches resources listed in settings.resources', async () => {
    const connector = new RevenueCatConnector(
      { ...BASE_SETTINGS, resources: ['products', 'events'] },
      { apiKey: SECRET },
    );
    const fetchSpy = mockFetch({});
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const urls: string[] = fetchSpy.mock.calls.map(
      (c: unknown[]) => c[0] as string,
    );
    expect(urls.some((u) => u.includes('/products'))).toBe(true);
    expect(urls.some((u) => u.includes('/events'))).toBe(true);
    expect(urls.some((u) => u.includes('/customers'))).toBe(false);
    expect(urls.some((u) => u.includes('/entitlements'))).toBe(false);
    expect(urls.some((u) => u.includes('/metrics/overview'))).toBe(false);
  });

  it('passes starting_at on the events URL when given options.since', async () => {
    const connector = new RevenueCatConnector(BASE_SETTINGS, {
      apiKey: SECRET,
    });
    const fetchSpy = mockFetch({});
    vi.stubGlobal('fetch', fetchSpy);

    const since = '2024-01-01T00:00:00.000Z';
    const storage = makeStorage();
    await connector.sync({ mode: 'latest', since }, storage);

    const urls: string[] = fetchSpy.mock.calls.map(
      (c: unknown[]) => c[0] as string,
    );
    const evUrl = urls.find((u) => u.includes('/events'));
    expect(evUrl).toBeDefined();
    expect(evUrl!).toContain(`starting_at=${Date.parse(since)}`);
  });

  it('sends Authorization: Bearer header', async () => {
    const connector = new RevenueCatConnector(BASE_SETTINGS, {
      apiKey: SECRET,
    });
    const fetchSpy = mockFetch({});
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const firstCall = fetchSpy.mock.calls[0];
    const headers = firstCall?.[1]?.headers as Record<string, string>;
    expect(headers?.authorization).toBe(`Bearer ${String(SECRET)}`);
  });

  it('encodes projectId into the URL', async () => {
    const connector = new RevenueCatConnector(
      { projectId: 'proj/with space' },
      { apiKey: SECRET },
    );
    const fetchSpy = mockFetch({});
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector.sync(
      { mode: 'full', resources: new Set(['products']) },
      storage,
    );

    const urls: string[] = fetchSpy.mock.calls.map(
      (c: unknown[]) => c[0] as string,
    );
    expect(urls[0]).toContain('proj%2Fwith%20space');
  });
});

describe('RevenueCatConnector.create', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the connector instance directly', () => {
    vi.stubEnv('REVENUECAT_TEST_KEY', 'test_revenuecat_key');
    const connector = RevenueCatConnector.create({
      apiKey: { $secret: 'REVENUECAT_TEST_KEY' },
      projectId: 'proj_abc',
    });
    expect(connector).toBeInstanceOf(RevenueCatConnector);
    expect(connector.id).toBe('revenuecat');
  });
});
