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

import { PostHogConnector } from './posthog';

const CONNECTOR_ID = 'posthog';
const API_KEY = 'POSTHOG_API_KEY' as unknown as { $secret: string };
const HOST = 'https://us.posthog.com';

const docShapeExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] => [
  ...connectorResourceShapeViolations(
    PostHogConnector.resources,
    storage,
    connectorId,
  ),
  ...connectorMetricConformanceViolations(
    PostHogConnector.resources,
    storage,
    connectorId,
  ),
];

type FeatureFlagsSample = z.infer<
  typeof PostHogConnector.schemas.feature_flags
>;
type HogQLSample = z.infer<typeof PostHogConnector.schemas.events_per_day>;
type TrendsSample = z.infer<typeof PostHogConnector.schemas.active_users>;

function uniqueFlagEntities(): (
  storage: InMemoryStorage,
  connectorId: string,
  sample: FeatureFlagsSample,
) => InvariantViolation[] {
  return (storage, connectorId, sample) => {
    const violations: InvariantViolation[] = [];
    const unique = new Set(sample.map((f) => String(f.id))).size;
    const written =
      entityStoreFor(storage, connectorId).get('posthog_feature_flag')?.size ??
      0;
    if (written !== unique) {
      violations.push({
        invariant: 'one posthog_feature_flag entity per unique flag id',
        location: 'feature_flags phase',
        detail: `expected ${unique} entities, got ${written}`,
      });
    }
    return violations;
  };
}

function metricsNeverExceedRows(
  metricName: string,
): (
  storage: InMemoryStorage,
  connectorId: string,
  sample: HogQLSample,
) => InvariantViolation[] {
  return (storage, connectorId, sample) => {
    const violations: InvariantViolation[] = [];
    const written = metricStoreFor(storage, connectorId).filter(
      (m) => m.name === metricName,
    ).length;
    if (written > sample.results.length) {
      violations.push({
        invariant: `${metricName} writes at most one sample per query row`,
        location: 'query phase',
        detail: `got ${written} metrics for ${sample.results.length} rows`,
      });
    }
    return violations;
  };
}

describe('PostHogConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('feature_flags: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<FeatureFlagsSample>({
      connectorClass: PostHogConnector,
      resource: 'feature_flags',
      connectorId: CONNECTOR_ID,
      runs: 100,
      extraInvariants: [uniqueFlagEntities(), docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock(() => ({ results: sample, next: null }));
        const c = new PostHogConnector(
          { projectId: '1', host: HOST, resources: ['feature_flags'] },
          { apiKey: API_KEY },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('events_per_day: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<HogQLSample>({
      connectorClass: PostHogConnector,
      resource: 'events_per_day',
      connectorId: CONNECTOR_ID,
      runs: 100,
      extraInvariants: [
        metricsNeverExceedRows('posthog_events_per_day'),
        docShapeExtra,
      ],
      run: async (sample, storage) => {
        installFetchMock(() => sample);
        const c = new PostHogConnector(
          { projectId: '1', host: HOST, resources: ['events_per_day'] },
          { apiKey: API_KEY },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('feature_flag_usage: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<HogQLSample>({
      connectorClass: PostHogConnector,
      resource: 'feature_flag_usage',
      connectorId: CONNECTOR_ID,
      runs: 100,
      extraInvariants: [
        metricsNeverExceedRows('posthog_feature_flag_usage'),
        docShapeExtra,
      ],
      run: async (sample, storage) => {
        installFetchMock(() => sample);
        const c = new PostHogConnector(
          { projectId: '1', host: HOST, resources: ['feature_flag_usage'] },
          { apiKey: API_KEY },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('active_users: sync upholds universal invariants for any valid payload', async () => {
    await runPropertySyncTest<TrendsSample>({
      connectorClass: PostHogConnector,
      resource: 'active_users',
      connectorId: CONNECTOR_ID,
      runs: 100,
      extraInvariants: [docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock(() => sample);
        const c = new PostHogConnector(
          { projectId: '1', host: HOST, resources: ['active_users'] },
          { apiKey: API_KEY },
        );
        await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));
      },
    });
  });

  it('full sync across every phase upholds doc/storage shapes', async () => {
    let queryCall = 0;
    installFetchMock((url) => {
      if (String(url).includes('/feature_flags')) {
        return {
          results: [
            {
              id: 1,
              key: 'flag-a',
              name: 'Flag A',
              active: true,
              rollout_percentage: 50,
              created_at: '2026-05-01T00:00:00Z',
            },
          ],
          next: null,
        };
      }
      queryCall += 1;
      if (queryCall === 1) {
        return { results: [['2026-05-01', 'pageview', 100, 40]] };
      }
      if (queryCall === 2) {
        return { results: [['2026-05-01', 'flag-a', 25, 10]] };
      }
      if (queryCall === 3) {
        return {
          results: [{ data: [10, 12], days: ['2026-05-01', '2026-05-02'] }],
        };
      }
      return {
        results: [
          { count: 100, name: 'pageview', order: 0 },
          { count: 40, name: 'signup', order: 1 },
        ],
      };
    });

    const storage = new InMemoryStorage();
    const c = new PostHogConnector(
      {
        projectId: '1',
        host: HOST,
        events: ['pageview', 'signup'],
        funnels: [{ name: 'activation', steps: ['pageview', 'signup'] }],
      },
      { apiKey: API_KEY },
    );
    await c.sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));

    assertConnectorResourceShapes(
      PostHogConnector.resources,
      storage,
      CONNECTOR_ID,
    );
  });
});
