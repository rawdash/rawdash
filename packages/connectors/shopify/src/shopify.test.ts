import { RateLimitError } from '@rawdash/connector-shared';
import {
  entityStoreFor,
  eventStoreFor,
  mockJsonResponse,
} from '@rawdash/connector-test-utils';
import { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ShopifyConnector, configFields, doc } from './shopify';

const CONNECTOR_ID = 'shopify';

function makeConnector(
  resources?: ('products' | 'customers' | 'orders')[],
): ShopifyConnector {
  return new ShopifyConnector(
    { shopDomain: 'acme.myshopify.com', resources },
    { accessToken: 'shpat_test' as unknown as { $secret: string } },
  );
}

interface CapturedRequest {
  url: string;
  operation: string;
  variables: { query: string | null };
}

function stubGraphql(captured: CapturedRequest[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string, init: RequestInit) => {
      const parsed = JSON.parse(init.body as string) as {
        query: string;
        variables: { query: string | null };
      };
      const operation = parsed.query.match(/query\s+(\w+)/)?.[1] ?? '';
      captured.push({ url, operation, variables: parsed.variables });
      const key = operation.toLowerCase();
      return Promise.resolve(
        mockJsonResponse({
          data: {
            [key]: {
              nodes: [],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        }),
      );
    }),
  );
}

function makeOrdersConnector(): ShopifyConnector {
  return new ShopifyConnector(
    { shopDomain: 'acme.myshopify.com', resources: ['orders'] },
    { accessToken: 'shpat_test' as unknown as { $secret: string } },
  );
}

function order(refunds: { id: string; createdAt: string | null }[]) {
  return {
    id: 'gid://shopify/Order/1',
    name: '#1001',
    currentTotalPriceSet: {
      shopMoney: { amount: '100.00', currencyCode: 'USD' },
    },
    displayFinancialStatus: 'PAID',
    displayFulfillmentStatus: 'FULFILLED',
    customer: null,
    createdAt: '2026-01-01T00:00:00Z',
    processedAt: '2026-01-01T00:00:00Z',
    cancelledAt: null,
    updatedAt: '2026-06-01T00:00:00Z',
    refunds: refunds.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      totalRefundedSet: { shopMoney: { amount: '10.00', currencyCode: 'USD' } },
    })),
  };
}

function stubOrders(orders: ReturnType<typeof order>[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const query = (JSON.parse(init.body as string) as { query: string })
        .query;
      const op = query.match(/query\s+(\w+)/)?.[1] ?? '';
      const data =
        op === 'Orders'
          ? {
              orders: {
                nodes: orders,
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            }
          : {};
      return Promise.resolve(mockJsonResponse({ data }));
    }),
  );
}

describe('incremental refund emission', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('skips refunds created at or before the incremental cursor', async () => {
    stubOrders([
      order([
        { id: 'gid://shopify/Refund/old', createdAt: '2026-05-01T00:00:00Z' },
        { id: 'gid://shopify/Refund/new', createdAt: '2026-06-10T00:00:00Z' },
      ]),
    ]);
    const storage = new InMemoryStorage();
    await makeOrdersConnector().sync(
      { mode: 'latest', since: '2026-06-01T00:00:00Z' },
      storage.getStorageHandle(CONNECTOR_ID),
    );
    const refundIds = eventStoreFor<{
      name: string;
      attributes: { refundId: string };
    }>(storage, CONNECTOR_ID)
      .filter((e) => e.name === 'shopify_refund')
      .map((e) => e.attributes.refundId);
    expect(refundIds).toEqual(['gid://shopify/Refund/new']);
  });

  it('emits all refunds when there is no incremental cursor', async () => {
    stubOrders([
      order([
        { id: 'gid://shopify/Refund/a', createdAt: '2026-05-01T00:00:00Z' },
        { id: 'gid://shopify/Refund/b', createdAt: '2026-06-10T00:00:00Z' },
      ]),
    ]);
    const storage = new InMemoryStorage();
    await makeOrdersConnector().sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );
    const refundCount = eventStoreFor(storage, CONNECTOR_ID).filter(
      (e) => (e as { name: string }).name === 'shopify_refund',
    ).length;
    expect(refundCount).toBe(2);
  });
});

describe('Admin API version', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('targets a currently accessible stable version', async () => {
    const captured: CapturedRequest[] = [];
    stubGraphql(captured);
    const storage = new InMemoryStorage();
    await makeConnector().sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );
    expect(captured.length).toBeGreaterThan(0);
    for (const req of captured) {
      expect(req.url).toBe(
        'https://acme.myshopify.com/admin/api/2026-07/graphql.json',
      );
    }
  });
});

describe('incremental updated_at bounds', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('floors the customers cursor to the start of its UTC day and includes it', async () => {
    const captured: CapturedRequest[] = [];
    stubGraphql(captured);
    const storage = new InMemoryStorage();
    await makeConnector(['customers']).sync(
      { mode: 'latest', since: '2026-07-28T10:15:30Z' },
      storage.getStorageHandle(CONNECTOR_ID),
    );
    const customers = captured.find((r) => r.operation === 'Customers');
    expect(customers?.variables.query).toBe(
      "updated_at:>='2026-07-28T00:00:00.000Z'",
    );
  });

  it('keeps timestamp precision for products and orders', async () => {
    const captured: CapturedRequest[] = [];
    stubGraphql(captured);
    const storage = new InMemoryStorage();
    await makeConnector(['products', 'orders']).sync(
      { mode: 'latest', since: '2026-07-28T10:15:30Z' },
      storage.getStorageHandle(CONNECTOR_ID),
    );
    for (const operation of ['Products', 'Orders']) {
      expect(
        captured.find((r) => r.operation === operation)?.variables.query,
      ).toBe("updated_at:>'2026-07-28T10:15:30Z'");
    }
  });
});

describe('throttled responses', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('surfaces a 200 THROTTLED body as a rate-limit error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        mockJsonResponse({
          errors: [
            {
              message: 'Throttled',
              extensions: { code: 'THROTTLED' },
            },
          ],
        }),
      ),
    );
    const storage = new InMemoryStorage();
    const result = await makeConnector(['products']).sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );
    expect(result.transientError).toBeInstanceOf(RateLimitError);
  });

  it('leaves other GraphQL errors as plain errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        mockJsonResponse({
          errors: [
            { message: 'Field does not exist', extensions: { code: 'other' } },
          ],
        }),
      ),
    );
    const storage = new InMemoryStorage();
    const result = await makeConnector(['products']).sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );
    expect(result.transientError).toBeInstanceOf(Error);
    expect(result.transientError).not.toBeInstanceOf(RateLimitError);
  });
});

describe('options.resources', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('skips phases whose resource types were not requested', async () => {
    const captured: CapturedRequest[] = [];
    stubGraphql(captured);
    const storage = new InMemoryStorage();
    await makeConnector().sync(
      { mode: 'full', resources: new Set(['shopify_customer']) },
      storage.getStorageHandle(CONNECTOR_ID),
    );
    expect(captured.map((r) => r.operation)).toEqual(['Customers']);
  });

  it('does not clear or write orders when only refunds were requested', async () => {
    stubOrders([
      order([
        { id: 'gid://shopify/Refund/a', createdAt: '2026-06-10T00:00:00Z' },
      ]),
    ]);
    const storage = new InMemoryStorage();
    const handle = storage.getStorageHandle(CONNECTOR_ID);
    await handle.entity({
      type: 'shopify_order',
      id: 'gid://shopify/Order/existing',
      attributes: {},
      updated_at: 1,
    });
    await makeConnector().sync(
      { mode: 'full', resources: new Set(['shopify_refund']) },
      handle,
    );
    const orderIds = [
      ...(entityStoreFor(storage, CONNECTOR_ID).get('shopify_order')?.keys() ??
        []),
    ];
    expect(orderIds).toEqual(['gid://shopify/Order/existing']);
    const refundCount = eventStoreFor(storage, CONNECTOR_ID).filter(
      (e) => (e as { name: string }).name === 'shopify_refund',
    ).length;
    expect(refundCount).toBe(1);
  });
});

describe('documented scopes', () => {
  it('documents the read_all_orders requirement and the 60-day order ceiling', () => {
    const text = [...doc.auth.setup, ...(doc.limitations ?? [])].join('\n');
    expect(text).toContain('read_all_orders');
    expect(text).toContain('60 days');
  });

  it('describes throttling as an HTTP 200 body error rather than 429', () => {
    expect(doc.rateLimit).toContain('THROTTLED');
    expect(doc.rateLimit).not.toContain('relies on standard HTTP 429');
  });
});

describe('configFields', () => {
  it('parses a valid config with shopDomain and accessToken', () => {
    const result = configFields.safeParse({
      shopDomain: 'acme.myshopify.com',
      accessToken: { $secret: 'SHOPIFY_ACCESS_TOKEN' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a config missing accessToken', () => {
    const result = configFields.safeParse({
      shopDomain: 'acme.myshopify.com',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an accessToken passed as a plain string', () => {
    const result = configFields.safeParse({
      shopDomain: 'acme.myshopify.com',
      accessToken: 'shpat_plain',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a shopDomain that is not a myshopify.com domain', () => {
    const result = configFields.safeParse({
      shopDomain: 'acme.example.com',
      accessToken: { $secret: 'SHOPIFY_ACCESS_TOKEN' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a shopDomain with a protocol prefix', () => {
    const result = configFields.safeParse({
      shopDomain: 'https://acme.myshopify.com',
      accessToken: { $secret: 'SHOPIFY_ACCESS_TOKEN' },
    });
    expect(result.success).toBe(false);
  });

  it('accepts an optional resources allowlist', () => {
    const result = configFields.safeParse({
      shopDomain: 'acme.myshopify.com',
      accessToken: { $secret: 'SHOPIFY_ACCESS_TOKEN' },
      resources: ['orders'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.resources).toEqual(['orders']);
    }
  });

  it('rejects an empty resources array', () => {
    const result = configFields.safeParse({
      shopDomain: 'acme.myshopify.com',
      accessToken: { $secret: 'SHOPIFY_ACCESS_TOKEN' },
      resources: [],
    });
    expect(result.success).toBe(false);
  });
});
