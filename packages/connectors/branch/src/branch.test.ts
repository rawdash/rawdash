import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BranchConnector,
  clickRowToEventRecord,
  configFields,
  getWindow,
  installBucketToMetricSample,
  mergeInstallBuckets,
} from './branch';

describe('configFields', () => {
  it('parses a valid config', () => {
    const result = configFields.safeParse({
      branchKey: { $secret: 'BRANCH_KEY' },
      branchSecret: { $secret: 'BRANCH_SECRET' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a plain-string key', () => {
    const result = configFields.safeParse({
      branchKey: 'key_live_xxx',
      branchSecret: { $secret: 'BRANCH_SECRET' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a missing secret', () => {
    const result = configFields.safeParse({
      branchKey: { $secret: 'BRANCH_KEY' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown resource', () => {
    const result = configFields.safeParse({
      branchKey: { $secret: 'BRANCH_KEY' },
      branchSecret: { $secret: 'BRANCH_SECRET' },
      resources: ['install_metrics', 'retention'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-positive lookbackDays', () => {
    const result = configFields.safeParse({
      branchKey: { $secret: 'BRANCH_KEY' },
      branchSecret: { $secret: 'BRANCH_SECRET' },
      lookbackDays: 0,
    });
    expect(result.success).toBe(false);
  });
});

describe('getWindow', () => {
  const NOW = Date.UTC(2026, 5, 10);

  it('returns lookbackDays-aligned full window when no since is provided', () => {
    const window = getWindow({ mode: 'full' }, 30, NOW);
    expect(window.to).toBe('2026-06-10');
    expect(window.from).toBe('2026-05-12');
  });

  it('caps the requested span at lookbackDays', () => {
    const window = getWindow(
      { mode: 'full', since: '2020-01-01T00:00:00Z' },
      30,
      NOW,
    );
    expect(window.from).toBe('2026-05-12');
    expect(window.to).toBe('2026-06-10');
  });

  it('uses the fixed incremental window for latest-mode syncs', () => {
    const window = getWindow(
      { mode: 'latest', since: '2026-06-08T00:00:00Z' },
      90,
      NOW,
    );
    expect(window.to).toBe('2026-06-10');
    expect(window.from).toBe('2026-05-28');
  });
});

describe('mergeInstallBuckets', () => {
  it('merges install, open, and event rows into one bucket per (date, channel, campaign)', () => {
    const buckets = mergeInstallBuckets({
      eo_install: [
        {
          unique_count: 120,
          result: {
            timestamp: '2025-01-15T00:00:00Z',
            last_attributed_touch_data_tilde_channel: 'facebook',
            last_attributed_touch_data_tilde_campaign: 'summer',
            cost_in_local_currency: 45,
          },
        },
      ],
      eo_open: [
        {
          unique_count: 220,
          result: {
            timestamp: '2025-01-15T00:00:00Z',
            last_attributed_touch_data_tilde_channel: 'facebook',
            last_attributed_touch_data_tilde_campaign: 'summer',
          },
        },
      ],
      eo_event: [
        {
          unique_count: 18,
          result: {
            timestamp: '2025-01-15T00:00:00Z',
            last_attributed_touch_data_tilde_channel: 'facebook',
            last_attributed_touch_data_tilde_campaign: 'summer',
          },
        },
      ],
    });
    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toEqual({
      date: '2025-01-15',
      channel: 'facebook',
      campaign: 'summer',
      installs: 120,
      opens: 220,
      conversions: 18,
      costEstimated: 45,
    });
  });

  it('produces distinct buckets per (date, channel, campaign) and treats nulls as a bucket key', () => {
    const buckets = mergeInstallBuckets({
      eo_install: [
        {
          unique_count: 5,
          result: {
            timestamp: '2025-01-15',
            last_attributed_touch_data_tilde_channel: null,
            last_attributed_touch_data_tilde_campaign: null,
          },
        },
        {
          unique_count: 50,
          result: {
            timestamp: '2025-01-16',
            last_attributed_touch_data_tilde_channel: 'organic',
            last_attributed_touch_data_tilde_campaign: null,
          },
        },
      ],
      eo_open: [],
      eo_event: [],
    });
    expect(buckets).toHaveLength(2);
    expect(buckets[0]!.date).toBe('2025-01-15');
    expect(buckets[0]!.channel).toBeNull();
    expect(buckets[1]!.channel).toBe('organic');
  });
});

describe('installBucketToMetricSample', () => {
  it('uses installs as the primary value and bucketed date as ts', () => {
    const sample = installBucketToMetricSample({
      date: '2025-01-15',
      channel: 'facebook',
      campaign: 'summer',
      installs: 120,
      opens: 220,
      conversions: 18,
      costEstimated: 45,
    });
    expect(sample.name).toBe('branch_install_metrics');
    expect(sample.ts).toBe(Date.UTC(2025, 0, 15));
    expect(sample.value).toBe(120);
    expect(sample.attributes['channel']).toBe('facebook');
    expect(sample.attributes['costEstimated']).toBe(45);
  });

  it('returns ts=0 for an unparseable date', () => {
    const sample = installBucketToMetricSample({
      date: 'not-a-date',
      channel: null,
      campaign: null,
      installs: 1,
      opens: 0,
      conversions: 0,
      costEstimated: 0,
    });
    expect(sample.ts).toBe(0);
  });
});

describe('clickRowToEventRecord', () => {
  it('builds a stable bucket key and pins start_ts/end_ts to the day', () => {
    const event = clickRowToEventRecord({
      unique_count: 250,
      result: {
        timestamp: '2025-01-15T00:00:00Z',
        last_attributed_touch_data_tilde_channel: 'facebook',
        last_attributed_touch_data_tilde_campaign: 'summer',
        last_attributed_touch_data_tilde_feature: 'sharing',
      },
    });
    expect(event.name).toBe('branch_deep_link_event');
    expect(event.attributes['bucketKey']).toBe(
      '2025-01-15|facebook|summer|sharing',
    );
    expect(event.start_ts).toBe(Date.UTC(2025, 0, 15));
    expect(event.end_ts).toBe(Date.UTC(2025, 0, 15));
    expect(event.attributes['clicks']).toBe(250);
  });

  it('preserves null channel/campaign/feature in the bucket key', () => {
    const event = clickRowToEventRecord({
      unique_count: 1,
      result: {
        timestamp: '2025-01-15',
        last_attributed_touch_data_tilde_channel: null,
        last_attributed_touch_data_tilde_campaign: null,
        last_attributed_touch_data_tilde_feature: null,
      },
    });
    expect(event.attributes['bucketKey']).toBe('2025-01-15|||');
    expect(event.attributes['channel']).toBeNull();
  });
});

interface MockCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'application/json' }),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

function makeFetch(route: (url: string, body: unknown) => unknown) {
  return vi.fn().mockImplementation((url: string | URL, init?: RequestInit) => {
    const u = typeof url === 'string' ? url : url.toString();
    const parsedBody =
      typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
    const explicit = route(u, parsedBody);
    if (explicit !== undefined) {
      return Promise.resolve(jsonResponse(explicit));
    }
    return Promise.resolve(jsonResponse({ results: [] }));
  });
}

function recordCalls(spy: ReturnType<typeof vi.fn>): MockCall[] {
  return spy.mock.calls.map((c: unknown[]) => {
    const init = (c[1] ?? {}) as RequestInit;
    const body =
      typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    return {
      url: String(c[0]),
      method: (init.method ?? 'GET').toUpperCase(),
      headers: (init.headers ?? {}) as Record<string, string>,
      body,
    };
  });
}

function makeStorage() {
  return {
    event: vi.fn().mockResolvedValue(undefined),
    entity: vi.fn().mockResolvedValue(undefined),
    metric: vi.fn().mockResolvedValue(undefined),
    edge: vi.fn().mockResolvedValue(undefined),
    distribution: vi.fn().mockResolvedValue(undefined),
    events: vi.fn().mockResolvedValue(undefined),
    entities: vi.fn().mockResolvedValue(undefined),
    metrics: vi.fn().mockResolvedValue(undefined),
    edges: vi.fn().mockResolvedValue(undefined),
    distributions: vi.fn().mockResolvedValue(undefined),
    queryEvents: vi.fn().mockResolvedValue([]),
    getEntity: vi.fn().mockResolvedValue(null),
    queryEntities: vi.fn().mockResolvedValue([]),
    queryMetrics: vi.fn().mockResolvedValue([]),
    traverse: vi.fn().mockResolvedValue([]),
    queryDistributions: vi.fn().mockResolvedValue([]),
    deleteOlderThan: vi.fn().mockResolvedValue({ rowsDeleted: 0 }),
  };
}

function connector(overrides?: { resources?: string[] }) {
  return new BranchConnector(
    { resources: overrides?.resources as never },
    {
      branchKey: 'key_live_xxx',
      branchSecret: 'secret_live_xxx',
    },
  );
}

describe('BranchConnector.sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns done:true when every phase is empty', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetch(() => undefined),
    );
    const result = await connector().sync({ mode: 'full' }, makeStorage());
    expect(result.done).toBe(true);
  });

  it('clears the install_metrics scope (idempotent overwrite)', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetch(() => undefined),
    );
    const storage = makeStorage();
    await connector({ resources: ['install_metrics'] }).sync(
      { mode: 'full' },
      storage,
    );

    const clearedMetrics = storage.metrics.mock.calls
      .filter((c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0)
      .map((c) => (c[1] as { names: string[] }).names[0]);
    expect(clearedMetrics).toContain('branch_install_metrics');
  });

  it('sends key + secret in the POST body', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector({ resources: ['install_metrics'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const calls = recordCalls(fetchSpy);
    expect(calls.length).toBeGreaterThan(0);
    const body = calls[0]!.body as {
      branch_key: string;
      branch_secret: string;
      data_source: string;
    };
    expect(body.branch_key).toBe('key_live_xxx');
    expect(body.branch_secret).toBe('secret_live_xxx');
    expect(calls[0]!.method).toBe('POST');
  });

  it('hits the v1 analytics endpoint with day granularity', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector({ resources: ['install_metrics'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const calls = recordCalls(fetchSpy);
    expect(calls[0]!.url).toBe('https://api2.branch.io/v1/query/analytics');
    const body = calls[0]!.body as {
      granularity: string;
      aggregation: string;
    };
    expect(body.granularity).toBe('day');
    expect(body.aggregation).toBe('unique_count');
  });

  it('makes one request per data source (install, open, event) when install_metrics is enabled', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector({ resources: ['install_metrics'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const calls = recordCalls(fetchSpy);
    const dataSources = calls.map(
      (c) => (c.body as { data_source: string }).data_source,
    );
    expect(dataSources).toEqual(['eo_install', 'eo_open', 'eo_event']);
  });

  it('merges install/open/event results into one metric sample per bucket', async () => {
    const fetchSpy = makeFetch((_url, body) => {
      const dataSource = (body as { data_source: string }).data_source;
      if (dataSource === 'eo_install') {
        return {
          results: [
            {
              unique_count: 120,
              result: {
                timestamp: '2025-01-15',
                last_attributed_touch_data_tilde_channel: 'facebook',
                last_attributed_touch_data_tilde_campaign: 'summer',
                cost_in_local_currency: 45,
              },
            },
          ],
        };
      }
      if (dataSource === 'eo_open') {
        return {
          results: [
            {
              unique_count: 220,
              result: {
                timestamp: '2025-01-15',
                last_attributed_touch_data_tilde_channel: 'facebook',
                last_attributed_touch_data_tilde_campaign: 'summer',
              },
            },
          ],
        };
      }
      if (dataSource === 'eo_event') {
        return {
          results: [
            {
              unique_count: 18,
              result: {
                timestamp: '2025-01-15',
                last_attributed_touch_data_tilde_channel: 'facebook',
                last_attributed_touch_data_tilde_campaign: 'summer',
              },
            },
          ],
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector({ resources: ['install_metrics'] }).sync(
      { mode: 'full' },
      storage,
    );

    expect(storage.metric.mock.calls).toHaveLength(1);
    const first = storage.metric.mock.calls[0]![0] as {
      name: string;
      ts: number;
      value: number;
      attributes: Record<string, unknown>;
    };
    expect(first.name).toBe('branch_install_metrics');
    expect(first.ts).toBe(Date.UTC(2025, 0, 15));
    expect(first.value).toBe(120);
    expect(first.attributes['opens']).toBe(220);
    expect(first.attributes['conversions']).toBe(18);
    expect(first.attributes['costEstimated']).toBe(45);
  });

  it('writes one event per (date, channel, campaign, feature) click bucket', async () => {
    const fetchSpy = makeFetch((_url, body) => {
      const dataSource = (body as { data_source: string }).data_source;
      if (dataSource === 'eo_click') {
        return {
          results: [
            {
              unique_count: 250,
              result: {
                timestamp: '2025-01-15',
                last_attributed_touch_data_tilde_channel: 'facebook',
                last_attributed_touch_data_tilde_campaign: 'summer',
                last_attributed_touch_data_tilde_feature: 'sharing',
              },
            },
          ],
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector({ resources: ['deep_link_events'] }).sync(
      { mode: 'full' },
      storage,
    );

    expect(storage.event.mock.calls).toHaveLength(1);
    const event = storage.event.mock.calls[0]![0] as {
      name: string;
      start_ts: number;
      end_ts: number;
      attributes: Record<string, unknown>;
    };
    expect(event.name).toBe('branch_deep_link_event');
    expect(event.attributes['bucketKey']).toBe(
      '2025-01-15|facebook|summer|sharing',
    );
    expect(event.attributes['clicks']).toBe(250);
  });

  it('honors the resources allowlist (skips deep_link_events when only install_metrics is requested)', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector({ resources: ['install_metrics'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const calls = recordCalls(fetchSpy);
    const clickCalls = calls.filter(
      (c) => (c.body as { data_source: string }).data_source === 'eo_click',
    );
    expect(clickCalls).toHaveLength(0);
  });

  it('resumes from a saved cursor at the specified phase', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector().sync(
      { mode: 'full', cursor: { phase: 'deep_link_events', page: null } },
      makeStorage(),
    );

    const calls = recordCalls(fetchSpy);
    const installCalls = calls.filter(
      (c) =>
        (c.body as { data_source: string }).data_source === 'eo_install' ||
        (c.body as { data_source: string }).data_source === 'eo_open' ||
        (c.body as { data_source: string }).data_source === 'eo_event',
    );
    expect(installCalls).toHaveLength(0);
    const clickCalls = calls.filter(
      (c) => (c.body as { data_source: string }).data_source === 'eo_click',
    );
    expect(clickCalls).toHaveLength(1);
  });
});

describe('BranchConnector.create', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns a configured connector from JSON config', () => {
    vi.stubEnv('BRANCH_KEY', 'key_live_xxx');
    vi.stubEnv('BRANCH_SECRET', 'secret_live_xxx');
    const c = BranchConnector.create({
      branchKey: { $secret: 'BRANCH_KEY' },
      branchSecret: { $secret: 'BRANCH_SECRET' },
    });
    expect(c).toBeInstanceOf(BranchConnector);
    expect(c.id).toBe('branch');
  });
});
