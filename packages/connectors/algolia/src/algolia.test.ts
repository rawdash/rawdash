import {
  installFetchMockAdvanced,
  metricStoreFor,
} from '@rawdash/connector-test-utils';
import { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AlgoliaConnector,
  type AlgoliaResource,
  configFields,
  getAnalyticsWindow,
} from './algolia';

const CONNECTOR_ID = 'algolia';

type StoredMetric = {
  name: string;
  ts: number;
  value: number;
  attributes: Record<string, unknown>;
};

function makeConnector(
  overrides: {
    indexes?: readonly string[];
    resources?: readonly AlgoliaResource[];
    lookbackDays?: number;
    region?: 'us' | 'de';
    topQueriesLimit?: number;
  } = {},
): AlgoliaConnector {
  return new AlgoliaConnector(
    {
      appId: 'APP123',
      indexes: overrides.indexes ?? ['products'],
      region: overrides.region,
      resources: overrides.resources,
      lookbackDays: overrides.lookbackDays ?? 7,
      topQueriesLimit: overrides.topQueriesLimit,
    },
    { apiKey: 'analytics-key' },
  );
}

describe('AlgoliaConnector sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches every analytics series and writes one metric per series', async () => {
    const calls: string[] = [];
    installFetchMockAdvanced((url) => {
      calls.push(url);
      if (url.includes('/2/searches/count')) {
        return {
          body: { count: 30, dates: [{ date: '2026-02-10', count: 30 }] },
        };
      }
      if (url.includes('/2/clicks/clickThroughRate')) {
        return {
          body: {
            rate: 0.5,
            clickCount: 15,
            trackedSearchCount: 30,
            dates: [
              {
                date: '2026-02-10',
                rate: 0.5,
                clickCount: 15,
                trackedSearchCount: 30,
              },
            ],
          },
        };
      }
      if (url.includes('/2/searches/noResultRate')) {
        return {
          body: {
            rate: 0.1,
            count: 30,
            noResultCount: 3,
            dates: [
              { date: '2026-02-10', rate: 0.1, count: 30, noResultCount: 3 },
            ],
          },
        };
      }
      if (url.includes('/2/clicks/averageClickPosition')) {
        return {
          body: {
            average: 2.5,
            clickCount: 15,
            dates: [{ date: '2026-02-10', average: 2.5, clickCount: 15 }],
          },
        };
      }
      if (url.includes('/2/searches/noResults')) {
        return {
          body: {
            searches: [{ search: 'zzz', count: 3, withFilterCount: 1 }],
          },
        };
      }
      return {
        body: {
          searches: [{ search: 'shoes', count: 20, nbHits: 42 }],
        },
      };
    });

    const storage = new InMemoryStorage();
    const result = await makeConnector().sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );
    expect(result).toEqual({ done: true });

    const metrics = metricStoreFor<StoredMetric>(storage, CONNECTOR_ID);
    const byName = new Map<string, number>();
    for (const m of metrics) {
      byName.set(m.name, (byName.get(m.name) ?? 0) + 1);
    }
    expect(byName.get('algolia_search_count')).toBe(1);
    expect(byName.get('algolia_click_through_rate')).toBe(1);
    expect(byName.get('algolia_no_results_rate')).toBe(1);
    expect(byName.get('algolia_average_click_position')).toBe(1);
    expect(byName.get('algolia_top_queries')).toBe(1);
    expect(byName.get('algolia_no_result_queries')).toBe(1);

    const searchCount = metrics.find((m) => m.name === 'algolia_search_count')!;
    expect(searchCount.value).toBe(30);
    expect(searchCount.attributes['index']).toBe('products');

    const ctr = metrics.find((m) => m.name === 'algolia_click_through_rate')!;
    expect(ctr.value).toBeCloseTo(0.5, 6);
    expect(ctr.attributes['click_count']).toBe(15);
    expect(ctr.attributes['tracked_search_count']).toBe(30);

    const noResultRate = metrics.find(
      (m) => m.name === 'algolia_no_results_rate',
    )!;
    expect(noResultRate.attributes['no_result_count']).toBe(3);

    const top = metrics.find((m) => m.name === 'algolia_top_queries')!;
    expect(top.value).toBe(20);
    expect(top.attributes['query']).toBe('shoes');
    expect(top.attributes['nb_hits']).toBe(42);

    const noResultQuery = metrics.find(
      (m) => m.name === 'algolia_no_result_queries',
    )!;
    expect(noResultQuery.value).toBe(3);
    expect(noResultQuery.attributes['query']).toBe('zzz');
    expect(noResultQuery.attributes['with_filter_count']).toBe(1);

    expect(calls.every((u) => u.includes('index=products'))).toBe(true);
    expect(calls.some((u) => u.includes('startDate='))).toBe(true);
  });

  it('skips days with a null average click position', async () => {
    installFetchMockAdvanced(() => ({
      body: {
        average: null,
        clickCount: 0,
        dates: [
          { date: '2026-02-10', average: null, clickCount: 0 },
          { date: '2026-02-11', average: 3.2, clickCount: 4 },
        ],
      },
    }));

    const storage = new InMemoryStorage();
    await makeConnector({
      resources: ['algolia_average_click_position'],
    }).sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));

    const metrics = metricStoreFor<StoredMetric>(storage, CONNECTOR_ID).filter(
      (m) => m.name === 'algolia_average_click_position',
    );
    expect(metrics).toHaveLength(1);
    expect(metrics[0]!.value).toBeCloseTo(3.2, 6);
  });

  it('emits one sample per index per day', async () => {
    installFetchMockAdvanced(() => ({
      body: {
        count: 5,
        dates: [
          { date: '2026-02-10', count: 5 },
          { date: '2026-02-11', count: 7 },
        ],
      },
    }));

    const storage = new InMemoryStorage();
    await makeConnector({
      indexes: ['products', 'articles'],
      resources: ['algolia_search_count'],
    }).sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));

    const metrics = metricStoreFor<StoredMetric>(storage, CONNECTOR_ID);
    expect(metrics).toHaveLength(4);
    expect(new Set(metrics.map((m) => m.attributes['index']))).toEqual(
      new Set(['products', 'articles']),
    );
  });

  it('routes requests to the configured region host', async () => {
    const calls: string[] = [];
    installFetchMockAdvanced((url) => {
      calls.push(url);
      return { body: { count: 0, dates: [] } };
    });

    const storage = new InMemoryStorage();
    await makeConnector({
      region: 'de',
      resources: ['algolia_search_count'],
    }).sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));

    expect(
      calls.every((u) => u.startsWith('https://analytics.de.algolia.com')),
    ).toBe(true);
  });
});

describe('getAnalyticsWindow', () => {
  const now = Date.UTC(2026, 1, 15, 12, 0, 0);

  it('spans lookbackDays inclusive on a full sync', () => {
    const window = getAnalyticsWindow({ mode: 'full' }, 7, now);
    expect(window.endDate).toBe('2026-02-15');
    expect(window.startDate).toBe('2026-02-09');
  });

  it('shrinks to the incremental window on a latest sync', () => {
    const window = getAnalyticsWindow({ mode: 'latest' }, 30, now);
    expect(window.startDate).toBe('2026-02-14');
    expect(window.endDate).toBe('2026-02-15');
  });
});

describe('configFields', () => {
  it('rejects an empty index list', () => {
    expect(() =>
      configFields.parse({
        appId: 'APP123',
        apiKey: { $secret: 'x' },
        indexes: [],
      }),
    ).toThrow();
  });

  it('accepts a minimal valid config', () => {
    const parsed = configFields.parse({
      appId: 'APP123',
      apiKey: { $secret: 'ALGOLIA_ANALYTICS_API_KEY' },
      indexes: ['products'],
    });
    expect(parsed.appId).toBe('APP123');
    expect(parsed.indexes).toEqual(['products']);
  });
});
