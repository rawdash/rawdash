import {
  type InvariantViolation,
  assertConnectorResourceShapes,
  entityStoreFor,
  installFetchMock,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';
import { z } from 'zod';

import { KlaviyoConnector } from './klaviyo';

const CONNECTOR_ID = 'klaviyo';
const KEY = 'KLAVIYO_KEY' as unknown as { $secret: string };

type ListsSample = z.infer<typeof KlaviyoConnector.schemas.lists>;
type SegmentsSample = z.infer<typeof KlaviyoConnector.schemas.segments>;
type CampaignsSample = z.infer<typeof KlaviyoConnector.schemas.campaigns>;
type FlowsSample = z.infer<typeof KlaviyoConnector.schemas.flows>;

function uniqueEntityInvariant(
  entityType: string,
  phase: string,
): (
  storage: InMemoryStorage,
  connectorId: string,
  sample: { data: Array<{ id: string }> },
) => InvariantViolation[] {
  return (storage, _connectorId, sample) => {
    const violations: InvariantViolation[] = [];
    const ids = sample.data.map((r) => r.id);
    const unique = new Set(ids).size;
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

const baseSettings = {
  apiRevision: '2024-10-15',
  channel: 'email' as const,
};

describe('KlaviyoConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<ListsSample>({
      connectorClass: KlaviyoConnector,
      resource: 'lists',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [uniqueEntityInvariant('klaviyo_list', 'lists')],
      run: async (sample, storage) => {
        installFetchMock(() => sample);
        const c = new KlaviyoConnector(
          { ...baseSettings, resources: ['lists'] },
          { apiKey: KEY },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('segments: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<SegmentsSample>({
      connectorClass: KlaviyoConnector,
      resource: 'segments',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [uniqueEntityInvariant('klaviyo_segment', 'segments')],
      run: async (sample, storage) => {
        installFetchMock(() => sample);
        const c = new KlaviyoConnector(
          { ...baseSettings, resources: ['segments'] },
          { apiKey: KEY },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('campaigns: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<CampaignsSample>({
      connectorClass: KlaviyoConnector,
      resource: 'campaigns',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [uniqueEntityInvariant('klaviyo_campaign', 'campaigns')],
      run: async (sample, storage) => {
        installFetchMock(() => sample);
        const c = new KlaviyoConnector(
          { ...baseSettings, resources: ['campaigns'] },
          { apiKey: KEY },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('flows: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<FlowsSample>({
      connectorClass: KlaviyoConnector,
      resource: 'flows',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [uniqueEntityInvariant('klaviyo_flow', 'flows')],
      run: async (sample, storage) => {
        installFetchMock(() => sample);
        const c = new KlaviyoConnector(
          { ...baseSettings, resources: ['flows'] },
          { apiKey: KEY },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('full sync across all resources matches the connector doc shapes', async () => {
    installFetchMock((url) => {
      if (url.includes('/api/lists')) {
        return {
          data: [
            {
              type: 'list',
              id: 'list_1',
              attributes: {
                name: 'VIP',
                opt_in_process: 'single_opt_in',
                created: '2024-04-01T00:00:00.000Z',
                updated: '2024-05-01T00:00:00.000Z',
              },
            },
          ],
          links: {},
        };
      }
      if (url.includes('/api/segments')) {
        return {
          data: [
            {
              type: 'segment',
              id: 'seg_1',
              attributes: {
                name: 'Engaged 30d',
                is_active: true,
                is_starred: false,
                is_processing: false,
                created: '2024-04-02T00:00:00.000Z',
                updated: '2024-05-02T00:00:00.000Z',
              },
            },
          ],
          links: {},
        };
      }
      if (url.includes('/api/campaigns')) {
        return {
          data: [
            {
              type: 'campaign',
              id: 'cmp_1',
              attributes: {
                name: 'Black Friday',
                status: 'Sent',
                archived: false,
                channel: 'email',
                send_time: '2024-11-29T10:00:00.000Z',
                send_strategy: { method: 'static' },
                created_at: '2024-10-01T00:00:00.000Z',
                updated_at: '2024-11-29T10:30:00.000Z',
              },
            },
          ],
          links: {},
        };
      }
      if (url.includes('/api/flows')) {
        return {
          data: [
            {
              type: 'flow',
              id: 'flow_1',
              attributes: {
                name: 'Welcome',
                status: 'live',
                archived: false,
                trigger_type: 'list',
                created: '2024-03-01T00:00:00.000Z',
                updated: '2024-04-15T00:00:00.000Z',
              },
            },
          ],
          links: {},
        };
      }
      return { data: [], links: {} };
    });

    const storage = new InMemoryStorage();
    const connector = new KlaviyoConnector(
      {
        ...baseSettings,
        resources: ['lists', 'segments', 'campaigns', 'flows'],
      },
      { apiKey: KEY },
    );
    await connector.sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    assertConnectorResourceShapes(
      KlaviyoConnector.resources,
      storage,
      CONNECTOR_ID,
    );
  });
});
