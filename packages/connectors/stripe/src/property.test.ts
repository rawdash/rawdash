import {
  type InvariantViolation,
  assertConnectorResourceShapes,
  connectorResourceShapeViolations,
  entityStoreFor,
  installFetchMock,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';
import { z } from 'zod';

import { StripeConnector } from './stripe';

const CONNECTOR_ID = 'stripe';

const docShapeExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    StripeConnector.resources,
    storage,
    connectorId,
  );

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
      extraInvariants: [extra, docShapeExtra],
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
      extraInvariants: [extra, docShapeExtra],
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

  it('full sync writes match the documented resource shapes', async () => {
    const dataByPath: Record<string, unknown[]> = {
      '/v1/customers': [
        {
          id: 'cus_1',
          email: 'a@example.com',
          name: 'A',
          created: 1700000000,
          currency: 'usd',
          delinquent: false,
          livemode: false,
        },
      ],
      '/v1/products': [
        { id: 'prod_1', name: 'Pro', active: true, created: 1700000000 },
      ],
      '/v1/prices': [
        {
          id: 'price_1',
          product: 'prod_1',
          unit_amount: 5000,
          currency: 'usd',
          recurring: { interval: 'month', interval_count: 1 },
          active: true,
          created: 1700000000,
        },
      ],
      '/v1/subscriptions': [
        {
          id: 'sub_1',
          customer: 'cus_1',
          status: 'active',
          items: {
            data: [
              {
                price: {
                  id: 'price_1',
                  product: 'prod_1',
                  unit_amount: 5000,
                  currency: 'usd',
                  recurring: { interval: 'month', interval_count: 1 },
                  active: true,
                  created: 1700000000,
                },
                quantity: 1,
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
        },
      ],
      '/v1/invoices': [
        {
          id: 'in_1',
          customer: 'cus_1',
          subscription: 'sub_1',
          status: 'paid',
          amount_due: 5000,
          amount_paid: 5000,
          currency: 'usd',
          created: 1700000000,
          due_date: null,
          hosted_invoice_url: null,
        },
      ],
      '/v1/charges': [
        {
          id: 'ch_1',
          customer: 'cus_1',
          amount: 5000,
          currency: 'usd',
          status: 'succeeded',
          failure_code: null,
          created: 1700000000,
          payment_intent: 'pi_1',
        },
      ],
      '/v1/payment_intents': [
        {
          id: 'pi_1',
          customer: 'cus_1',
          amount: 5000,
          currency: 'usd',
          status: 'succeeded',
          created: 1700000000,
        },
      ],
      '/v1/disputes': [
        {
          id: 'dp_1',
          charge: 'ch_1',
          amount: 5000,
          currency: 'usd',
          reason: 'fraudulent',
          status: 'won',
          created: 1700000000,
        },
      ],
      '/v1/refunds': [
        {
          id: 're_1',
          charge: 'ch_1',
          amount: 5000,
          currency: 'usd',
          reason: 'requested_by_customer',
          status: 'succeeded',
          created: 1700000000,
        },
      ],
    };

    installFetchMock((url) => {
      const match = Object.keys(dataByPath).find((path) => url.includes(path));
      return {
        object: 'list',
        data: match ? dataByPath[match] : [],
        has_more: false,
        url: match ?? '',
      };
    });

    const storage = new InMemoryStorage();
    const connector = new StripeConnector(
      {},
      { apiKey: 'sk_test_xxx' as unknown as { $secret: string } },
    );
    await connector.sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    assertConnectorResourceShapes(
      StripeConnector.resources,
      storage,
      CONNECTOR_ID,
    );
  });
});
