import {
  type InvariantViolation,
  connectorResourceShapeViolations,
  entityStoreFor,
  installFetchMock,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import type { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';
import { z } from 'zod';

import { DeelConnector } from './deel';

const CONNECTOR_ID = 'deel';
const TOKEN = 'DEEL_TOKEN' as unknown as { $secret: string };

type PersonSample = z.infer<typeof DeelConnector.schemas.people>;
type ContractSample = z.infer<typeof DeelConnector.schemas.contracts>;
type InvoiceSample = z.infer<typeof DeelConnector.schemas.invoices>;
type InvoiceEventSample = z.infer<typeof DeelConnector.schemas.invoice_events>;

function envelope(sample: unknown[]): unknown {
  return {
    data: sample,
    page: {
      offset: 0,
      total_rows: sample.length,
      items_per_page: sample.length,
    },
  };
}

const docShapeExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    DeelConnector.resources,
    storage,
    connectorId,
  );

function uniqueEntityInvariant(
  entityType: string,
  phase: string,
): (
  storage: InMemoryStorage,
  connectorId: string,
  sample: unknown[],
) => InvariantViolation[] {
  return (storage, _connectorId, sample) => {
    const violations: InvariantViolation[] = [];
    const records = sample as Array<{ id: string }>;
    const unique = new Set(records.map((r) => String(r.id))).size;
    const written =
      entityStoreFor(storage, CONNECTOR_ID).get(entityType)?.size ?? 0;
    if (written !== unique) {
      violations.push({
        invariant: `one ${entityType} entity per unique id`,
        location: `${phase} phase`,
        detail: `expected ${unique} entities, got ${written}`,
      });
    }
    return violations;
  };
}

describe('DeelConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('people: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<PersonSample>({
      connectorClass: DeelConnector,
      resource: 'people',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [
        uniqueEntityInvariant('deel_person', 'people'),
        docShapeExtra,
      ],
      run: async (sample, storage) => {
        installFetchMock(() => envelope(sample));
        const c = new DeelConnector(
          { resources: ['people'] },
          { apiToken: TOKEN },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('contracts: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<ContractSample>({
      connectorClass: DeelConnector,
      resource: 'contracts',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [
        uniqueEntityInvariant('deel_contract', 'contracts'),
        docShapeExtra,
      ],
      run: async (sample, storage) => {
        installFetchMock(() => envelope(sample));
        const c = new DeelConnector(
          { resources: ['contracts'] },
          { apiToken: TOKEN },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('invoices: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<InvoiceSample>({
      connectorClass: DeelConnector,
      resource: 'invoices',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [
        uniqueEntityInvariant('deel_invoice', 'invoices'),
        docShapeExtra,
      ],
      run: async (sample, storage) => {
        installFetchMock(() => envelope(sample));
        const c = new DeelConnector(
          { resources: ['invoices'] },
          { apiToken: TOKEN },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('invoice_events: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<InvoiceEventSample>({
      connectorClass: DeelConnector,
      resource: 'invoice_events',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock(() => envelope(sample));
        const c = new DeelConnector(
          { resources: ['invoice_events'] },
          { apiToken: TOKEN },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });
});
