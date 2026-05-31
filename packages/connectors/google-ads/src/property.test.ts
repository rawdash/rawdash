import {
  type InvariantViolation,
  assertConnectorResourceShapes,
  connectorResourceShapeViolations,
  installFetchMock,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { GoogleAdsConnector } from './google-ads';

const CONNECTOR_ID = 'google-ads';

const docShapeExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    GoogleAdsConnector.resources,
    storage,
    connectorId,
  );

function makeConnector(
  resources: Array<
    'campaigns' | 'campaign_metrics' | 'ad_group_metrics' | 'keyword_metrics'
  >,
): GoogleAdsConnector {
  return new GoogleAdsConnector(
    { customerId: '1234567890', resources },
    {
      clientId: 'cid',
      clientSecret: 'cs' as unknown as { $secret: string },
      refreshToken: 'rt' as unknown as { $secret: string },
      developerToken: 'dt' as unknown as { $secret: string },
    },
  );
}

type CampaignsSample = z.infer<typeof GoogleAdsConnector.schemas.campaigns>;
type CampaignMetricsSample = z.infer<
  typeof GoogleAdsConnector.schemas.campaign_metrics
>;

describe('GoogleAdsConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('campaigns: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<CampaignsSample>({
      connectorClass: GoogleAdsConnector,
      resource: 'campaigns',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock((url) => {
          if (url.includes('oauth2.googleapis.com/token')) {
            return { access_token: 'tok', expires_in: 3600 };
          }
          return { results: sample };
        });
        await makeConnector(['campaigns']).sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('campaign_metrics: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<CampaignMetricsSample>({
      connectorClass: GoogleAdsConnector,
      resource: 'campaign_metrics',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock((url) => {
          if (url.includes('oauth2.googleapis.com/token')) {
            return { access_token: 'tok', expires_in: 3600 };
          }
          return { results: sample };
        });
        await makeConnector(['campaign_metrics']).sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('full sync across all resources matches the documented resource shapes', async () => {
    installFetchMock((url) => {
      if (url.includes('oauth2.googleapis.com/token')) {
        return { access_token: 'tok', expires_in: 3600 };
      }
      // Default: empty result. Specific phases are exercised by the property
      // tests above; the call here just verifies a full multi-phase sweep
      // doesn't write any undeclared resources.
      return { results: [] };
    });

    const storage = new InMemoryStorage();
    await new GoogleAdsConnector(
      { customerId: '1234567890' },
      {
        clientId: 'cid',
        clientSecret: 'cs' as unknown as { $secret: string },
        refreshToken: 'rt' as unknown as { $secret: string },
        developerToken: 'dt' as unknown as { $secret: string },
      },
    ).sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));

    assertConnectorResourceShapes(
      GoogleAdsConnector.resources,
      storage,
      CONNECTOR_ID,
    );
    // The all-empty sweep should not write any undeclared resources.
    expect(
      connectorResourceShapeViolations(
        GoogleAdsConnector.resources,
        storage,
        CONNECTOR_ID,
      ),
    ).toEqual([]);
  });
});
