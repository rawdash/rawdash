import {
  type InvariantViolation,
  connectorMetricConformanceViolations,
  connectorResourceShapeViolations,
  mockJsonResponse,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import type { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';

import { AlgoliaConnector, type AlgoliaResource } from './algolia';

const CONNECTOR_ID = 'algolia';

const docShapeExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] => [
  ...connectorResourceShapeViolations(
    AlgoliaConnector.resources,
    storage,
    connectorId,
  ),
  ...connectorMetricConformanceViolations(
    AlgoliaConnector.resources,
    storage,
    connectorId,
  ),
];

function makeConnector(resource: AlgoliaResource): AlgoliaConnector {
  return new AlgoliaConnector(
    { appId: 'APP123', indexes: ['products'], resources: [resource] },
    { apiKey: 'analytics-key' },
  );
}

function installMock(sample: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(() => Promise.resolve(mockJsonResponse(sample))),
  );
}

const CASES: Array<{ resource: AlgoliaResource; tag: string }> = [
  { resource: 'algolia_search_count', tag: 'searches_count' },
  { resource: 'algolia_click_through_rate', tag: 'click_through_rate' },
  { resource: 'algolia_no_results_rate', tag: 'no_results_rate' },
  { resource: 'algolia_average_click_position', tag: 'average_click_position' },
  { resource: 'algolia_top_queries', tag: 'top_searches' },
  { resource: 'algolia_no_result_queries', tag: 'no_result_searches' },
];

describe('AlgoliaConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  for (const { resource, tag } of CASES) {
    it(`${tag}: sync upholds universal invariants for any valid payload`, async () => {
      await runPropertySyncTest({
        connectorClass: AlgoliaConnector,
        resource: tag,
        connectorId: CONNECTOR_ID,
        runs: 30,
        extraInvariants: [docShapeExtra],
        run: async (sample, storage) => {
          installMock(sample);
          await makeConnector(resource).sync(
            { mode: 'full' },
            storage.getStorageHandle(CONNECTOR_ID),
          );
        },
      });
    });
  }
});
