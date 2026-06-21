import { eventStoreFor, mockJsonResponse } from '@rawdash/connector-test-utils';
import { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ShopifyConnector, configFields } from './shopify';

const CONNECTOR_ID = 'shopify';

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
