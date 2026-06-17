import { afterEach, describe, expect, it, vi } from 'vitest';

import { StripeConnector, computeMrrAmountCents, configFields } from './stripe';

describe('configFields', () => {
  it('parses a valid config with only apiKey', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'sk_test_abc' },
    });
    expect(result.success).toBe(true);
  });

  it('parses a valid config with apiKey and accountId', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'sk_test_abc' },
      accountId: 'acct_123',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.accountId).toBe('acct_123');
    }
  });

  it('rejects a config missing apiKey', () => {
    const result = configFields.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects a config with a plain string apiKey instead of secret object', () => {
    const result = configFields.safeParse({ apiKey: 'sk_test_plain' });
    expect(result.success).toBe(false);
  });

  it('accountId is optional', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'sk_test_abc' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.accountId).toBeUndefined();
    }
  });
});

function makeSubscription(
  interval: 'day' | 'week' | 'month' | 'year',
  intervalCount: number,
  unitAmount: number,
  quantity: number,
) {
  return {
    id: 'sub_test',
    customer: 'cus_test',
    status: 'active',
    items: {
      data: [
        {
          price: {
            id: 'price_test',
            product: 'prod_test',
            unit_amount: unitAmount,
            currency: 'usd',
            recurring: { interval, interval_count: intervalCount },
            active: true,
            created: 1700000000,
          },
          quantity,
        },
      ],
    },
    current_period_start: 1700000000,
    current_period_end: 1702592000,
    cancel_at_period_end: false,
    canceled_at: null,
    trial_end: null,
    currency: 'usd',
    created: 1700000000,
  };
}

describe('computeMrrAmountCents', () => {
  it('returns the unit amount as-is for monthly subscriptions', () => {
    expect(computeMrrAmountCents(makeSubscription('month', 1, 5000, 1))).toBe(
      5000,
    );
  });

  it('divides annual amount by 12 for yearly subscriptions', () => {
    expect(computeMrrAmountCents(makeSubscription('year', 1, 12000, 1))).toBe(
      1000,
    );
  });

  it('multiplies quantity for monthly subscriptions', () => {
    expect(computeMrrAmountCents(makeSubscription('month', 1, 5000, 3))).toBe(
      15000,
    );
  });

  it('handles multi-month intervals', () => {
    expect(computeMrrAmountCents(makeSubscription('month', 6, 30000, 1))).toBe(
      5000,
    );
  });

  it('handles weekly billing', () => {
    const mrr = computeMrrAmountCents(makeSubscription('week', 1, 1000, 1));
    expect(mrr).toBe(Math.round((1000 * 52) / 12));
  });

  it('returns null when unit_amount is null', () => {
    const sub = makeSubscription('month', 1, 5000, 1);
    (sub.items.data[0]!.price as { unit_amount: number | null }).unit_amount =
      null;
    expect(computeMrrAmountCents(sub)).toBeNull();
  });

  it('returns null when there are no items', () => {
    const sub = makeSubscription('month', 1, 5000, 1);
    sub.items.data = [];
    expect(computeMrrAmountCents(sub)).toBeNull();
  });

  it('sums recurring MRR across multiple subscription items', () => {
    const sub = makeSubscription('month', 1, 5000, 1);
    sub.items.data.push({
      price: {
        id: 'price_test_2',
        product: 'prod_test_2',
        unit_amount: 2500,
        currency: 'usd',
        recurring: { interval: 'month', interval_count: 1 },
        active: true,
        created: 1700000000,
      },
      quantity: 2,
    });
    expect(computeMrrAmountCents(sub)).toBe(10000);
  });

  it('sums monthly and yearly items, normalising to monthly', () => {
    const sub = makeSubscription('month', 1, 5000, 1);
    sub.items.data.push({
      price: {
        id: 'price_test_yearly',
        product: 'prod_test_yearly',
        unit_amount: 12000,
        currency: 'usd',
        recurring: { interval: 'year', interval_count: 1 },
        active: true,
        created: 1700000000,
      },
      quantity: 1,
    });
    expect(computeMrrAmountCents(sub)).toBe(6000);
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

function makeEmptyStripeResponse<T>(): {
  object: 'list';
  data: T[];
  has_more: boolean;
  url: string;
} {
  return { object: 'list', data: [], has_more: false, url: '' };
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
    return Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      text: () =>
        Promise.resolve(JSON.stringify(makeEmptyStripeResponse<never>())),
    } as Response);
  });
}

describe('StripeConnector.sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns done:true when all phases return empty pages', async () => {
    const connector = new StripeConnector(
      {},
      { apiKey: 'sk_test_abc' as unknown as { $secret: string } },
    );

    const fetchSpy = mockFetch({});
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    const result = await connector.sync({ mode: 'full' }, storage);

    expect(result.done).toBe(true);
  });

  it('clears entity types at start of full sync phases', async () => {
    const connector = new StripeConnector(
      {},
      { apiKey: 'sk_test_abc' as unknown as { $secret: string } },
    );

    vi.stubGlobal('fetch', mockFetch({}));
    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const entityCalls = storage.entities.mock.calls;
    const clearedTypes = entityCalls
      .filter((c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0)
      .map((c) => (c[1] as { types: string[] }).types[0]);

    expect(clearedTypes).toContain('stripe_customer');
    expect(clearedTypes).toContain('stripe_product');
    expect(clearedTypes).toContain('stripe_price');
    expect(clearedTypes).toContain('stripe_subscription');
    expect(clearedTypes).toContain('stripe_invoice');
  });

  it('clears event names at start of full sync phases', async () => {
    const connector = new StripeConnector(
      {},
      { apiKey: 'sk_test_abc' as unknown as { $secret: string } },
    );

    vi.stubGlobal('fetch', mockFetch({}));
    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const eventCalls = storage.events.mock.calls;
    const clearedNames = eventCalls
      .filter((c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0)
      .map((c) => (c[1] as { names: string[] }).names[0]);

    expect(clearedNames).toContain('stripe_charge');
    expect(clearedNames).toContain('stripe_payment_intent');
    expect(clearedNames).toContain('stripe_dispute');
    expect(clearedNames).toContain('stripe_refund');
  });

  it('does not clear storage in latest (incremental) mode', async () => {
    const connector = new StripeConnector(
      {},
      { apiKey: 'sk_test_abc' as unknown as { $secret: string } },
    );

    vi.stubGlobal('fetch', mockFetch({}));
    const storage = makeStorage();
    await connector.sync(
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

  it('writes customer entities from API response', async () => {
    const customer: object = {
      id: 'cus_abc',
      email: 'alice@example.com',
      name: 'Alice',
      created: 1700000000,
      currency: 'usd',
      delinquent: false,
      livemode: false,
    };

    const connector = new StripeConnector(
      {},
      { apiKey: 'sk_test_abc' as unknown as { $secret: string } },
    );

    vi.stubGlobal(
      'fetch',
      mockFetch({
        '/v1/customers': {
          object: 'list',
          data: [customer],
          has_more: false,
          url: '/v1/customers',
        },
      }),
    );

    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const entityCall = storage.entity.mock.calls.find(
      (c) => (c[0] as { id: string }).id === 'cus_abc',
    );
    expect(entityCall).toBeDefined();
    expect((entityCall![0] as { type: string }).type).toBe('stripe_customer');
    expect(
      (entityCall![0] as { attributes: { email: string } }).attributes.email,
    ).toBe('alice@example.com');
  });

  it('resumes from a saved cursor', async () => {
    const connector = new StripeConnector(
      {},
      { apiKey: 'sk_test_abc' as unknown as { $secret: string } },
    );

    const fetchSpy = mockFetch({});
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector.sync(
      {
        mode: 'full',
        cursor: { phase: 'charges', page: 'ch_prev' },
      },
      storage,
    );

    const calledUrls: string[] = fetchSpy.mock.calls.map(
      (c: unknown[]) => c[0] as string,
    );
    const customerCallCount = calledUrls.filter((u) =>
      u.includes('/v1/customers'),
    ).length;
    const chargeCallCount = calledUrls.filter((u) =>
      u.includes('/v1/charges'),
    ).length;

    expect(customerCallCount).toBe(0);
    expect(chargeCallCount).toBeGreaterThan(0);
    const resumedChargeUrl = calledUrls.find((u) => u.includes('/v1/charges'));
    expect(resumedChargeUrl).toContain('starting_after=ch_prev');
  });

  it('includes Stripe-Account header when accountId is set', async () => {
    const connector = new StripeConnector(
      { accountId: 'acct_xyz' },
      { apiKey: 'sk_test_abc' as unknown as { $secret: string } },
    );

    const fetchSpy = mockFetch({});
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const firstCall = fetchSpy.mock.calls[0];
    const headers = firstCall?.[1]?.headers as Record<string, string>;
    expect(headers?.['stripe-account']).toBe('acct_xyz');
  });

  it('only fetches the resources listed in settings.resources', async () => {
    const connector = new StripeConnector(
      { resources: ['customers', 'charges'] },
      { apiKey: 'sk_test_abc' as unknown as { $secret: string } },
    );

    const fetchSpy = mockFetch({});
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const calledUrls: string[] = fetchSpy.mock.calls.map(
      (c: unknown[]) => c[0] as string,
    );
    expect(calledUrls.some((u) => u.includes('/v1/customers'))).toBe(true);
    expect(calledUrls.some((u) => u.includes('/v1/charges'))).toBe(true);
    expect(calledUrls.some((u) => u.includes('/v1/subscriptions'))).toBe(false);
    expect(calledUrls.some((u) => u.includes('/v1/invoices'))).toBe(false);
    expect(calledUrls.some((u) => u.includes('/v1/disputes'))).toBe(false);
  });

  it('syncs all resources when settings.resources is omitted', async () => {
    const connector = new StripeConnector(
      {},
      { apiKey: 'sk_test_abc' as unknown as { $secret: string } },
    );

    const fetchSpy = mockFetch({});
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const calledUrls: string[] = fetchSpy.mock.calls.map(
      (c: unknown[]) => c[0] as string,
    );
    for (const path of [
      '/v1/customers',
      '/v1/products',
      '/v1/prices',
      '/v1/subscriptions',
      '/v1/invoices',
      '/v1/charges',
      '/v1/payment_intents',
      '/v1/disputes',
      '/v1/refunds',
    ]) {
      expect(calledUrls.some((u) => u.includes(path))).toBe(true);
    }
  });

  it('re-reads all subscriptions in latest mode without a created filter', async () => {
    const connector = new StripeConnector(
      {},
      { apiKey: 'sk_test_abc' as unknown as { $secret: string } },
    );

    const fetchSpy = mockFetch({});
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector.sync(
      { mode: 'latest', since: new Date(Date.now() - 60_000).toISOString() },
      storage,
    );

    const calledUrls: string[] = fetchSpy.mock.calls.map(
      (c: unknown[]) => c[0] as string,
    );
    const subscriptionsUrl = calledUrls.find((u) =>
      u.includes('/v1/subscriptions'),
    );
    const customersUrl = calledUrls.find((u) => u.includes('/v1/customers'));

    expect(subscriptionsUrl).toBeDefined();
    expect(subscriptionsUrl).not.toContain('created');
    expect(subscriptionsUrl).toContain('status=all');
    expect(customersUrl).toContain('created');
  });

  it('paginates subscription items and sums MRR across all of them when items.has_more', async () => {
    const firstItem = {
      id: 'si_1',
      price: {
        id: 'price_1',
        product: 'prod_1',
        unit_amount: 1000,
        currency: 'usd',
        recurring: { interval: 'month', interval_count: 1 },
        active: true,
        created: 1700000000,
      },
      quantity: 1,
    };
    const subscription = {
      id: 'sub_multi',
      customer: 'cus_x',
      status: 'active',
      items: { data: [firstItem], has_more: true },
      current_period_start: 1700000000,
      current_period_end: 1702592000,
      cancel_at_period_end: false,
      canceled_at: null,
      trial_end: null,
      currency: 'usd',
      created: 1700000000,
    };
    const allItems = [
      firstItem,
      {
        id: 'si_2',
        price: {
          id: 'price_2',
          product: 'prod_2',
          unit_amount: 2500,
          currency: 'usd',
          recurring: { interval: 'month', interval_count: 1 },
          active: true,
          created: 1700000000,
        },
        quantity: 2,
      },
    ];

    const connector = new StripeConnector(
      { resources: ['subscriptions'] },
      { apiKey: 'sk_test_abc' as unknown as { $secret: string } },
    );

    const fetchSpy = mockFetch({
      '/v1/subscription_items': {
        object: 'list',
        data: allItems,
        has_more: false,
        url: '/v1/subscription_items',
      },
      '/v1/subscriptions': {
        object: 'list',
        data: [subscription],
        has_more: false,
        url: '/v1/subscriptions',
      },
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const calledUrls: string[] = fetchSpy.mock.calls.map(
      (c: unknown[]) => c[0] as string,
    );
    const subItemsUrl = calledUrls.find((u) =>
      u.includes('/v1/subscription_items'),
    );
    expect(subItemsUrl).toBeDefined();
    expect(subItemsUrl).toContain('subscription=sub_multi');

    const subEntity = storage.entity.mock.calls.find(
      (c) => (c[0] as { id: string }).id === 'sub_multi',
    );
    expect(subEntity).toBeDefined();
    expect(
      (subEntity![0] as { attributes: { mrrAmount: number } }).attributes
        .mrrAmount,
    ).toBe(6000);
  });
});

describe('StripeConnector.create', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the connector instance directly', () => {
    vi.stubEnv('STRIPE_TEST_KEY', 'test_stripe_key_fixture');
    const connector = StripeConnector.create({
      apiKey: { $secret: 'STRIPE_TEST_KEY' },
    });
    expect(connector).toBeInstanceOf(StripeConnector);
    expect(connector.id).toBe('stripe');
  });
});

describe('StripeConnector filter pushdown', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function urlFor(spy: ReturnType<typeof vi.fn>, fragment: string): URL {
    const url = spy.mock.calls
      .map((c) => String(c[0]))
      .find((u) => u.includes(fragment));
    expect(url).toBeDefined();
    return new URL(url!);
  }

  async function syncWith(
    resource: 'subscriptions' | 'invoices',
    fetchSpecs: Record<string, { filter: unknown[] }[]>,
  ): Promise<ReturnType<typeof vi.fn>> {
    const connector = new StripeConnector(
      { resources: [resource] },
      { apiKey: 'sk_test_abc' as unknown as { $secret: string } },
    );
    const fetchSpy = mockFetch({});
    vi.stubGlobal('fetch', fetchSpy);
    await connector.sync(
      { mode: 'full', fetchSpecs: fetchSpecs as never },
      makeStorage(),
    );
    return fetchSpy;
  }

  it('pushes a subscription status filter', async () => {
    const spy = await syncWith('subscriptions', {
      stripe_subscription: [
        { filter: [{ field: 'status', op: 'eq', value: 'active' }] },
      ],
    });
    expect(urlFor(spy, '/v1/subscriptions').searchParams.get('status')).toBe(
      'active',
    );
  });

  it('defaults subscriptions to status=all without a filter', async () => {
    const spy = await syncWith('subscriptions', {});
    expect(urlFor(spy, '/v1/subscriptions').searchParams.get('status')).toBe(
      'all',
    );
  });

  it('pushes an invoice status filter', async () => {
    const spy = await syncWith('invoices', {
      stripe_invoice: [
        { filter: [{ field: 'status', op: 'eq', value: 'open' }] },
      ],
    });
    expect(urlFor(spy, '/v1/invoices').searchParams.get('status')).toBe('open');
  });

  it('pushes a product active filter', async () => {
    const connector = new StripeConnector(
      { resources: ['products'] },
      { apiKey: 'sk_test_abc' as unknown as { $secret: string } },
    );
    const fetchSpy = mockFetch({});
    vi.stubGlobal('fetch', fetchSpy);
    await connector.sync(
      {
        mode: 'full',
        fetchSpecs: {
          stripe_product: [
            { filter: [{ field: 'active', op: 'eq', value: 'true' }] },
          ],
        } as never,
      },
      makeStorage(),
    );
    expect(urlFor(fetchSpy, '/v1/products').searchParams.get('active')).toBe(
      'true',
    );
  });

  it('pushes a price active filter', async () => {
    const connector = new StripeConnector(
      { resources: ['prices'] },
      { apiKey: 'sk_test_abc' as unknown as { $secret: string } },
    );
    const fetchSpy = mockFetch({});
    vi.stubGlobal('fetch', fetchSpy);
    await connector.sync(
      {
        mode: 'full',
        fetchSpecs: {
          stripe_price: [
            { filter: [{ field: 'active', op: 'eq', value: 'false' }] },
          ],
        } as never,
      },
      makeStorage(),
    );
    expect(urlFor(fetchSpy, '/v1/prices').searchParams.get('active')).toBe(
      'false',
    );
  });

  it('does not push when multiple specs target subscriptions', async () => {
    const spy = await syncWith('subscriptions', {
      stripe_subscription: [
        { filter: [{ field: 'status', op: 'eq', value: 'active' }] },
        { filter: [{ field: 'status', op: 'eq', value: 'canceled' }] },
      ],
    });
    expect(urlFor(spy, '/v1/subscriptions').searchParams.get('status')).toBe(
      'all',
    );
  });
});
