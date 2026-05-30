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

import { HubSpotConnector } from './hubspot';

const CONNECTOR_ID = 'hubspot';

const docShapeExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    HubSpotConnector.resources,
    storage,
    connectorId,
  );
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
      extraInvariants: [
        uniqueEntityInvariant('hubspot_contact', 'contacts'),
        docShapeExtra,
      ],
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
      extraInvariants: [
        uniqueEntityInvariant('hubspot_company', 'companies'),
        docShapeExtra,
      ],
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
      extraInvariants: [
        uniqueEntityInvariant('hubspot_deal', 'deals'),
        docShapeExtra,
      ],
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

  it('full sync across all resources matches the documented resource shapes', async () => {
    const campaignDetail = {
      id: 314,
      name: 'Spring Launch',
      subject: 'Big news',
      fromName: 'Marketing',
      type: 'BATCH_EMAIL',
      lastProcessingFinishedAt: 1700000000000,
      numIncluded: 1000,
      counters: {
        sent: 1000,
        delivered: 950,
        open: 400,
        click: 120,
        bounce: 50,
        unsubscribed: 5,
      },
    };
    installFetchMock((url) => {
      if (url.includes('/contacts/search')) {
        return {
          total: 1,
          results: [
            {
              id: '101',
              properties: {
                email: 'alice@example.com',
                lifecyclestage: 'lead',
                createdate: '1700000000000',
                lastmodifieddate: '1700000500000',
              },
              createdAt: '2023-11-14T22:13:20.000Z',
              updatedAt: '2023-11-14T22:21:40.000Z',
            },
          ],
        };
      }
      if (url.includes('/companies/search')) {
        return {
          total: 1,
          results: [
            {
              id: '201',
              properties: {
                name: 'Acme',
                domain: 'acme.test',
                createdate: '1700000000000',
              },
              createdAt: '2023-11-14T22:13:20.000Z',
              updatedAt: '2023-11-14T22:21:40.000Z',
            },
          ],
        };
      }
      if (url.includes('/deals/search')) {
        return {
          total: 1,
          results: [
            {
              id: 'deal_1',
              properties: {
                dealname: 'Acme',
                dealstage: 'closedwon',
                pipeline: 'default',
                amount: '4200.50',
                createdate: '1699000000000',
              },
              createdAt: '2023-11-03T00:00:00.000Z',
              updatedAt: '2023-11-14T22:21:40.000Z',
            },
          ],
        };
      }
      if (/\/crm\/v3\/objects\/deals\?/.test(url)) {
        return {
          results: [
            {
              id: 'deal_9',
              propertiesWithHistory: {
                dealstage: [
                  {
                    value: 'closedwon',
                    timestamp: '2024-02-01T00:00:00.000Z',
                    sourceType: 'CRM_UI',
                  },
                  {
                    value: 'qualifiedtobuy',
                    timestamp: '2024-01-01T00:00:00.000Z',
                    sourceType: 'CRM_UI',
                  },
                ],
              },
            },
          ],
        };
      }
      if (/\/email\/public\/v1\/campaigns\/314/.test(url)) {
        return campaignDetail;
      }
      if (url.includes('/email/public/v1/campaigns')) {
        return { campaigns: [{ id: 314 }], hasMore: false };
      }
      if (url.includes('/search')) {
        return { total: 0, results: [] };
      }
      return { results: [] };
    });

    const storage = new InMemoryStorage();
    const c = new HubSpotConnector(
      {
        resources: [
          'contacts',
          'companies',
          'deals',
          'deal_events',
          'email_campaigns',
          'email_stats',
        ],
      },
      { accessToken: TOKEN },
    );
    await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));

    assertConnectorResourceShapes(
      HubSpotConnector.resources,
      storage,
      CONNECTOR_ID,
    );
  });
});
