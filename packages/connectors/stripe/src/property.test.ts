import {
  type InvariantViolation,
  entityStoreFor,
  installFetchMock,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import type { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';
import { z } from 'zod';

import { StripeConnector } from './stripe';

const CONNECTOR_ID = 'stripe';

type CustomersSample = z.infer<typeof StripeConnector.schemas.customers>;
type ProductsSample = z.infer<typeof StripeConnector.schemas.products>;

describe('StripeConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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
        entityStoreFor(storage, CONNECTOR_ID).get('stripe_customer')?.size ?? 0;
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
      connectorClass: StripeConnector,
      resource: 'customers',
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
      sample: ProductsSample,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const unique = new Set(sample.map((p) => p.id)).size;
      const written =
        entityStoreFor(storage, CONNECTOR_ID).get('stripe_product')?.size ?? 0;
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
      connectorClass: StripeConnector,
      resource: 'products',
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
