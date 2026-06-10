import {
  type InvariantViolation,
  assertConnectorResourceShapes,
  connectorResourceShapeViolations,
  installFetchMock,
  metricStoreFor,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';
import { z } from 'zod';

import { AppsflyerConnector } from './appsflyer';

const CONNECTOR_ID = 'appsflyer';
const TOKEN = 'APPSFLYER_TOKEN' as unknown as { $secret: string };

const docShapeExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    AppsflyerConnector.resources,
    storage,
    connectorId,
  );

type InstallMetricsSample = z.infer<
  typeof AppsflyerConnector.schemas.install_metrics
>;
type RetentionMetricsSample = z.infer<
  typeof AppsflyerConnector.schemas.retention_metrics
>;

function makeConnector(resources?: string[]) {
  return new AppsflyerConnector(
    {
      appId: 'id1234567890',
      resources: resources as never,
    },
    { apiToken: TOKEN },
  );
}

function installSampleCountInvariant(
  storage: InMemoryStorage,
  connectorId: string,
  sample: InstallMetricsSample,
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const rows = sample.data;
  const samples = metricStoreFor(storage, connectorId).filter(
    (m) => m.name === 'appsflyer_install_metrics',
  );
  if (samples.length !== rows.length) {
    violations.push({
      invariant: 'one appsflyer_install_metrics sample per row',
      location: 'install_metrics phase',
      detail: `expected ${rows.length} metrics, got ${samples.length}`,
    });
  }
  return violations;
}

function retentionSampleCountInvariant(
  storage: InMemoryStorage,
  connectorId: string,
  sample: RetentionMetricsSample,
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const rows = sample.data;
  const samples = metricStoreFor(storage, connectorId).filter(
    (m) => m.name === 'appsflyer_retention_metrics',
  );
  const expected = rows.length * 3;
  if (samples.length !== expected) {
    violations.push({
      invariant:
        'three appsflyer_retention_metrics samples (day 1/7/30) per cohort row',
      location: 'retention_metrics phase',
      detail: `expected ${expected} metrics, got ${samples.length}`,
    });
  }
  return violations;
}

describe('AppsflyerConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('install_metrics: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<InstallMetricsSample>({
      connectorClass: AppsflyerConnector,
      resource: 'install_metrics',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [installSampleCountInvariant, docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock(() => sample);
        await makeConnector(['install_metrics']).sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('retention_metrics: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<RetentionMetricsSample>({
      connectorClass: AppsflyerConnector,
      resource: 'retention_metrics',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [retentionSampleCountInvariant, docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock(() => sample);
        await makeConnector(['retention_metrics']).sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('full sync across all resources matches documented resource shapes', async () => {
    installFetchMock((url) => {
      if (url.includes('groupings=cohort_date')) {
        return {
          data: [
            {
              cohort_date: '2025-01-15',
              af_media_source: 'organic',
              retained_users_day_1: 1000,
              retained_users_day_7: 500,
              retained_users_day_30: 200,
            },
          ],
        };
      }
      if (url.includes('groupings=af_date')) {
        return {
          data: [
            {
              af_date: '2025-01-15',
              af_media_source: 'facebook_ads',
              af_campaign: 'summer',
              installs: 120,
              cost: 45,
              revenue: 250,
              conversions: 18,
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
      AppsflyerConnector.resources,
      storage,
      CONNECTOR_ID,
    );
  });
});
