import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AppsflyerConnector,
  configFields,
  getWindow,
  installRowToMetricSample,
  retentionRowToMetricSamples,
} from './appsflyer';

describe('configFields', () => {
  it('parses a valid config with iOS app id', () => {
    const result = configFields.safeParse({
      appId: 'id1234567890',
      apiToken: { $secret: 'APPSFLYER_API_TOKEN' },
    });
    expect(result.success).toBe(true);
  });

  it('parses a valid config with Android package name', () => {
    const result = configFields.safeParse({
      appId: 'com.example.app',
      apiToken: { $secret: 'APPSFLYER_API_TOKEN' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a plain-string api token', () => {
    const result = configFields.safeParse({
      appId: 'id1234567890',
      apiToken: 'raw-token',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty app id', () => {
    const result = configFields.safeParse({
      appId: '',
      apiToken: { $secret: 'APPSFLYER_API_TOKEN' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown resource', () => {
    const result = configFields.safeParse({
      appId: 'id1234567890',
      apiToken: { $secret: 'APPSFLYER_API_TOKEN' },
      resources: ['install_metrics', 'retention_per_user'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-ISO currency code', () => {
    const result = configFields.safeParse({
      appId: 'id1234567890',
      apiToken: { $secret: 'APPSFLYER_API_TOKEN' },
      currency: 'dollars',
    });
    expect(result.success).toBe(false);
  });

  it('accepts an IANA timezone string', () => {
    const result = configFields.safeParse({
      appId: 'id1234567890',
      apiToken: { $secret: 'APPSFLYER_API_TOKEN' },
      timezone: 'America/New_York',
    });
    expect(result.success).toBe(true);
  });
});

describe('getWindow', () => {
  const NOW = Date.UTC(2026, 5, 10);

  it('returns lookbackDays-aligned full window when no since is provided', () => {
    const window = getWindow({ mode: 'full' }, 30, undefined, NOW);
    expect(window.to).toBe('2026-06-10');
    expect(window.from).toBe('2026-05-12');
  });

  it('caps the requested span at lookbackDays', () => {
    const window = getWindow(
      { mode: 'full', since: '2020-01-01T00:00:00Z' },
      30,
      undefined,
      NOW,
    );
    expect(window.from).toBe('2026-05-12');
    expect(window.to).toBe('2026-06-10');
  });

  it('uses the fixed incremental window for latest-mode syncs', () => {
    const window = getWindow(
      { mode: 'latest', since: '2026-06-08T00:00:00Z' },
      90,
      undefined,
      NOW,
    );
    expect(window.to).toBe('2026-06-10');
    expect(window.from).toBe('2026-05-28');
  });

  it('aligns the trailing day to the configured timezone', () => {
    const lateUtc = Date.UTC(2026, 5, 10, 3, 0, 0);
    const utcWindow = getWindow({ mode: 'full' }, 30, undefined, lateUtc);
    const tzWindow = getWindow(
      { mode: 'full' },
      30,
      'America/Los_Angeles',
      lateUtc,
    );
    expect(utcWindow.to).toBe('2026-06-10');
    expect(tzWindow.to).toBe('2026-06-09');
  });
});

describe('installRowToMetricSample', () => {
  it('uses installs as the primary value and bucketed date as ts', () => {
    const sample = installRowToMetricSample({
      af_date: '2025-01-15',
      pid: 'facebook_ads',
      c: 'summer_2025',
      installs: 120,
      cost: '45.50',
      revenue: '210.25',
      loyal_users: 42,
    });
    expect(sample.name).toBe('appsflyer_install_metrics');
    expect(sample.ts).toBe(Date.UTC(2025, 0, 15));
    expect(sample.value).toBe(120);
    expect(sample.attributes['mediaSource']).toBe('facebook_ads');
    expect(sample.attributes['campaign']).toBe('summer_2025');
    expect(sample.attributes['cost']).toBeCloseTo(45.5);
    expect(sample.attributes['revenue']).toBeCloseTo(210.25);
    expect(sample.attributes['loyalUsers']).toBe(42);
  });

  it('preserves null media source and campaign', () => {
    const sample = installRowToMetricSample({
      af_date: '2025-01-15',
      pid: null,
      c: null,
      installs: 5,
    });
    expect(sample.attributes['mediaSource']).toBeNull();
    expect(sample.attributes['campaign']).toBeNull();
    expect(sample.attributes['cost']).toBe(0);
  });

  it('returns ts=0 for an unparseable date', () => {
    const sample = installRowToMetricSample({
      af_date: 'not-a-date',
      installs: 1,
    });
    expect(sample.ts).toBe(0);
  });
});

describe('retentionRowToMetricSamples', () => {
  it('emits one sample per RETENTION period', () => {
    const samples = retentionRowToMetricSamples({
      af_date: '2025-01-15',
      pid: 'organic',
      retention_day_1: 1000,
      retention_day_7: 500,
      retention_day_30: 200,
    });
    expect(samples).toHaveLength(3);
    expect(samples.map((s) => s.attributes['period'])).toEqual([1, 7, 30]);
    expect(samples.map((s) => s.value)).toEqual([1000, 500, 200]);
    for (const s of samples) {
      expect(s.name).toBe('appsflyer_retention_metrics');
      expect(s.ts).toBe(Date.UTC(2025, 0, 15));
      expect(s.attributes['cohortDate']).toBe('2025-01-15');
      expect(s.attributes['mediaSource']).toBe('organic');
    }
  });

  it('treats missing retention KPIs as 0', () => {
    const samples = retentionRowToMetricSamples({
      af_date: '2025-01-15',
    });
    expect(samples.map((s) => s.value)).toEqual([0, 0, 0]);
  });
});

interface MockCall {
  url: string;
  method: string;
  headers: Record<string, string>;
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

function makeFetch(route: (url: string) => unknown) {
  return vi.fn().mockImplementation((url: string | URL) => {
    const u = typeof url === 'string' ? url : url.toString();
    const explicit = route(u);
    if (explicit !== undefined) {
      return Promise.resolve(jsonResponse(explicit));
    }
    return Promise.resolve(jsonResponse({ data: [] }));
  });
}

function recordCalls(spy: ReturnType<typeof vi.fn>): MockCall[] {
  return spy.mock.calls.map((c: unknown[]) => {
    const init = (c[1] ?? {}) as RequestInit;
    return {
      url: String(c[0]),
      method: (init.method ?? 'GET').toUpperCase(),
      headers: (init.headers ?? {}) as Record<string, string>,
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

const TOKEN = 'APPSFLYER_TOKEN';

function connector(overrides?: {
  resources?: string[];
  timezone?: string;
  currency?: string;
}) {
  return new AppsflyerConnector(
    {
      appId: 'id1234567890',
      resources: overrides?.resources as never,
      timezone: overrides?.timezone,
      currency: overrides?.currency,
    },
    { apiToken: TOKEN },
  );
}

describe('AppsflyerConnector.sync', () => {
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

  it('clears the metric scope on every sync (idempotent overwrite)', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetch(() => undefined),
    );
    const storage = makeStorage();
    await connector().sync({ mode: 'full' }, storage);

    const clearedMetrics = storage.metrics.mock.calls
      .filter((c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0)
      .map((c) => (c[1] as { names: string[] }).names[0]);
    expect(clearedMetrics).toContain('appsflyer_install_metrics');
    expect(clearedMetrics).toContain('appsflyer_retention_metrics');
  });

  it('sends Bearer api token in the Authorization header', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector({ resources: ['install_metrics'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const calls = recordCalls(fetchSpy);
    expect(calls.length).toBeGreaterThan(0);
    const authHeader = Object.entries(calls[0]!.headers).find(
      ([k]) => k.toLowerCase() === 'authorization',
    );
    expect(authHeader).toBeDefined();
    expect(authHeader![1]).toBe('Bearer APPSFLYER_TOKEN');
  });

  it('hits the configured app id and requests JSON', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector({ resources: ['install_metrics'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const calls = recordCalls(fetchSpy);
    expect(calls[0]!.url).toContain('/app/id1234567890');
    expect(calls[0]!.url).toContain('format=json');
    expect(calls[0]!.url).toContain('groupings=');
    expect(calls[0]!.url).toContain('kpis=');
  });

  it('writes one metric sample per install row', async () => {
    const fetchSpy = makeFetch((url) => {
      if (url.includes('kpis=installs')) {
        return {
          data: [
            {
              af_date: '2025-01-15',
              pid: 'facebook_ads',
              c: 'summer',
              installs: 120,
              cost: 45,
              revenue: 250,
              loyal_users: 18,
            },
            {
              af_date: '2025-01-16',
              pid: 'organic',
              c: null,
              installs: 200,
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

    const metricCalls = storage.metric.mock.calls;
    expect(metricCalls).toHaveLength(2);
    const first = metricCalls[0]![0] as {
      name: string;
      ts: number;
      value: number;
    };
    expect(first.name).toBe('appsflyer_install_metrics');
    expect(first.ts).toBe(Date.UTC(2025, 0, 15));
    expect(first.value).toBe(120);
  });

  it('writes three retention samples per cohort row (one per period)', async () => {
    const fetchSpy = makeFetch((url) => {
      if (url.includes('kpis=retention_day_1')) {
        return {
          data: [
            {
              af_date: '2025-01-15',
              pid: 'organic',
              retention_day_1: 1000,
              retention_day_7: 500,
              retention_day_30: 200,
            },
          ],
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector({ resources: ['retention_metrics'] }).sync(
      { mode: 'full' },
      storage,
    );

    const metricCalls = storage.metric.mock.calls;
    expect(metricCalls).toHaveLength(3);
    expect(metricCalls.map((c) => (c[0] as { value: number }).value)).toEqual([
      1000, 500, 200,
    ]);
    expect(
      metricCalls.map(
        (c) => (c[0] as { attributes: { period: number } }).attributes.period,
      ),
    ).toEqual([1, 7, 30]);
  });

  it('honors the resources allowlist (skips retention when only install_metrics is requested)', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector({ resources: ['install_metrics'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const calls = recordCalls(fetchSpy);
    const retentionCalls = calls.filter((c) =>
      c.url.includes('kpis=retention_day_1'),
    );
    expect(retentionCalls).toHaveLength(0);
  });

  it('passes timezone and currency to the API when configured', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector({
      resources: ['install_metrics'],
      timezone: 'America/New_York',
      currency: 'USD',
    }).sync({ mode: 'full' }, makeStorage());

    const calls = recordCalls(fetchSpy);
    expect(calls[0]!.url).toContain('timezone=America');
    expect(calls[0]!.url).toContain('currency=USD');
  });

  it('omits timezone and currency from the URL when not configured', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector({ resources: ['install_metrics'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const calls = recordCalls(fetchSpy);
    expect(calls[0]!.url).not.toContain('timezone=');
    expect(calls[0]!.url).not.toContain('currency=');
  });

  it('requests the Master API install groupings/KPIs (pid, c, loyal_users)', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector({ resources: ['install_metrics'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const url = decodeURIComponent(recordCalls(fetchSpy)[0]!.url);
    expect(url).toContain('groupings=af_date,pid,c');
    expect(url).toContain('kpis=installs,cost,revenue,loyal_users');
    expect(url).not.toContain('af_media_source');
    expect(url).not.toContain('af_campaign');
    expect(url).not.toContain('conversions');
  });

  it('requests the Master API retention groupings/KPIs (retention_day_N by af_date, pid)', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector({ resources: ['retention_metrics'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const url = decodeURIComponent(recordCalls(fetchSpy)[0]!.url);
    expect(url).toContain('groupings=af_date,pid');
    expect(url).toContain(
      'kpis=retention_day_1,retention_day_7,retention_day_30',
    );
    expect(url).not.toContain('retained_users_day');
    expect(url).not.toContain('cohort_date');
  });

  it('resumes from a saved cursor at the specified phase', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector().sync(
      { mode: 'full', cursor: { phase: 'retention_metrics', page: null } },
      makeStorage(),
    );

    const calls = recordCalls(fetchSpy);
    expect(calls.find((c) => c.url.includes('kpis=installs'))).toBeUndefined();
    expect(
      calls.find((c) => c.url.includes('kpis=retention_day_1')),
    ).toBeDefined();
  });
});

describe('AppsflyerConnector.create', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns a configured connector from JSON config', () => {
    vi.stubEnv('APPSFLYER_API_TOKEN', 'real-token-value');
    const c = AppsflyerConnector.create({
      appId: 'id42',
      apiToken: { $secret: 'APPSFLYER_API_TOKEN' },
    });
    expect(c).toBeInstanceOf(AppsflyerConnector);
    expect(c.id).toBe('appsflyer');
  });
});
