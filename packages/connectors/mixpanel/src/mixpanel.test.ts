import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MixpanelConnector,
  buildActiveUserSamples,
  buildEventsPerDaySamples,
  buildFunnelSamples,
  buildRetentionSamples,
  configFields,
  getDateRange,
} from './mixpanel';

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

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'application/json' }),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

interface Handlers {
  segmentation?: (params: URLSearchParams) => unknown;
  funnels?: (params: URLSearchParams) => unknown;
  retention?: (params: URLSearchParams) => unknown;
}

function mockFetch(handlers: Handlers): ReturnType<typeof vi.fn> {
  return vi.fn().mockImplementation((input: string | URL) => {
    const url = new URL(String(input));
    const params = url.searchParams;
    if (url.pathname.endsWith('/segmentation')) {
      return Promise.resolve(
        jsonResponse(
          handlers.segmentation?.(params) ?? {
            data: { series: [], values: {} },
          },
        ),
      );
    }
    if (url.pathname.endsWith('/funnels')) {
      return Promise.resolve(
        jsonResponse(handlers.funnels?.(params) ?? { data: {} }),
      );
    }
    if (url.pathname.endsWith('/retention')) {
      return Promise.resolve(jsonResponse(handlers.retention?.(params) ?? {}));
    }
    return Promise.resolve(jsonResponse({}));
  });
}

function makeConnector(overrides: {
  events?: string[];
  funnels?: Array<{ id: string | number; name?: string }>;
  retentionEvent?: string;
  activeUserEvent?: string;
  region?: 'us' | 'eu';
  lookbackDays?: number;
}) {
  return new MixpanelConnector(
    {
      projectId: '1234567',
      ...overrides,
    },
    {
      username: 'svc-user',
      secret: 'svc-secret' as unknown as { $secret: string },
    },
  );
}

describe('configFields', () => {
  it('parses a minimal config (no events / funnels)', () => {
    const result = configFields.safeParse({
      projectId: '123456',
      username: 'svc',
      secret: { $secret: 'MIXPANEL_SECRET' },
    });
    expect(result.success).toBe(true);
  });

  it('parses a full config with events, funnels and retentionEvent', () => {
    const result = configFields.safeParse({
      projectId: '123456',
      username: 'svc',
      secret: { $secret: 'MIXPANEL_SECRET' },
      region: 'eu',
      events: ['Signed Up', 'Purchase'],
      funnels: [{ id: 999, name: 'Activation' }, { id: '1001' }],
      retentionEvent: 'Signed Up',
      activeUserEvent: 'Signed Up',
      lookbackDays: 30,
    });
    expect(result.success).toBe(true);
  });

  it('requires projectId', () => {
    const result = configFields.safeParse({
      username: 'svc',
      secret: { $secret: 'MIXPANEL_SECRET' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-numeric projectId', () => {
    const result = configFields.safeParse({
      projectId: 'abc',
      username: 'svc',
      secret: { $secret: 'MIXPANEL_SECRET' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a plain string secret (must be { $secret })', () => {
    const result = configFields.safeParse({
      projectId: '123456',
      username: 'svc',
      secret: 'literal',
    });
    expect(result.success).toBe(false);
  });
});

describe('getDateRange', () => {
  const now = Date.UTC(2025, 0, 31);

  it('uses lookbackDays for a full sync', () => {
    const r = getDateRange({ mode: 'full' }, 7, now);
    expect(r.to).toBe('2025-01-31');
    expect(r.from).toBe('2025-01-25');
  });

  it('uses the incremental lookback for mode=latest', () => {
    const r = getDateRange({ mode: 'latest' }, 90, now);
    expect(r.to).toBe('2025-01-31');
    expect(r.from).toBe('2025-01-29');
  });

  it('caps `since` to lookbackDays', () => {
    const r = getDateRange(
      { mode: 'full', since: new Date(now - 30 * 86_400_000).toISOString() },
      14,
      now,
    );
    const days = Math.round(
      (Date.parse(`${r.to}T00:00:00Z`) - Date.parse(`${r.from}T00:00:00Z`)) /
        86_400_000,
    );
    expect(days).toBe(13);
  });
});

describe('buildActiveUserSamples', () => {
  it('emits one sample per date', () => {
    const samples = buildActiveUserSamples(
      {
        data: {
          series: ['2025-01-01', '2025-01-02'],
          values: {
            'Signed Up': { '2025-01-01': 10, '2025-01-02': 12 },
          },
        },
      },
      'mixpanel_dau',
      'day',
      'Signed Up',
    );
    expect(samples).toHaveLength(2);
    expect(samples.every((s) => s.name === 'mixpanel_dau')).toBe(true);
    expect(samples.find((s) => s.ts === Date.UTC(2025, 0, 1))?.value).toBe(10);
    expect(samples.find((s) => s.ts === Date.UTC(2025, 0, 2))?.value).toBe(12);
  });
});

describe('buildEventsPerDaySamples', () => {
  it('joins general and unique series under one sample per date', () => {
    const general = {
      data: {
        series: ['2025-01-01'],
        values: { Purchase: { '2025-01-01': 50 } },
      },
    };
    const unique = {
      data: {
        series: ['2025-01-01'],
        values: { Purchase: { '2025-01-01': 30 } },
      },
    };
    const samples = buildEventsPerDaySamples(general, unique, 'Purchase');
    expect(samples).toHaveLength(1);
    expect(samples[0]!.value).toBe(50);
    expect(samples[0]!.attributes!['count']).toBe(50);
    expect(samples[0]!.attributes!['uniqueUsers']).toBe(30);
    expect(samples[0]!.attributes!['event']).toBe('Purchase');
  });
});

describe('buildFunnelSamples', () => {
  it('flattens funnel steps into one sample per (date, step)', () => {
    const samples = buildFunnelSamples(
      {
        data: {
          '2025-01-01': {
            steps: [
              { step_label: 'View', count: 100, overall_conv_ratio: 1 },
              { step_label: 'Buy', count: 25, overall_conv_ratio: 0.25 },
            ],
          },
        },
      },
      { id: 42, name: 'Activation' },
    );
    expect(samples).toHaveLength(2);
    const buyStep = samples.find(
      (s) => (s.attributes!['stepLabel'] as string) === 'Buy',
    );
    expect(buyStep?.value).toBe(25);
    expect(buyStep?.attributes!['funnelId']).toBe(42);
    expect(buyStep?.attributes!['funnelName']).toBe('Activation');
    expect(buyStep?.attributes!['conversionRate']).toBe(0.25);
  });
});

describe('buildRetentionSamples', () => {
  it('emits one sample per (cohort, period)', () => {
    const samples = buildRetentionSamples(
      {
        '2025-01-01': { first: 100, counts: [50, 25, 10] },
        '2025-01-02': { first: 80, counts: [40] },
      },
      'Signed Up',
    );
    expect(samples).toHaveLength(4);
    const day0 = samples.find(
      (s) => s.ts === Date.UTC(2025, 0, 1) && s.attributes!['period'] === 0,
    );
    expect(day0?.value).toBe(50);
    expect(day0?.attributes!['cohortSize']).toBe(100);
    expect(day0?.attributes!['retentionRate']).toBeCloseTo(0.5);
  });
});

describe('MixpanelConnector.sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns done:true when no events/funnels/retention are configured', async () => {
    vi.stubGlobal('fetch', mockFetch({}));
    const storage = makeStorage();
    const result = await makeConnector({}).sync({ mode: 'full' }, storage);
    expect(result.done).toBe(true);
    expect(storage.metrics).toHaveBeenCalled();
  });

  it('skips active-user phases when no event is configured', async () => {
    const segSpy = vi
      .fn()
      .mockReturnValue({ data: { series: [], values: {} } });
    vi.stubGlobal('fetch', mockFetch({ segmentation: segSpy }));
    const storage = makeStorage();
    await makeConnector({}).sync({ mode: 'full' }, storage);
    expect(segSpy).not.toHaveBeenCalled();
  });

  it('sends Authorization Basic header on every request', async () => {
    const fetchSpy = mockFetch({});
    vi.stubGlobal('fetch', fetchSpy);
    const storage = makeStorage();
    await makeConnector({ events: ['Signed Up'] }).sync(
      { mode: 'full' },
      storage,
    );
    const calls = fetchSpy.mock.calls.filter((c: unknown[]) =>
      String(c[0]).includes('mixpanel.com/api/2.0/segmentation'),
    );
    expect(calls.length).toBeGreaterThan(0);
    const headers = (calls[0] as [string, RequestInit])[1].headers as Record<
      string,
      string
    >;
    const authKey = Object.keys(headers).find(
      (k) => k.toLowerCase() === 'authorization',
    );
    expect(authKey).toBeDefined();
    expect(headers[authKey!]).toMatch(/^Basic /);
  });

  it('uses the EU host when region=eu is set', async () => {
    const fetchSpy = mockFetch({});
    vi.stubGlobal('fetch', fetchSpy);
    const storage = makeStorage();
    await makeConnector({ region: 'eu', events: ['Signed Up'] }).sync(
      { mode: 'full' },
      storage,
    );
    const urls = fetchSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(urls.some((u: string) => u.includes('eu.mixpanel.com'))).toBe(true);
    expect(urls.every((u: string) => !u.includes('//mixpanel.com'))).toBe(true);
  });

  it('passes project_id on every Mixpanel call', async () => {
    const fetchSpy = mockFetch({});
    vi.stubGlobal('fetch', fetchSpy);
    const storage = makeStorage();
    await makeConnector({ events: ['Signed Up'] }).sync(
      { mode: 'full' },
      storage,
    );
    const calls = fetchSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    for (const url of calls) {
      expect(new URL(url).searchParams.get('project_id')).toBe('1234567');
    }
  });

  it('writes one storage.metrics call per phase, scoped by name', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        segmentation: (params) => ({
          data: {
            series: ['2025-01-01'],
            values: {
              [params.get('event')!]: { '2025-01-01': 5 },
            },
          },
        }),
        funnels: () => ({
          data: { '2025-01-01': { steps: [{ count: 1 }] } },
        }),
        retention: () => ({ '2025-01-01': { first: 1, counts: [1] } }),
      }),
    );
    const storage = makeStorage();
    await makeConnector({
      events: ['Signed Up'],
      funnels: [{ id: 42 }],
      retentionEvent: 'Signed Up',
    }).sync({ mode: 'full' }, storage);

    const writes = storage.metrics.mock.calls.map(
      (c) => (c[1] as { names: string[] }).names[0],
    );
    expect(writes).toContain('mixpanel_dau');
    expect(writes).toContain('mixpanel_wau');
    expect(writes).toContain('mixpanel_mau');
    expect(writes).toContain('mixpanel_events_per_day');
    expect(writes).toContain('mixpanel_funnel_results');
    expect(writes).toContain('mixpanel_retention');
  });

  it('returns a resumable cursor when the abort signal trips mid-sync', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => {
        controller.abort();
        const e = new Error('aborted');
        e.name = 'AbortError';
        return Promise.reject(e);
      }),
    );
    const storage = makeStorage();
    const result = await makeConnector({ events: ['Signed Up'] }).sync(
      { mode: 'full' },
      storage,
      controller.signal,
    );
    expect(result.done).toBe(false);
    if (!result.done) {
      expect(result.cursor).toBeDefined();
      expect((result.cursor as { phase: string }).phase).toBe('dau');
    }
  });

  it('resumes from a saved cursor and reuses its dateRange', async () => {
    const fetchSpy = mockFetch({
      retention: () => ({ '2025-01-01': { first: 10, counts: [5] } }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const storage = makeStorage();
    await makeConnector({ retentionEvent: 'Signed Up' }).sync(
      {
        mode: 'full',
        cursor: {
          phase: 'retention',
          dateRange: { from: '2024-12-15', to: '2025-01-15' },
        },
      },
      storage,
    );
    const calls = fetchSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    const retentionCalls = calls.filter((u: string) =>
      u.includes('/retention'),
    );
    expect(retentionCalls.length).toBe(1);
    const url = new URL(retentionCalls[0]!);
    expect(url.searchParams.get('from_date')).toBe('2024-12-15');
    expect(url.searchParams.get('to_date')).toBe('2025-01-15');
  });

  it('honors options.resources allowlist', async () => {
    const fetchSpy = mockFetch({});
    vi.stubGlobal('fetch', fetchSpy);
    const storage = makeStorage();
    await makeConnector({
      events: ['Signed Up'],
      funnels: [{ id: 42 }],
      retentionEvent: 'Signed Up',
    }).sync(
      {
        mode: 'full',
        resources: new Set(['funnel_results']),
      },
      storage,
    );
    const calls = fetchSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(calls.some((u: string) => u.includes('/funnels'))).toBe(true);
    expect(calls.every((u: string) => !u.includes('/segmentation'))).toBe(true);
    expect(calls.every((u: string) => !u.includes('/retention'))).toBe(true);
  });
});

describe('MixpanelConnector.create', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the connector instance directly', () => {
    vi.stubEnv('MIXPANEL_SECRET', 'test-secret');
    const connector = MixpanelConnector.create({
      projectId: '1234567',
      username: 'svc-user',
      secret: { $secret: 'MIXPANEL_SECRET' },
    });
    expect(connector).toBeInstanceOf(MixpanelConnector);
    expect(connector.id).toBe('mixpanel');
  });
});
