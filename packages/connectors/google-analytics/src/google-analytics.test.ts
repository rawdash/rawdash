import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  GA4Connector,
  configFields,
  rowToMetricSample,
} from './google-analytics';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function makeEmptyReportResponse() {
  return {
    rows: [],
    rowCount: 0,
    dimensionHeaders: [],
    metricHeaders: [],
  };
}

function makeReportRow(dimensionValues: string[], metricValues: string[]) {
  return {
    dimensionValues: dimensionValues.map((v) => ({ value: v })),
    metricValues: metricValues.map((v) => ({ value: v })),
  };
}

function mockFetch(
  tokenResponse: object,
  reportResponsesByPhase: Record<string, object>,
) {
  return vi.fn().mockImplementation((url: string, init: RequestInit) => {
    const urlStr = String(url);

    // Token endpoint
    if (urlStr.includes('oauth2.googleapis.com/token')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify(tokenResponse)),
      } as Response);
    }

    // GA4 runReport endpoint
    if (urlStr.includes('analyticsdata.googleapis.com')) {
      const body = init.body
        ? (JSON.parse(String(init.body)) as {
            dimensions: Array<{ name: string }>;
          })
        : { dimensions: [] };
      const firstDim = body.dimensions?.[0]?.name ?? '';

      for (const [key, resp] of Object.entries(reportResponsesByPhase)) {
        if (key === firstDim || urlStr.includes(key)) {
          return Promise.resolve({
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: new Headers({ 'content-type': 'application/json' }),
            text: () => Promise.resolve(JSON.stringify(resp)),
          } as Response);
        }
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify(makeEmptyReportResponse())),
      } as Response);
    }

    return Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      text: () => Promise.resolve(JSON.stringify(makeEmptyReportResponse())),
    } as Response);
  });
}

// ---------------------------------------------------------------------------
// configFields
// ---------------------------------------------------------------------------

describe('configFields', () => {
  it('parses a config with propertyId and serviceAccountJson', () => {
    const result = configFields.safeParse({
      propertyId: '123456789',
      serviceAccountJson: { $secret: 'GA_SA_JSON' },
    });
    expect(result.success).toBe(true);
  });

  it('parses a config with propertyId and OAuth fields', () => {
    const result = configFields.safeParse({
      propertyId: '123456789',
      refreshToken: { $secret: 'GA_REFRESH_TOKEN' },
      clientId: 'client_id',
      clientSecret: { $secret: 'GA_CLIENT_SECRET' },
    });
    expect(result.success).toBe(true);
  });

  it('requires propertyId', () => {
    const result = configFields.safeParse({
      serviceAccountJson: { $secret: 'GA_SA_JSON' },
    });
    expect(result.success).toBe(false);
  });

  it('accepts optional lookbackDays', () => {
    const result = configFields.safeParse({
      propertyId: '123456789',
      serviceAccountJson: { $secret: 'GA_SA_JSON' },
      lookbackDays: 30,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lookbackDays).toBe(30);
    }
  });

  it('rejects plain string for serviceAccountJson (must be secret object)', () => {
    const result = configFields.safeParse({
      propertyId: '123456789',
      serviceAccountJson: 'raw-json-string',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// rowToMetricSample
// ---------------------------------------------------------------------------

describe('rowToMetricSample', () => {
  it('converts a traffic_by_day row correctly', () => {
    const row = makeReportRow(
      ['20250101'],
      ['500', '400', '100', '1200', '0.65'],
    );
    const sample = rowToMetricSample(
      row,
      ['date'],
      [
        'sessions',
        'totalUsers',
        'newUsers',
        'screenPageViews',
        'engagementRate',
      ],
      'ga4_traffic_by_day',
    );
    expect(sample.name).toBe('ga4_traffic_by_day');
    expect(sample.ts).toBe(Date.UTC(2025, 0, 1));
    expect(sample.value).toBe(500);
    expect(sample.attributes['sessions']).toBe(500);
    expect(sample.attributes['totalUsers']).toBe(400);
    expect(sample.attributes['engagementRate']).toBeCloseTo(0.65);
    expect(sample.attributes['date']).toBe('20250101');
  });

  it('converts a traffic_by_source row with extra dimensions', () => {
    const row = makeReportRow(['20250115', 'google', 'organic'], ['300', '12']);
    const sample = rowToMetricSample(
      row,
      ['date', 'sessionSource', 'sessionMedium'],
      ['sessions', 'conversions'],
      'ga4_traffic_by_source',
    );
    expect(sample.attributes['sessionSource']).toBe('google');
    expect(sample.attributes['sessionMedium']).toBe('organic');
    expect(sample.attributes['sessions']).toBe(300);
    expect(sample.attributes['conversions']).toBe(12);
  });

  it('handles non-numeric metric values gracefully', () => {
    const row = makeReportRow(['20250101'], ['(not set)']);
    const sample = rowToMetricSample(row, ['date'], ['sessions'], 'ga4_events');
    expect(sample.value).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// GA4Connector.sync
// ---------------------------------------------------------------------------

describe('GA4Connector.sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('returns done:true when all phases return empty pages', async () => {
    const connector = new GA4Connector(
      { propertyId: '123456789' },
      {
        serviceAccountJson: undefined,
        refreshToken: 'rtoken' as unknown as { $secret: string },
        clientId: 'cid',
        clientSecret: 'csecret' as unknown as { $secret: string },
      },
    );

    vi.stubGlobal(
      'fetch',
      mockFetch({ access_token: 'tok', expires_in: 3600 }, {}),
    );

    const storage = makeStorage();
    const result = await connector.sync({ mode: 'full' }, storage);

    expect(result.done).toBe(true);
  });

  it('clears metric names at the start of each phase on full sync', async () => {
    const connector = new GA4Connector(
      { propertyId: '123456789' },
      {
        serviceAccountJson: undefined,
        refreshToken: 'rtoken' as unknown as { $secret: string },
        clientId: 'cid',
        clientSecret: 'csecret' as unknown as { $secret: string },
      },
    );

    vi.stubGlobal(
      'fetch',
      mockFetch({ access_token: 'tok', expires_in: 3600 }, {}),
    );

    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const metricsClearCalls = storage.metrics.mock.calls.filter(
      (c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0,
    );
    const clearedNames = metricsClearCalls.map(
      (c) => (c[1] as { names: string[] }).names[0],
    );

    expect(clearedNames).toContain('ga4_traffic_by_day');
    expect(clearedNames).toContain('ga4_traffic_by_source');
    expect(clearedNames).toContain('ga4_top_pages');
    expect(clearedNames).toContain('ga4_events');
    expect(clearedNames).toContain('ga4_conversions');
    expect(clearedNames).toContain('ga4_geo');
  });

  it('writes metric samples for returned rows', async () => {
    const connector = new GA4Connector(
      { propertyId: '123456789' },
      {
        serviceAccountJson: undefined,
        refreshToken: 'rtoken' as unknown as { $secret: string },
        clientId: 'cid',
        clientSecret: 'csecret' as unknown as { $secret: string },
      },
    );

    const trafficReport = {
      rows: [
        makeReportRow(['20250101'], ['500', '400', '100', '1200', '0.65']),
      ],
      rowCount: 1,
      dimensionHeaders: [{ name: 'date' }],
      metricHeaders: [
        { name: 'sessions', type: 'TYPE_INTEGER' },
        { name: 'totalUsers', type: 'TYPE_INTEGER' },
        { name: 'newUsers', type: 'TYPE_INTEGER' },
        { name: 'screenPageViews', type: 'TYPE_INTEGER' },
        { name: 'engagementRate', type: 'TYPE_FLOAT' },
      ],
    };

    vi.stubGlobal(
      'fetch',
      mockFetch(
        { access_token: 'tok', expires_in: 3600 },
        { date: trafficReport },
      ),
    );

    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const metricCalls = storage.metric.mock.calls;
    const trafficCall = metricCalls.find(
      (c) => (c[0] as { name: string }).name === 'ga4_traffic_by_day',
    );
    expect(trafficCall).toBeDefined();
    expect((trafficCall![0] as { value: number }).value).toBe(500);
  });

  it('resumes from a saved cursor', async () => {
    const connector = new GA4Connector(
      { propertyId: '123456789' },
      {
        serviceAccountJson: undefined,
        refreshToken: 'rtoken' as unknown as { $secret: string },
        clientId: 'cid',
        clientSecret: 'csecret' as unknown as { $secret: string },
      },
    );

    const fetchSpy = mockFetch({ access_token: 'tok', expires_in: 3600 }, {});
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector.sync(
      {
        mode: 'full',
        cursor: {
          phase: 'geo',
          page: {
            offset: 0,
            startDate: '2025-01-01',
            endDate: '2025-01-31',
          },
        },
      },
      storage,
    );

    // Only GA4 calls should be for phases from 'geo' onwards
    const ga4Calls = fetchSpy.mock.calls.filter((c: unknown[]) =>
      String(c[0]).includes('analyticsdata.googleapis.com'),
    );

    // There should be at least one call (for geo phase)
    expect(ga4Calls.length).toBeGreaterThan(0);

    // The body of the first GA4 call should have country dimension (geo phase)
    const firstGa4Body = JSON.parse(
      String((ga4Calls[0] as [string, { body: string }])[1].body),
    ) as {
      dimensions: Array<{ name: string }>;
      dateRanges: Array<{ startDate: string; endDate: string }>;
    };
    const dimNames = firstGa4Body.dimensions.map((d) => d.name);
    expect(dimNames).toContain('country');

    expect(firstGa4Body.dateRanges[0]!.startDate).toBe('2025-01-01');
    expect(firstGa4Body.dateRanges[0]!.endDate).toBe('2025-01-31');
  });

  it('sends Authorization header with Bearer token', async () => {
    const connector = new GA4Connector(
      { propertyId: '123456789' },
      {
        serviceAccountJson: undefined,
        refreshToken: 'rtoken' as unknown as { $secret: string },
        clientId: 'cid',
        clientSecret: 'csecret' as unknown as { $secret: string },
      },
    );

    const fetchSpy = mockFetch(
      { access_token: 'test-access-token', expires_in: 3600 },
      {},
    );
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const ga4Calls = fetchSpy.mock.calls.filter((c: unknown[]) =>
      String(c[0]).includes('analyticsdata.googleapis.com'),
    );
    const headers = (
      ga4Calls[0] as [string, { headers: Record<string, string> }]
    )[1].headers;
    const authHeaderKey = Object.keys(headers).find(
      (k) => k.toLowerCase() === 'authorization',
    );
    expect(authHeaderKey).toBeDefined();
    expect(headers[authHeaderKey!]).toBe('Bearer test-access-token');
  });

  it('uses the configured propertyId in the report URL', async () => {
    const connector = new GA4Connector(
      { propertyId: '987654321' },
      {
        serviceAccountJson: undefined,
        refreshToken: 'rtoken' as unknown as { $secret: string },
        clientId: 'cid',
        clientSecret: 'csecret' as unknown as { $secret: string },
      },
    );

    const fetchSpy = mockFetch({ access_token: 'tok', expires_in: 3600 }, {});
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const ga4Calls = fetchSpy.mock.calls.filter((c: unknown[]) =>
      String(c[0]).includes('analyticsdata.googleapis.com'),
    );
    expect(ga4Calls.length).toBeGreaterThan(0);
    const url = String((ga4Calls[0] as [string])[0]);
    expect(url).toContain('987654321');
  });
});

// ---------------------------------------------------------------------------
// GA4Connector.create
// ---------------------------------------------------------------------------

describe('GA4Connector.create', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns a connector wrapped in the expected shape', () => {
    vi.stubEnv('GA_REFRESH_TOKEN', 'test-refresh-token');
    vi.stubEnv('GA_CLIENT_SECRET', 'test-client-secret');
    const entry = GA4Connector.create({
      propertyId: '123456789',
      refreshToken: { $secret: 'GA_REFRESH_TOKEN' },
      clientId: 'my-client-id',
      clientSecret: { $secret: 'GA_CLIENT_SECRET' },
    });
    expect(entry.connector).toBeInstanceOf(GA4Connector);
    expect(entry.connector.id).toBe('google-analytics');
  });
});
