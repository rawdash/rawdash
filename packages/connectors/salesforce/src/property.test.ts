import {
  type InvariantViolation,
  entityStoreFor,
  eventStoreFor,
  installFetchMockAdvanced,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import type { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';
import { z } from 'zod';

import { SalesforceConnector } from './salesforce';

const CONNECTOR_ID = 'salesforce';
const CLIENT_SECRET = 'SF_CLIENT_SECRET' as unknown as { $secret: string };
const REFRESH_TOKEN = 'SF_REFRESH_TOKEN' as unknown as { $secret: string };

type AccountsSample = z.infer<typeof SalesforceConnector.schemas.accounts>;
type LeadsSample = z.infer<typeof SalesforceConnector.schemas.leads>;
type OpportunitiesSample = z.infer<
  typeof SalesforceConnector.schemas.opportunities
>;
type OpportunityEventsSample = z.infer<
  typeof SalesforceConnector.schemas.opportunity_events
>;

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
    const records = sample as Array<{ Id: string }>;
    const unique = new Set(records.map((r) => r.Id)).size;
    const written =
      entityStoreFor(storage, CONNECTOR_ID).get(entityType)?.size ?? 0;
    if (written !== unique) {
      violations.push({
        invariant: `one ${entityType} entity per unique Id`,
        location: `${phase} phase`,
        detail: `expected ${unique} entities, got ${written}`,
      });
    }
    return violations;
  };
}

function eventCountInvariant(
  eventName: string,
  phase: string,
): (
  storage: InMemoryStorage,
  connectorId: string,
  sample: OpportunityEventsSample,
) => InvariantViolation[] {
  return (storage, _connectorId, sample) => {
    const violations: InvariantViolation[] = [];
    const validCount = sample.filter((r) =>
      Number.isFinite(Date.parse(r.CreatedDate)),
    ).length;
    const events = eventStoreFor<{ name: string }>(
      storage,
      CONNECTOR_ID,
    ).filter((e) => e.name === eventName);
    if (events.length !== validCount) {
      violations.push({
        invariant: `one ${eventName} event per OpportunityFieldHistory row with a parseable CreatedDate`,
        location: `${phase} phase`,
        detail: `expected ${validCount} events, got ${events.length}`,
      });
    }
    return violations;
  };
}

function installQueryFetchMock(records: unknown[]): void {
  installFetchMockAdvanced((u) => {
    if (u.includes('/services/oauth2/token')) {
      return { body: { access_token: 'tok' } };
    }
    return {
      body: { totalSize: records.length, done: true, records },
    };
  });
}

describe('SalesforceConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('accounts: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<AccountsSample>({
      connectorClass: SalesforceConnector,
      resource: 'accounts',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [
        uniqueEntityInvariant('salesforce_account', 'accounts'),
      ],
      run: async (sample, storage) => {
        installQueryFetchMock(sample);
        const c = new SalesforceConnector(
          {
            instanceUrl: 'https://mycompany.my.salesforce.com',
            resources: ['accounts'],
          },
          {
            clientId: '3MVG9',
            clientSecret: CLIENT_SECRET,
            refreshToken: REFRESH_TOKEN,
          },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('leads: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<LeadsSample>({
      connectorClass: SalesforceConnector,
      resource: 'leads',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [uniqueEntityInvariant('salesforce_lead', 'leads')],
      run: async (sample, storage) => {
        installQueryFetchMock(sample);
        const c = new SalesforceConnector(
          {
            instanceUrl: 'https://mycompany.my.salesforce.com',
            resources: ['leads'],
          },
          {
            clientId: '3MVG9',
            clientSecret: CLIENT_SECRET,
            refreshToken: REFRESH_TOKEN,
          },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('opportunities: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<OpportunitiesSample>({
      connectorClass: SalesforceConnector,
      resource: 'opportunities',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [
        uniqueEntityInvariant('salesforce_opportunity', 'opportunities'),
      ],
      run: async (sample, storage) => {
        installQueryFetchMock(sample);
        const c = new SalesforceConnector(
          {
            instanceUrl: 'https://mycompany.my.salesforce.com',
            resources: ['opportunities'],
          },
          {
            clientId: '3MVG9',
            clientSecret: CLIENT_SECRET,
            refreshToken: REFRESH_TOKEN,
          },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('opportunity_events: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<OpportunityEventsSample>({
      connectorClass: SalesforceConnector,
      resource: 'opportunity_events',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [
        eventCountInvariant(
          'salesforce_opportunity_stage_change',
          'opportunity_events',
        ),
      ],
      run: async (sample, storage) => {
        installQueryFetchMock(sample);
        const c = new SalesforceConnector(
          {
            instanceUrl: 'https://mycompany.my.salesforce.com',
            resources: ['opportunity_events'],
          },
          {
            clientId: '3MVG9',
            clientSecret: CLIENT_SECRET,
            refreshToken: REFRESH_TOKEN,
          },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });
});
