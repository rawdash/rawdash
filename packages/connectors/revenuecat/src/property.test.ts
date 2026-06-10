import {
  type InvariantViolation,
  assertConnectorResourceShapes,
  connectorResourceShapeViolations,
  entityStoreFor,
  eventStoreFor,
  installFetchMock,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';
import { z } from 'zod';

import { RevenueCatConnector } from './revenuecat';

const CONNECTOR_ID = 'revenuecat';
const SECRET = 'sk_test_abc' as unknown as { $secret: string };
const BASE_SETTINGS = { projectId: 'proj_abc' };

const docShapeExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    RevenueCatConnector.resources,
    storage,
    connectorId,
  );

type ProductsSample = z.infer<typeof RevenueCatConnector.schemas.products>;
type EntitlementsSample = z.infer<
  typeof RevenueCatConnector.schemas.entitlements
>;
type CustomersSample = z.infer<typeof RevenueCatConnector.schemas.customers>;
type EventsSample = z.infer<typeof RevenueCatConnector.schemas.events>;

describe('RevenueCatConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('products: sync upholds universal invariants for any valid payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: ProductsSample,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const unique = new Set(sample.map((p) => p.id)).size;
      const written =
        entityStoreFor(storage, CONNECTOR_ID).get('revenuecat_product')?.size ??
        0;
      if (written !== unique) {
        violations.push({
          invariant: 'one revenuecat_product entity per unique product id',
          location: 'products phase',
          detail: `expected ${unique} entities, got ${written}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest<ProductsSample>({
      connectorClass: RevenueCatConnector,
      resource: 'products',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [extra, docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock(() => ({
          object: 'list',
          items: sample,
          next_page: null,
        }));
        const c = new RevenueCatConnector(
          { ...BASE_SETTINGS, resources: ['products'] },
          { apiKey: SECRET },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('entitlements: sync upholds universal invariants for any valid payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: EntitlementsSample,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const unique = new Set(sample.map((e) => e.id)).size;
      const written =
        entityStoreFor(storage, CONNECTOR_ID).get('revenuecat_entitlement')
          ?.size ?? 0;
      if (written !== unique) {
        violations.push({
          invariant: 'one revenuecat_entitlement entity per unique id',
          location: 'entitlements phase',
          detail: `expected ${unique} entities, got ${written}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest<EntitlementsSample>({
      connectorClass: RevenueCatConnector,
      resource: 'entitlements',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [extra, docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock(() => ({
          object: 'list',
          items: sample,
          next_page: null,
        }));
        const c = new RevenueCatConnector(
          { ...BASE_SETTINGS, resources: ['entitlements'] },
          { apiKey: SECRET },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('customers: sync upholds universal invariants for any valid payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: CustomersSample,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const uniqueCustomers = new Set(sample.map((c) => c.id)).size;
      const writtenCustomers =
        entityStoreFor(storage, CONNECTOR_ID).get('revenuecat_customer')
          ?.size ?? 0;
      if (writtenCustomers !== uniqueCustomers) {
        violations.push({
          invariant: 'one revenuecat_customer entity per unique customer id',
          location: 'customers phase',
          detail: `expected ${uniqueCustomers} entities, got ${writtenCustomers}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest<CustomersSample>({
      connectorClass: RevenueCatConnector,
      resource: 'customers',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [extra, docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock(() => ({
          object: 'list',
          items: sample,
          next_page: null,
        }));
        const c = new RevenueCatConnector(
          { ...BASE_SETTINGS, resources: ['customers'] },
          { apiKey: SECRET },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('events: sync upholds universal invariants for any valid payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: EventsSample,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const written = eventStoreFor(storage, CONNECTOR_ID).filter(
        (e) => e.name === 'revenuecat_event',
      ).length;
      if (written !== sample.length) {
        violations.push({
          invariant: 'one revenuecat_event per upstream event',
          location: 'events phase',
          detail: `expected ${sample.length} events, got ${written}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest<EventsSample>({
      connectorClass: RevenueCatConnector,
      resource: 'events',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [extra, docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock(() => ({
          object: 'list',
          items: sample,
          next_page: null,
        }));
        const c = new RevenueCatConnector(
          { ...BASE_SETTINGS, resources: ['events'] },
          { apiKey: SECRET },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('full sync writes match the documented resource shapes', async () => {
    const productsBody = {
      object: 'list',
      items: [
        {
          id: 'prod_1',
          store_identifier: 'com.example.pro',
          type: 'subscription',
          app_id: 'app_1',
          display_name: 'Pro',
          created_at: 1700000000,
        },
      ],
      next_page: null,
    };
    const entitlementsBody = {
      object: 'list',
      items: [
        {
          id: 'entl_1',
          lookup_key: 'pro',
          display_name: 'Pro',
          created_at: 1700000000,
        },
      ],
      next_page: null,
    };
    const customersBody = {
      object: 'list',
      items: [
        {
          id: 'cust_1',
          first_seen_at: 1700000000,
          last_seen_at: 1710000000,
          active_entitlements: { items: [{ entitlement_id: 'entl_1' }] },
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
        },
      ],
      next_page: null,
    };
    const eventsBody = {
      object: 'list',
      items: [
        {
          id: 'evt_1',
          type: 'INITIAL_PURCHASE',
          timestamp_ms: 1700000000000,
          app_user_id: 'cust_1',
          product_id: 'prod_1',
          store: 'app_store',
          environment: 'production',
          price_in_purchased_currency: 9.99,
          currency: 'USD',
        },
      ],
      next_page: null,
    };
    const metricsBody = {
      object: 'list',
      metrics: [{ id: 'mrr', value: 1234, unit: 'USD' }],
    };

    installFetchMock((url) => {
      if (url.includes('/products')) {
        return productsBody;
      }
      if (url.includes('/entitlements')) {
        return entitlementsBody;
      }
      if (url.includes('/customers')) {
        return customersBody;
      }
      if (url.includes('/events')) {
        return eventsBody;
      }
      if (url.includes('/metrics/overview')) {
        return metricsBody;
      }
      return { object: 'list', items: [], next_page: null };
    });

    const storage = new InMemoryStorage();
    const c = new RevenueCatConnector(BASE_SETTINGS, { apiKey: SECRET });
    await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));

    assertConnectorResourceShapes(
      RevenueCatConnector.resources,
      storage,
      CONNECTOR_ID,
    );
  });
});
