import {
  type InvariantViolation,
  assertConnectorResourceShapes,
  connectorResourceShapeViolations,
  entityStoreFor,
  eventStoreFor,
  installFetchMockAdvanced,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';
import { z } from 'zod';

import { BillConnector } from './bill';

const CONNECTOR_ID = 'bill';
const DEV_KEY = 'BILL_DEV_KEY' as unknown as { $secret: string };
const PASSWORD = 'BILL_PASSWORD' as unknown as { $secret: string };

type VendorsSample = z.infer<typeof BillConnector.schemas.vendors>;
type BillsSample = z.infer<typeof BillConnector.schemas.bills>;
type PaymentsSample = z.infer<typeof BillConnector.schemas.payments>;

const shapeViolationsExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    BillConnector.resources,
    storage,
    connectorId,
  );

function makeConnector(resources?: string[]): BillConnector {
  return new BillConnector(
    { orgId: '00801ABCDEFGHIJKLMNO', resources: resources as never },
    { devKey: DEV_KEY, username: 'api-user@example.com', password: PASSWORD },
  );
}

function mockList(sample: unknown) {
  installFetchMockAdvanced((u: string) => {
    if (u.includes('/login')) {
      return { body: { sessionId: 'session-1' } };
    }
    if (new URL(u).searchParams.get('page')) {
      return { body: { results: [], nextPage: null } };
    }
    return { body: sample };
  });
}

function uniqueVendorEntityInvariant(
  storage: InMemoryStorage,
  _connectorId: string,
  sample: VendorsSample,
): InvariantViolation[] {
  const unique = new Set(sample.results.map((v) => v.id)).size;
  const written =
    entityStoreFor(storage, CONNECTOR_ID).get('bill_vendor')?.size ?? 0;
  if (written !== unique) {
    return [
      {
        invariant: 'one bill_vendor entity per unique vendor id',
        location: 'vendors phase',
        detail: `expected ${unique} entities, got ${written}`,
      },
    ];
  }
  return [];
}

function uniqueBillEntityInvariant(
  storage: InMemoryStorage,
  _connectorId: string,
  sample: BillsSample,
): InvariantViolation[] {
  const unique = new Set(sample.results.map((b) => b.id)).size;
  const written =
    entityStoreFor(storage, CONNECTOR_ID).get('bill_bill')?.size ?? 0;
  if (written !== unique) {
    return [
      {
        invariant: 'one bill_bill entity per unique bill id',
        location: 'bills phase',
        detail: `expected ${unique} entities, got ${written}`,
      },
    ];
  }
  return [];
}

function paymentEventCountInvariant(
  storage: InMemoryStorage,
  _connectorId: string,
  sample: PaymentsSample,
): InvariantViolation[] {
  const expected = sample.results.filter((p) => {
    const process = p.processDate ? Date.parse(p.processDate) : NaN;
    const created = p.createdTime ? Date.parse(p.createdTime) : NaN;
    return Number.isFinite(process) || Number.isFinite(created);
  }).length;
  const events = eventStoreFor<{ name: string }>(storage, CONNECTOR_ID).filter(
    (e) => e.name === 'bill_payment',
  );
  if (events.length !== expected) {
    return [
      {
        invariant:
          'one bill_payment event per payment with a resolvable timestamp',
        location: 'payments phase',
        detail: `expected ${expected} events, got ${events.length}`,
      },
    ];
  }
  return [];
}

describe('BillConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('vendors: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<VendorsSample>({
      connectorClass: BillConnector,
      resource: 'vendors',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [uniqueVendorEntityInvariant, shapeViolationsExtra],
      run: async (sample, storage) => {
        mockList(sample);
        await makeConnector(['vendors']).sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('bills: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<BillsSample>({
      connectorClass: BillConnector,
      resource: 'bills',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [uniqueBillEntityInvariant, shapeViolationsExtra],
      run: async (sample, storage) => {
        mockList(sample);
        await makeConnector(['bills']).sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('payments: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<PaymentsSample>({
      connectorClass: BillConnector,
      resource: 'payments',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [paymentEventCountInvariant, shapeViolationsExtra],
      run: async (sample, storage) => {
        mockList(sample);
        await makeConnector(['payments']).sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('full sync across all resources matches documented resource shapes', async () => {
    installFetchMockAdvanced((u: string) => {
      if (u.includes('/login')) {
        return { body: { sessionId: 'session-1' } };
      }
      if (new URL(u).searchParams.get('page')) {
        return { body: { results: [], nextPage: null } };
      }
      if (u.includes('/vendors')) {
        return {
          body: {
            results: [
              {
                id: '00901VENDOR',
                name: 'Acme Supplies',
                email: 'ap@acme.example',
                accountNumber: 'ACME-1',
                phone: '+1-555-0100',
                archived: false,
                billCurrency: 'USD',
                createdTime: '2026-01-01T00:00:00.000+00:00',
                updatedTime: '2026-01-02T00:00:00.000+00:00',
              },
            ],
            nextPage: null,
          },
        };
      }
      if (u.includes('/bills')) {
        return {
          body: {
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
                updatedTime: '2026-01-01T00:00:00.000+00:00',
              },
            ],
            nextPage: null,
          },
        };
      }
      if (u.includes('/payments')) {
        return {
          body: {
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
        };
      }
      return { body: { results: [], nextPage: null } };
    });

    const storage = new InMemoryStorage();
    await makeConnector().sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    assertConnectorResourceShapes(
      BillConnector.resources,
      storage,
      CONNECTOR_ID,
    );
  });
});
