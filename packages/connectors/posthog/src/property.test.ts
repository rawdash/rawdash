import {
  type InvariantViolation,
  entityStoreFor,
  installFetchMock,
  metricStoreFor,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import type { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';
import { z } from 'zod';

import { PostHogConnector } from './posthog';

const CONNECTOR_ID = 'posthog';
const API_KEY = 'POSTHOG_API_KEY' as unknown as { $secret: string };
const HOST = 'https://us.posthog.com';

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
      extraInvariants: [uniqueFlagEntities()],
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
      extraInvariants: [metricsNeverExceedRows('posthog_events_per_day')],
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
      extraInvariants: [metricsNeverExceedRows('posthog_feature_flag_usage')],
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
});
