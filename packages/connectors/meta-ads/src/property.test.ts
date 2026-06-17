import {
  type InvariantViolation,
  assertConnectorResourceShapes,
  connectorMetricConformanceViolations,
  connectorResourceShapeViolations,
  entityStoreFor,
  installFetchMock,
  metricStoreFor,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';
import { z } from 'zod';

import { MetaAdsConnector } from './meta-ads';

const CONNECTOR_ID = 'meta-ads';
const TOKEN = 'META_TOKEN' as unknown as { $secret: string };

const docShapeExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] => [
  ...connectorResourceShapeViolations(
    MetaAdsConnector.resources,
    storage,
    connectorId,
  ),
  ...connectorMetricConformanceViolations(
    MetaAdsConnector.resources,
    storage,
    connectorId,
  ),
];

type CampaignsSample = z.infer<typeof MetaAdsConnector.schemas.campaigns>;
type CampaignInsightsSample = z.infer<
  typeof MetaAdsConnector.schemas.campaign_insights
>;
type AdsetInsightsSample = z.infer<
  typeof MetaAdsConnector.schemas.adset_insights
>;
type AdInsightsSample = z.infer<typeof MetaAdsConnector.schemas.ad_insights>;

function makeConnector(resources?: string[]) {
  return new MetaAdsConnector(
    {
      adAccountId: 'act_1234567890',
      resources: resources as never,
    },
    { accessToken: TOKEN },
  );
}

function uniqueCampaignInvariant(
  storage: InMemoryStorage,
  _connectorId: string,
  sample: CampaignsSample,
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const uniqueIds = new Set(sample.map((r) => r.id)).size;
  const written =
    entityStoreFor(storage, CONNECTOR_ID).get('meta_campaign')?.size ?? 0;
  if (written !== uniqueIds) {
    violations.push({
      invariant: 'one meta_campaign entity per unique id',
      location: 'campaigns phase',
      detail: `expected ${uniqueIds} entities, got ${written}`,
    });
  }
  return violations;
}

function insightCountInvariant(
  metricName: string,
  phase: string,
): (
  storage: InMemoryStorage,
  connectorId: string,
  sample: unknown[],
) => InvariantViolation[] {
  return (storage, connectorId, sample) => {
    const violations: InvariantViolation[] = [];
    const rows = sample as Array<unknown>;
    const samples = metricStoreFor(storage, connectorId).filter(
      (m) => m.name === metricName,
    );
    if (samples.length !== rows.length) {
      violations.push({
        invariant: `one ${metricName} metric per row`,
        location: `${phase} phase`,
        detail: `expected ${rows.length} metrics, got ${samples.length}`,
      });
    }
    return violations;
  };
}

describe('MetaAdsConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('campaigns: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<CampaignsSample>({
      connectorClass: MetaAdsConnector,
      resource: 'campaigns',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [uniqueCampaignInvariant, docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock(() => ({ data: sample }));
        await makeConnector(['campaigns']).sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('campaign_insights: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<CampaignInsightsSample>({
      connectorClass: MetaAdsConnector,
      resource: 'campaign_insights',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [
        insightCountInvariant('meta_campaign_insights', 'campaign_insights'),
        docShapeExtra,
      ],
      run: async (sample, storage) => {
        installFetchMock(() => ({ data: sample }));
        await makeConnector(['campaign_insights']).sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('adset_insights: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<AdsetInsightsSample>({
      connectorClass: MetaAdsConnector,
      resource: 'adset_insights',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [
        insightCountInvariant('meta_adset_insights', 'adset_insights'),
        docShapeExtra,
      ],
      run: async (sample, storage) => {
        installFetchMock(() => ({ data: sample }));
        await makeConnector(['adset_insights']).sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('ad_insights: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<AdInsightsSample>({
      connectorClass: MetaAdsConnector,
      resource: 'ad_insights',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [
        insightCountInvariant('meta_ad_insights', 'ad_insights'),
        docShapeExtra,
      ],
      run: async (sample, storage) => {
        installFetchMock(() => ({ data: sample }));
        await makeConnector(['ad_insights']).sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('full sync across all resources matches documented resource shapes', async () => {
    installFetchMock((url) => {
      if (url.includes('/insights') && url.includes('level=ad&')) {
        return {
          data: [
            {
              date_start: '2025-01-15',
              campaign_id: 'c1',
              campaign_name: 'My Campaign',
              adset_id: 'as1',
              adset_name: 'My Adset',
              ad_id: 'ad1',
              ad_name: 'My Ad',
              impressions: '1000',
              clicks: '50',
              spend: '10.00',
              reach: '900',
              actions: [{ action_type: 'purchase', value: '3' }],
              action_values: [{ action_type: 'purchase', value: '90' }],
            },
          ],
        };
      }
      if (url.includes('/insights') && url.includes('level=adset&')) {
        return {
          data: [
            {
              date_start: '2025-01-15',
              campaign_id: 'c1',
              campaign_name: 'My Campaign',
              adset_id: 'as1',
              adset_name: 'My Adset',
              impressions: '2000',
              clicks: '100',
              spend: '20.00',
              reach: '1800',
              actions: [],
              action_values: [],
            },
          ],
        };
      }
      if (url.includes('/insights') && url.includes('level=campaign&')) {
        return {
          data: [
            {
              date_start: '2025-01-15',
              campaign_id: 'c1',
              campaign_name: 'My Campaign',
              impressions: '5000',
              clicks: '200',
              spend: '50.00',
              reach: '4500',
              actions: [{ action_type: 'purchase', value: '10' }],
              action_values: [{ action_type: 'purchase', value: '300' }],
            },
          ],
        };
      }
      if (url.includes('/campaigns')) {
        return {
          data: [
            {
              id: 'c1',
              name: 'My Campaign',
              objective: 'OUTCOME_SALES',
              status: 'ACTIVE',
              effective_status: 'ACTIVE',
              daily_budget: '5000',
              created_time: '2025-01-01T00:00:00+0000',
              updated_time: '2025-01-15T12:00:00+0000',
            },
          ],
        };
      }
      return { data: [] };
    });

    const storage = new InMemoryStorage();
    await makeConnector().sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    assertConnectorResourceShapes(
      MetaAdsConnector.resources,
      storage,
      CONNECTOR_ID,
    );
  });
});
