import {
  type InvariantViolation,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import type { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';
import { z } from 'zod';

import { StripeConnector } from './stripe';

const CONNECTOR_ID = 'stripe';

function mockResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'application/json' }),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

function installFetchMock(
  routeBody: (url: string) => unknown,
): ReturnType<typeof vi.fn> {
  const spy = vi.fn().mockImplementation((url: string | URL) => {
    const u = typeof url === 'string' ? url : url.toString();
    return Promise.resolve(mockResponse(routeBody(u)));
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

function entityStoreFor(
  storage: InMemoryStorage,
): Map<string, Map<string, { type: string; id: string }>> {
  return (
    (
      storage as unknown as {
        entityStore: Map<
          string,
          Map<string, Map<string, { type: string; id: string }>>
        >;
      }
    ).entityStore.get(CONNECTOR_ID) ?? new Map()
  );
}

const idString = z.string().min(1);

const customersSchema = z.array(
  z.object({
    id: idString,
    email: z.string().nullable(),
    name: z.string().nullable(),
    created: z.number().int().nonnegative(),
    currency: z.string().nullable(),
    delinquent: z.boolean(),
    livemode: z.boolean(),
  }),
);

const productsSchema = z.array(
  z.object({
    id: idString,
    name: z.string(),
    active: z.boolean(),
    created: z.number().int().nonnegative(),
  }),
);

describe('StripeConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('customers: sync upholds universal invariants for any valid API payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: z.infer<typeof customersSchema>,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const unique = new Set(sample.map((c) => c.id)).size;
      const written = entityStoreFor(storage).get('stripe_customer')?.size ?? 0;
      if (written !== unique) {
        violations.push({
          invariant: 'one stripe_customer entity per unique customer id',
          location: 'customers phase',
          detail: `expected ${unique} entities, got ${written}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest({
      schema: customersSchema,
      connectorId: CONNECTOR_ID,
      runs: 100,
      extraInvariants: [extra],
      run: async (sample, storage) => {
        installFetchMock(() => ({ data: sample, has_more: false }));
        const connector = new StripeConnector(
          { resources: ['customers'] },
          { apiKey: 'sk_test_xxx' as unknown as { $secret: string } },
        );
        await connector.sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('products: sync upholds universal invariants for any valid API payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: z.infer<typeof productsSchema>,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const unique = new Set(sample.map((p) => p.id)).size;
      const written = entityStoreFor(storage).get('stripe_product')?.size ?? 0;
      if (written !== unique) {
        violations.push({
          invariant: 'one stripe_product entity per unique product id',
          location: 'products phase',
          detail: `expected ${unique} entities, got ${written}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest({
      schema: productsSchema,
      connectorId: CONNECTOR_ID,
      runs: 100,
      extraInvariants: [extra],
      run: async (sample, storage) => {
        installFetchMock(() => ({ data: sample, has_more: false }));
        const connector = new StripeConnector(
          { resources: ['products'] },
          { apiKey: 'sk_test_xxx' as unknown as { $secret: string } },
        );
        await connector.sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });
});
