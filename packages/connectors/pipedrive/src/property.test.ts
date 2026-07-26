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

import { PipedriveConnector } from './pipedrive';

const CONNECTOR_ID = 'pipedrive';

const docShapeExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    PipedriveConnector.resources,
    storage,
    connectorId,
  );

const TOKEN = 'PIPEDRIVE_TOKEN' as unknown as { $secret: string };

type DealsSample = z.infer<typeof PipedriveConnector.schemas.deals>;
type PipelinesSample = z.infer<typeof PipedriveConnector.schemas.pipelines>;
type ActivitiesSample = z.infer<typeof PipedriveConnector.schemas.activities>;

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
    const records = sample as Array<{ id: number }>;
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

describe('PipedriveConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('deals: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<DealsSample>({
      connectorClass: PipedriveConnector,
      resource: 'deals',
      connectorId: CONNECTOR_ID,
      runs: 100,
      extraInvariants: [
        uniqueEntityInvariant('pipedrive_deal', 'deals'),
        docShapeExtra,
      ],
      run: async (sample, storage) => {
        installFetchMock(() => ({ data: sample }));
        const c = new PipedriveConnector(
          { companyDomain: 'acme', resources: ['deals'] },
          { apiToken: TOKEN },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('pipelines: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<PipelinesSample>({
      connectorClass: PipedriveConnector,
      resource: 'pipelines',
      connectorId: CONNECTOR_ID,
      runs: 100,
      extraInvariants: [
        uniqueEntityInvariant('pipedrive_pipeline', 'pipelines'),
        docShapeExtra,
      ],
      run: async (sample, storage) => {
        installFetchMock(() => ({ data: sample }));
        const c = new PipedriveConnector(
          { companyDomain: 'acme', resources: ['pipelines'] },
          { apiToken: TOKEN },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('activities: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<ActivitiesSample>({
      connectorClass: PipedriveConnector,
      resource: 'activities',
      connectorId: CONNECTOR_ID,
      runs: 100,
      extraInvariants: [
        uniqueEntityInvariant('pipedrive_activity', 'activities'),
        docShapeExtra,
      ],
      run: async (sample, storage) => {
        installFetchMock(() => ({ data: sample }));
        const c = new PipedriveConnector(
          { companyDomain: 'acme', resources: ['activities'] },
          { apiToken: TOKEN },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('full sync across all resources matches the documented resource shapes', async () => {
    installFetchMock((url) => {
      if (url.includes('/deals/77/flow')) {
        return {
          data: [
            {
              object: 'dealChange',
              data: {
                item_id: 77,
                field_key: 'stage_id',
                old_value: 1,
                new_value: 2,
                user_id: 3,
                log_time: '2024-02-01 12:00:00',
              },
            },
          ],
          additional_data: { pagination: { more_items_in_collection: false } },
        };
      }
      if (url.includes('/deals')) {
        return {
          data: [
            {
              id: 77,
              title: 'Acme',
              status: 'won',
              value: 1000,
              currency: 'USD',
              stage_id: 2,
              pipeline_id: 1,
              user_id: 3,
              add_time: '2024-01-01 00:00:00',
              update_time: '2024-02-01 12:00:00',
            },
          ],
          additional_data: { pagination: { more_items_in_collection: false } },
        };
      }
      if (url.includes('/pipelines')) {
        return {
          data: [
            {
              id: 1,
              name: 'Sales',
              active: true,
              update_time: '2024-01-01 00:00:00',
            },
          ],
        };
      }
      if (url.includes('/activities')) {
        return {
          data: [
            {
              id: 9,
              type: 'call',
              subject: 'Follow up',
              done: false,
              deal_id: 77,
              user_id: 3,
              add_time: '2024-01-05 00:00:00',
              update_time: '2024-01-06 00:00:00',
            },
          ],
          additional_data: { pagination: { more_items_in_collection: false } },
        };
      }
      return { data: [] };
    });

    const storage = new InMemoryStorage();
    const c = new PipedriveConnector(
      {
        companyDomain: 'acme',
        resources: ['deals', 'deal_events', 'pipelines', 'activities'],
      },
      { apiToken: TOKEN },
    );
    await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));

    assertConnectorResourceShapes(
      PipedriveConnector.resources,
      storage,
      CONNECTOR_ID,
    );
  });
});
