import {
  type InvariantViolation,
  entityStoreFor,
  installFetchMock,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import type { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';
import { z } from 'zod';

import { HubSpotConnector } from './hubspot';

const CONNECTOR_ID = 'hubspot';
const TOKEN = 'HUBSPOT_TOKEN' as unknown as { $secret: string };

type ContactsSample = z.infer<typeof HubSpotConnector.schemas.contacts>;
type CompaniesSample = z.infer<typeof HubSpotConnector.schemas.companies>;
type DealsSample = z.infer<typeof HubSpotConnector.schemas.deals>;

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
    const unique = new Set(records.map((r) => r.id)).size;
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

describe('HubSpotConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('contacts: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<ContactsSample>({
      connectorClass: HubSpotConnector,
      resource: 'contacts',
      connectorId: CONNECTOR_ID,
      runs: 100,
      extraInvariants: [uniqueEntityInvariant('hubspot_contact', 'contacts')],
      run: async (sample, storage) => {
        installFetchMock(() => ({ results: sample }));
        const c = new HubSpotConnector(
          { resources: ['contacts'] },
          { accessToken: TOKEN },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('companies: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<CompaniesSample>({
      connectorClass: HubSpotConnector,
      resource: 'companies',
      connectorId: CONNECTOR_ID,
      runs: 100,
      extraInvariants: [uniqueEntityInvariant('hubspot_company', 'companies')],
      run: async (sample, storage) => {
        installFetchMock(() => ({ results: sample }));
        const c = new HubSpotConnector(
          { resources: ['companies'] },
          { accessToken: TOKEN },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('deals: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<DealsSample>({
      connectorClass: HubSpotConnector,
      resource: 'deals',
      connectorId: CONNECTOR_ID,
      runs: 100,
      extraInvariants: [uniqueEntityInvariant('hubspot_deal', 'deals')],
      run: async (sample, storage) => {
        installFetchMock(() => ({ results: sample }));
        const c = new HubSpotConnector(
          { resources: ['deals'] },
          { accessToken: TOKEN },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });
});
