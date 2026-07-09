import {
  type InvariantViolation,
  assertConnectorResourceShapes,
  connectorResourceShapeViolations,
  entityStoreFor,
  installFetchMock,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import type { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { ServiceNowConnector } from './servicenow';

const CONNECTOR_ID = 'servicenow';
const PASSWORD = 'SERVICENOW_PASSWORD' as unknown as { $secret: string };

type IncidentSample = z.infer<typeof ServiceNowConnector.schemas.incidents>;
type ChangeRequestSample = z.infer<
  typeof ServiceNowConnector.schemas.change_requests
>;
type ProblemSample = z.infer<typeof ServiceNowConnector.schemas.problems>;

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
    const records = sample as Array<{ sys_id: string }>;
    const unique = new Set(records.map((r) => r.sys_id)).size;
    const written =
      entityStoreFor(storage, CONNECTOR_ID).get(entityType)?.size ?? 0;
    if (written !== unique) {
      violations.push({
        invariant: `one ${entityType} entity per unique sys_id`,
        location: `${phase} phase`,
        detail: `expected ${unique} entities, got ${written}`,
      });
    }
    return violations;
  };
}

const baseSettings = {
  instanceUrl: 'acme.service-now.com',
};

const baseCreds = { username: 'rawdash.integration', password: PASSWORD };

describe('ServiceNowConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('incidents: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<IncidentSample>({
      connectorClass: ServiceNowConnector,
      resource: 'incidents',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [
        uniqueEntityInvariant('servicenow_incident', 'incidents'),
        (storage, connectorId) =>
          connectorResourceShapeViolations(
            ServiceNowConnector.resources,
            storage,
            connectorId,
          ),
      ],
      run: async (sample, storage) => {
        installFetchMock(() => ({ result: sample }));
        const c = new ServiceNowConnector(
          { ...baseSettings, resources: ['incidents'] },
          baseCreds,
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('change_requests: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<ChangeRequestSample>({
      connectorClass: ServiceNowConnector,
      resource: 'change_requests',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [
        uniqueEntityInvariant('servicenow_change_request', 'change_requests'),
        (storage, connectorId) =>
          connectorResourceShapeViolations(
            ServiceNowConnector.resources,
            storage,
            connectorId,
          ),
      ],
      run: async (sample, storage) => {
        installFetchMock(() => ({ result: sample }));
        const c = new ServiceNowConnector(
          { ...baseSettings, resources: ['change_requests'] },
          baseCreds,
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('problems: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<ProblemSample>({
      connectorClass: ServiceNowConnector,
      resource: 'problems',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [
        uniqueEntityInvariant('servicenow_problem', 'problems'),
        (storage, connectorId) =>
          connectorResourceShapeViolations(
            ServiceNowConnector.resources,
            storage,
            connectorId,
          ),
      ],
      run: async (sample, storage) => {
        installFetchMock(() => ({ result: sample }));
        const c = new ServiceNowConnector(
          { ...baseSettings, resources: ['problems'] },
          baseCreds,
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('full-sync resource shapes match the declared map (covers incident_events)', async () => {
    const { InMemoryStorage } = await import('@rawdash/core');
    const storage = new InMemoryStorage();
    installFetchMock((url) => {
      if (url.includes('/api/now/table/incident')) {
        return {
          result: [
            {
              sys_id: 'a1',
              number: 'INC0010001',
              short_description: 'printer down',
              state: '6',
              priority: '3',
              assignment_group: 'grp1',
              assigned_to: 'usr1',
              caller_id: 'usr2',
              active: 'false',
              opened_at: '2024-01-01 00:00:00',
              resolved_at: '2024-01-02 00:00:00',
              closed_at: '2024-01-03 00:00:00',
              sys_created_on: '2024-01-01 00:00:00',
              sys_updated_on: '2024-01-03 00:00:00',
            },
          ],
        };
      }
      return { result: [] };
    });
    const c = new ServiceNowConnector(baseSettings, baseCreds);
    await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
    expect(() =>
      assertConnectorResourceShapes(
        ServiceNowConnector.resources,
        storage,
        CONNECTOR_ID,
      ),
    ).not.toThrow();
  });
});
