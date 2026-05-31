import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  GSCConnector,
  configFields,
  rowToMetricSample,
} from './google-search-console';

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
  return { rows: [] };
}

function makeReportRow(
  keys: string[],
  metrics: {
    clicks?: number;
    impressions?: number;
    ctr?: number;
    position?: number;
  } = {},
) {
  return { keys, ...metrics };
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

    // GSC searchAnalytics endpoint
    if (urlStr.includes('searchconsole.googleapis.com')) {
      const body = init.body
        ? (JSON.parse(String(init.body)) as { dimensions: string[] })
        : { dimensions: [] };
      const secondDim = body.dimensions?.[1] ?? '';
      const phaseKey = secondDim || 'date_only';

      for (const [key, resp] of Object.entries(reportResponsesByPhase)) {
        if (key === phaseKey || (key === 'date_only' && !secondDim)) {
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
  it('parses a config with siteUrl and serviceAccountJson', () => {
    const result = configFields.safeParse({
      siteUrl: 'https://example.com/',
      serviceAccountJson: { $secret: 'GSC_SA_JSON' },
    });
    expect(result.success).toBe(true);
  });

  it('parses a config with siteUrl and OAuth fields', () => {
    const result = configFields.safeParse({
      siteUrl: 'sc-domain:example.com',
      refreshToken: { $secret: 'GSC_REFRESH_TOKEN' },
      clientId: 'client_id',
      clientSecret: { $secret: 'GSC_CLIENT_SECRET' },
    });
    expect(result.success).toBe(true);
  });

  it('requires siteUrl', () => {
    const result = configFields.safeParse({
      serviceAccountJson: { $secret: 'GSC_SA_JSON' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty siteUrl', () => {
    const result = configFields.safeParse({
      siteUrl: '',
      serviceAccountJson: { $secret: 'GSC_SA_JSON' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects refreshToken without clientId/clientSecret', () => {
    const result = configFields.safeParse({
      siteUrl: 'https://example.com/',
      refreshToken: { $secret: 'GSC_REFRESH_TOKEN' },
    });
    expect(result.success).toBe(false);
  });

  it('accepts optional lookbackDays', () => {
    const result = configFields.safeParse({
      siteUrl: 'https://example.com/',
      serviceAccountJson: { $secret: 'GSC_SA_JSON' },
      lookbackDays: 30,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lookbackDays).toBe(30);
    }
  });

  it('rejects plain string for serviceAccountJson (must be secret object)', () => {
    const result = configFields.safeParse({
      siteUrl: 'https://example.com/',
      serviceAccountJson: 'raw-json-string',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// rowToMetricSample
// ---------------------------------------------------------------------------

describe('rowToMetricSample', () => {
  it('converts a daily row correctly', () => {
    const row = makeReportRow(['2025-01-01'], {
      clicks: 123,
      impressions: 4567,
      ctr: 0.027,
      position: 4.2,
    });
    const sample = rowToMetricSample(
      row,
      ['date'],
      'gsc_search_analytics_by_day',
    );
    expect(sample.name).toBe('gsc_search_analytics_by_day');
    expect(sample.ts).toBe(Date.UTC(2025, 0, 1));
    expect(sample.value).toBe(123);
    expect(sample.attributes['clicks']).toBe(123);
    expect(sample.attributes['impressions']).toBe(4567);
    expect(sample.attributes['ctr']).toBeCloseTo(0.027);
    expect(sample.attributes['position']).toBeCloseTo(4.2);
    expect(sample.attributes['date']).toBe('2025-01-01');
  });

  it('converts a top-queries row with the query dimension', () => {
    const row = makeReportRow(['2025-01-15', 'rawdash dashboards'], {
      clicks: 5,
      impressions: 200,
      ctr: 0.025,
      position: 12.5,
    });
    const sample = rowToMetricSample(row, ['date', 'query'], 'gsc_top_queries');
    expect(sample.attributes['query']).toBe('rawdash dashboards');
    expect(sample.attributes['clicks']).toBe(5);
    expect(sample.value).toBe(5);
  });

  it('defaults missing metric fields to 0', () => {
    const row = makeReportRow(['2025-01-01']);
    const sample = rowToMetricSample(
      row,
      ['date'],
      'gsc_search_analytics_by_day',
    );
    expect(sample.attributes['clicks']).toBe(0);
    expect(sample.attributes['impressions']).toBe(0);
    expect(sample.attributes['ctr']).toBe(0);
    expect(sample.attributes['position']).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// GSCConnector.sync
// ---------------------------------------------------------------------------

describe('GSCConnector.sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('returns done:true when all phases return empty pages', async () => {
    const connector = new GSCConnector(
      { siteUrl: 'https://example.com/' },
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

  it('writes one storage.metrics call per phase', async () => {
    const connector = new GSCConnector(
      { siteUrl: 'https://example.com/' },
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

    const clearedNames = storage.metrics.mock.calls.map(
      (c) => (c[1] as { names: string[] }).names[0],
    );

    expect(clearedNames).toContain('gsc_search_analytics_by_day');
    expect(clearedNames).toContain('gsc_top_queries');
    expect(clearedNames).toContain('gsc_top_pages');
    expect(clearedNames).toContain('gsc_top_countries');
  });

  it('writes metric samples for returned rows', async () => {
    const connector = new GSCConnector(
      { siteUrl: 'https://example.com/' },
      {
        serviceAccountJson: undefined,
        refreshToken: 'rtoken' as unknown as { $secret: string },
        clientId: 'cid',
        clientSecret: 'csecret' as unknown as { $secret: string },
      },
    );

    const dailyReport = {
      rows: [
        makeReportRow(['2025-01-01'], {
          clicks: 100,
          impressions: 1000,
          ctr: 0.1,
          position: 5.5,
        }),
      ],
    };

    vi.stubGlobal(
      'fetch',
      mockFetch(
        { access_token: 'tok', expires_in: 3600 },
        { date_only: dailyReport },
      ),
    );

    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const dailyCall = storage.metrics.mock.calls.find(
      (c) =>
        (c[1] as { names: string[] }).names[0] ===
        'gsc_search_analytics_by_day',
    );
    expect(dailyCall).toBeDefined();
    const samples = dailyCall![0] as Array<{ name: string; value: number }>;
    expect(samples).toHaveLength(1);
    expect(samples[0]!.value).toBe(100);
  });

  it('resumes from a saved cursor', async () => {
    const connector = new GSCConnector(
      { siteUrl: 'https://example.com/' },
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
          phase: 'top_countries',
          dateRange: { startDate: '2025-01-01', endDate: '2025-01-31' },
        },
      },
      storage,
    );

    const gscCalls = fetchSpy.mock.calls.filter((c: unknown[]) =>
      String(c[0]).includes('searchconsole.googleapis.com'),
    );

    expect(gscCalls.length).toBeGreaterThan(0);

    const firstBody = JSON.parse(
      String((gscCalls[0] as [string, { body: string }])[1].body),
    ) as {
      dimensions: string[];
      startDate: string;
      endDate: string;
    };
    expect(firstBody.dimensions).toContain('country');
    expect(firstBody.startDate).toBe('2025-01-01');
    expect(firstBody.endDate).toBe('2025-01-31');
  });

  it('sends Authorization header with Bearer token', async () => {
    const connector = new GSCConnector(
      { siteUrl: 'https://example.com/' },
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

    const gscCalls = fetchSpy.mock.calls.filter((c: unknown[]) =>
      String(c[0]).includes('searchconsole.googleapis.com'),
    );
    const headers = (
      gscCalls[0] as [string, { headers: Record<string, string> }]
    )[1].headers;
    const authHeaderKey = Object.keys(headers).find(
      (k) => k.toLowerCase() === 'authorization',
    );
    expect(authHeaderKey).toBeDefined();
    expect(headers[authHeaderKey!]).toBe('Bearer test-access-token');
  });

  it('encodes the siteUrl in the report URL', async () => {
    const connector = new GSCConnector(
      { siteUrl: 'sc-domain:example.com' },
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

    const gscCalls = fetchSpy.mock.calls.filter((c: unknown[]) =>
      String(c[0]).includes('searchconsole.googleapis.com'),
    );
    expect(gscCalls.length).toBeGreaterThan(0);
    const url = String((gscCalls[0] as [string])[0]);
    // 'sc-domain:example.com' encoded - the colon becomes %3A
    expect(url).toContain('sc-domain%3Aexample.com');
  });

  it('uses the cursor dateRange for every remaining phase on resume', async () => {
    const connector = new GSCConnector(
      { siteUrl: 'https://example.com/' },
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
    // Resume at phase 'top_pages' - phases 'top_pages' and 'top_countries'
    // should both use the cursor's dateRange, not a recomputed one.
    await connector.sync(
      {
        mode: 'full',
        cursor: {
          phase: 'top_pages',
          dateRange: { startDate: '2024-12-15', endDate: '2025-01-15' },
        },
      },
      storage,
    );

    const gscBodies = fetchSpy.mock.calls
      .filter((c: unknown[]) =>
        String(c[0]).includes('searchconsole.googleapis.com'),
      )
      .map(
        (c) =>
          JSON.parse(String((c as [string, { body: string }])[1].body)) as {
            startDate: string;
            endDate: string;
          },
      );

    expect(gscBodies.length).toBeGreaterThanOrEqual(2);
    for (const body of gscBodies) {
      expect(body.startDate).toBe('2024-12-15');
      expect(body.endDate).toBe('2025-01-15');
    }
  });

  it('writes each phase atomically via a single storage.metrics call', async () => {
    const connector = new GSCConnector(
      { siteUrl: 'https://example.com/' },
      {
        serviceAccountJson: undefined,
        refreshToken: 'rtoken' as unknown as { $secret: string },
        clientId: 'cid',
        clientSecret: 'csecret' as unknown as { $secret: string },
      },
    );

    // Build a full ROWS_PER_PAGE first page, then a short second page so the
    // loop terminates via the short-page heuristic. Both must be drained
    // before a single writeBatch fires for the phase.
    const fullPage: Array<{ keys: string[]; clicks: number }> = [];
    for (let i = 0; i < 25000; i++) {
      fullPage.push({ keys: ['2025-01-01'], clicks: 1 });
    }
    const responses = [
      { rows: fullPage },
      { rows: [{ keys: ['2025-01-02'], clicks: 1 }] },
    ];

    let dailyIdx = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string, init: RequestInit) => {
        const urlStr = String(url);
        if (urlStr.includes('oauth2.googleapis.com/token')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: new Headers({ 'content-type': 'application/json' }),
            text: () =>
              Promise.resolve(
                JSON.stringify({ access_token: 'tok', expires_in: 3600 }),
              ),
          } as Response);
        }
        const body = init.body
          ? (JSON.parse(String(init.body)) as { dimensions: string[] })
          : { dimensions: [] };
        const isDailyPhase = body.dimensions?.length === 1;
        const resp =
          isDailyPhase && dailyIdx < responses.length
            ? responses[dailyIdx++]
            : makeEmptyReportResponse();
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(resp)),
        } as Response);
      }),
    );

    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const dailyWrites = storage.metrics.mock.calls.filter(
      (c) =>
        (c[1] as { names: string[] }).names[0] ===
        'gsc_search_analytics_by_day',
    );
    expect(dailyWrites).toHaveLength(1);
    expect((dailyWrites[0]![0] as Array<unknown>).length).toBe(25001);
    expect(storage.metric).not.toHaveBeenCalled();
  });

  it('returns a resumable cursor when the abort signal trips mid-drain', async () => {
    const connector = new GSCConnector(
      { siteUrl: 'https://example.com/' },
      {
        serviceAccountJson: undefined,
        refreshToken: 'rtoken' as unknown as { $secret: string },
        clientId: 'cid',
        clientSecret: 'csecret' as unknown as { $secret: string },
      },
    );

    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation((url: string, init: RequestInit | undefined) => {
          const urlStr = String(url);
          if (urlStr.includes('oauth2.googleapis.com/token')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              statusText: 'OK',
              headers: new Headers({ 'content-type': 'application/json' }),
              text: () =>
                Promise.resolve(
                  JSON.stringify({ access_token: 'tok', expires_in: 3600 }),
                ),
            } as Response);
          }
          controller.abort();
          const abortError = new Error('aborted');
          abortError.name = 'AbortError';
          void init;
          return Promise.reject(abortError);
        }),
    );

    const storage = makeStorage();
    const result = await connector.sync(
      { mode: 'full' },
      storage,
      controller.signal,
    );

    expect(result.done).toBe(false);
    if (!result.done) {
      expect(result.cursor).toBeDefined();
      expect(
        (result.cursor as { phase: string; dateRange: object }).phase,
      ).toBe('search_analytics_by_day');
      expect(
        (result.cursor as { dateRange: { startDate: string } }).dateRange
          .startDate,
      ).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

// ---------------------------------------------------------------------------
// GSCConnector.create
// ---------------------------------------------------------------------------

describe('GSCConnector.create', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the connector instance directly', () => {
    vi.stubEnv('GSC_REFRESH_TOKEN', 'test-refresh-token');
    vi.stubEnv('GSC_CLIENT_SECRET', 'test-client-secret');
    const connector = GSCConnector.create({
      siteUrl: 'https://example.com/',
      refreshToken: { $secret: 'GSC_REFRESH_TOKEN' },
      clientId: 'my-client-id',
      clientSecret: { $secret: 'GSC_CLIENT_SECRET' },
    });
    expect(connector).toBeInstanceOf(GSCConnector);
    expect(connector.id).toBe('google-search-console');
  });
});
