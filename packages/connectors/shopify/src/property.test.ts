import {
  type InvariantViolation,
  connectorResourceShapeViolations,
  entityStoreFor,
  eventStoreFor,
  mockJsonResponse,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import type { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';
import { z } from 'zod';

import { ShopifyConnector } from './shopify';

const CONNECTOR_ID = 'shopify';

const docShapeExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    ShopifyConnector.resources,
    storage,
    connectorId,
  );

interface GraphQLCall {
  query: string;
  variables: Record<string, unknown>;
}

function emptyConn() {
  return { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } };
}

function operationName(query: string): string {
  return query.match(/query\s+(\w+)/)?.[1] ?? '';
}

function installGraphqlMock(
  responseFor: (op: string) => Record<string, unknown>,
): ReturnType<typeof vi.fn> {
  const spy = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
    const parsed = JSON.parse(init.body as string) as GraphQLCall;
    const data = responseFor(operationName(parsed.query));
    return Promise.resolve(mockJsonResponse({ data }));
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

function makeConnector(): ShopifyConnector {
  return new ShopifyConnector(
    { shopDomain: 'acme.myshopify.com' },
    { accessToken: 'shpat_test' as unknown as { $secret: string } },
  );
}

type ProductsSample = z.infer<typeof ShopifyConnector.schemas.products>;
type CustomersSample = z.infer<typeof ShopifyConnector.schemas.customers>;
type OrdersSample = z.infer<typeof ShopifyConnector.schemas.orders>;

describe('ShopifyConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('products: sync upholds universal invariants for any valid API payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: ProductsSample,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const unique = new Set(sample.map((p) => p.id)).size;
      const written =
        entityStoreFor(storage, CONNECTOR_ID).get('shopify_product')?.size ?? 0;
      if (written !== unique) {
        violations.push({
          invariant: 'one shopify_product entity per unique product id',
          location: 'products phase',
          detail: `expected ${unique} entities, got ${written}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest({
      connectorClass: ShopifyConnector,
      resource: 'products',
      connectorId: CONNECTOR_ID,
      runs: 100,
      extraInvariants: [extra, docShapeExtra],
      run: async (sample, storage) => {
        installGraphqlMock((op) => {
          if (op === 'Products') {
            return {
              products: {
                nodes: sample,
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            };
          }
          return {
            products: emptyConn(),
            customers: emptyConn(),
            orders: emptyConn(),
          };
        });
        await makeConnector().sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('customers: sync upholds universal invariants for any valid API payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: CustomersSample,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const unique = new Set(sample.map((c) => c.id)).size;
      const written =
        entityStoreFor(storage, CONNECTOR_ID).get('shopify_customer')?.size ??
        0;
      if (written !== unique) {
        violations.push({
          invariant: 'one shopify_customer entity per unique customer id',
          location: 'customers phase',
          detail: `expected ${unique} entities, got ${written}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest({
      connectorClass: ShopifyConnector,
      resource: 'customers',
      connectorId: CONNECTOR_ID,
      runs: 100,
      extraInvariants: [extra, docShapeExtra],
      run: async (sample, storage) => {
        installGraphqlMock((op) => {
          if (op === 'Customers') {
            return {
              customers: {
                nodes: sample,
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            };
          }
          return {
            products: emptyConn(),
            customers: emptyConn(),
            orders: emptyConn(),
          };
        });
        await makeConnector().sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('orders: sync upholds universal invariants for any valid API payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: OrdersSample,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const unique = new Set(sample.map((o) => o.id)).size;
      const written =
        entityStoreFor(storage, CONNECTOR_ID).get('shopify_order')?.size ?? 0;
      if (written !== unique) {
        violations.push({
          invariant: 'one shopify_order entity per unique order id',
          location: 'orders phase',
          detail: `expected ${unique} entities, got ${written}`,
        });
      }

      const expectedRefunds = sample.reduce(
        (sum, order) => sum + order.refunds.length,
        0,
      );
      const refundEvents = eventStoreFor(storage, CONNECTOR_ID).filter(
        (e) => e.name === 'shopify_refund',
      ).length;
      if (refundEvents !== expectedRefunds) {
        violations.push({
          invariant: 'one shopify_refund event per refund in sampled orders',
          location: 'orders phase',
          detail: `expected ${expectedRefunds} events, got ${refundEvents}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest({
      connectorClass: ShopifyConnector,
      resource: 'orders',
      connectorId: CONNECTOR_ID,
      runs: 100,
      extraInvariants: [extra, docShapeExtra],
      run: async (sample, storage) => {
        installGraphqlMock((op) => {
          if (op === 'Orders') {
            return {
              orders: {
                nodes: sample,
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            };
          }
          return {
            products: emptyConn(),
            customers: emptyConn(),
            orders: emptyConn(),
          };
        });
        await makeConnector().sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });
});
