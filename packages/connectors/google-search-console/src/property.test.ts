import {
  type InvariantViolation,
  connectorResourceShapeViolations,
  mockJsonResponse,
  runPropertySyncTest,
  metricStoreFor as sharedMetricStoreFor,
} from '@rawdash/connector-test-utils';
import { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { GSCConnector } from './google-search-console';

const CONNECTOR_ID = 'google-search-console';

const docShapeExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    GSCConnector.resources,
    storage,
    connectorId,
  );

function installFetchMock(
  reportBody: (op: string, body: { dimensions: string[] }) => unknown,
): ReturnType<typeof vi.fn> {
  const spy = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('oauth2.googleapis.com/token')) {
      return Promise.resolve(
        mockJsonResponse({ access_token: 'tok', expires_in: 3600 }),
      );
    }
    if (u.includes('searchconsole.googleapis.com')) {
      const parsed = JSON.parse(String(init?.body ?? '{}')) as {
        dimensions: string[];
      };
      const secondDim = parsed.dimensions?.[1] ?? 'date';
      return Promise.resolve(mockJsonResponse(reportBody(secondDim, parsed)));
    }
    return Promise.resolve(mockJsonResponse({}));
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

function metricStoreFor(
  storage: InMemoryStorage,
): Array<{ name: string; ts: number; value: number }> {
  return sharedMetricStoreFor(storage, CONNECTOR_ID);
}

function makeConnector(): GSCConnector {
  return new GSCConnector(
    { siteUrl: 'https://example.com/' },
    {
      serviceAccountJson: undefined,
      refreshToken: 'rtoken' as unknown as { $secret: string },
      clientId: 'cid',
      clientSecret: 'csecret' as unknown as { $secret: string },
    },
  );
}

type SearchAnalyticsByDaySample = z.infer<
  typeof GSCConnector.schemas.search_analytics_by_day
>;

describe('GSCConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('search_analytics_by_day: sync upholds universal invariants for any valid API payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: SearchAnalyticsByDaySample,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const rows = sample.rows ?? [];
      const samples = metricStoreFor(storage).filter(
        (m) => m.name === 'gsc_search_analytics_by_day',
      );
      if (samples.length !== rows.length) {
        violations.push({
          invariant: 'one gsc_search_analytics_by_day metric per row',
          location: 'search_analytics_by_day phase',
          detail: `expected ${rows.length} metrics, got ${samples.length}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest({
      connectorClass: GSCConnector,
      resource: 'search_analytics_by_day',
      connectorId: CONNECTOR_ID,
      runs: 50,
      extraInvariants: [extra, docShapeExtra],
      run: async (sample, storage) => {
        const rows = sample.rows ?? [];
        installFetchMock((secondDim) => {
          if (secondDim === 'date') {
            return { rows };
          }
          return { rows: [] };
        });
        await makeConnector().sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('full sync writes only documented metric resources', async () => {
    installFetchMock((_secondDim, body) => {
      const dimensions = body.dimensions ?? [];
      return {
        rows: [
          {
            keys: dimensions.map((d) =>
              d === 'date' ? '2025-01-01' : 'sample',
            ),
            clicks: 1,
            impressions: 10,
            ctr: 0.1,
            position: 5,
          },
        ],
      };
    });

    const storage = new InMemoryStorage();
    await makeConnector().sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    const writtenNames = new Set(metricStoreFor(storage).map((m) => m.name));
    expect(writtenNames).toEqual(
      new Set([
        'gsc_search_analytics_by_day',
        'gsc_top_queries',
        'gsc_top_pages',
        'gsc_top_countries',
      ]),
    );

    expect(
      connectorResourceShapeViolations(
        GSCConnector.resources,
        storage,
        CONNECTOR_ID,
      ),
    ).toEqual([]);
  });
});
