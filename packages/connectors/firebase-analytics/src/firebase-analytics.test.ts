import { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  FirebaseAnalyticsConnector,
  configFields,
  rowToMetricSample,
} from './firebase-analytics';

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
  reportResponsesByFirstDim: Record<string, object>,
) {
  return vi.fn().mockImplementation((url: string, init: RequestInit) => {
    const urlStr = String(url);

    if (urlStr.includes('oauth2.googleapis.com/token')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify(tokenResponse)),
      } as Response);
    }

    if (urlStr.includes('analyticsdata.googleapis.com')) {
      const body = init.body
        ? (JSON.parse(String(init.body)) as {
            dimensions: Array<{ name: string }>;
          })
        : { dimensions: [] };
      const firstDim = body.dimensions?.[0]?.name ?? '';

      const resp =
        reportResponsesByFirstDim[firstDim] ?? makeEmptyReportResponse();
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify(resp)),
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

function makeConnector(): FirebaseAnalyticsConnector {
  return new FirebaseAnalyticsConnector(
    {
      propertyId: '123456789',
      firebaseAppId: '1:1234567890:web:abcdef',
    },
    {
      serviceAccountJson: undefined,
      refreshToken: 'rtoken' as unknown as { $secret: string },
      clientId: 'cid',
      clientSecret: 'csecret' as unknown as { $secret: string },
    },
  );
}

describe('configFields', () => {
  it('parses a config with propertyId, firebaseAppId and serviceAccountJson', () => {
    const result = configFields.safeParse({
      propertyId: '123456789',
      firebaseAppId: '1:1234567890:web:abcdef',
      serviceAccountJson: { $secret: 'FIREBASE_ANALYTICS_SA_JSON' },
    });
    expect(result.success).toBe(true);
  });

  it('parses a config with OAuth fields', () => {
    const result = configFields.safeParse({
      propertyId: '123456789',
      firebaseAppId: '1:1234567890:web:abcdef',
      refreshToken: { $secret: 'GA_REFRESH_TOKEN' },
      clientId: 'client_id',
      clientSecret: { $secret: 'GA_CLIENT_SECRET' },
    });
    expect(result.success).toBe(true);
  });

  it('requires propertyId', () => {
    const result = configFields.safeParse({
      firebaseAppId: '1:1234567890:web:abcdef',
      serviceAccountJson: { $secret: 'FIREBASE_ANALYTICS_SA_JSON' },
    });
    expect(result.success).toBe(false);
  });

  it('requires firebaseAppId', () => {
    const result = configFields.safeParse({
      propertyId: '123456789',
      serviceAccountJson: { $secret: 'FIREBASE_ANALYTICS_SA_JSON' },
    });
    expect(result.success).toBe(false);
  });

  it('requires either serviceAccountJson or full OAuth tuple', () => {
    const result = configFields.safeParse({
      propertyId: '123456789',
      firebaseAppId: '1:1234567890:web:abcdef',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-numeric propertyId', () => {
    const result = configFields.safeParse({
      propertyId: 'abc',
      firebaseAppId: '1:1234567890:web:abcdef',
      serviceAccountJson: { $secret: 'FIREBASE_ANALYTICS_SA_JSON' },
    });
    expect(result.success).toBe(false);
  });
});

describe('rowToMetricSample', () => {
  it('converts a dau_wau_mau row correctly', () => {
    const row = makeReportRow(['20250101'], ['1000', '5000', '20000']);
    const sample = rowToMetricSample(
      row,
      ['date'],
      ['active1DayUsers', 'active7DayUsers', 'active28DayUsers'],
      'firebase_dau_wau_mau',
      'app-id-xyz',
    );
    expect(sample.name).toBe('firebase_dau_wau_mau');
    expect(sample.ts).toBe(Date.UTC(2025, 0, 1));
    expect(sample.value).toBe(1000);
    expect(sample.attributes['active1DayUsers']).toBe(1000);
    expect(sample.attributes['active7DayUsers']).toBe(5000);
    expect(sample.attributes['active28DayUsers']).toBe(20000);
    expect(sample.attributes['firebaseAppId']).toBe('app-id-xyz');
    expect(sample.attributes['date']).toBe('20250101');
  });

  it('converts an events_per_day row with eventName dimension', () => {
    const row = makeReportRow(['20250115', 'session_start'], ['1200', '480']);
    const sample = rowToMetricSample(
      row,
      ['date', 'eventName'],
      ['eventCount', 'totalUsers'],
      'firebase_events_per_day',
      'app-id-xyz',
    );
    expect(sample.attributes['eventName']).toBe('session_start');
    expect(sample.attributes['eventCount']).toBe(1200);
    expect(sample.attributes['totalUsers']).toBe(480);
    expect(sample.value).toBe(1200);
  });

  it('computes period attribute for retention rows', () => {
    const row = makeReportRow(['20250101', '20250108'], ['42']);
    const sample = rowToMetricSample(
      row,
      ['firstSessionDate', 'date'],
      ['activeUsers'],
      'firebase_retention',
      'app-id-xyz',
    );
    expect(sample.ts).toBe(Date.UTC(2025, 0, 8));
    expect(sample.value).toBe(42);
    expect(sample.attributes['firstSessionDate']).toBe('20250101');
    expect(sample.attributes['date']).toBe('20250108');
    expect(sample.attributes['period']).toBe(7);
  });

  it('handles non-numeric metric values gracefully', () => {
    const row = makeReportRow(['20250101'], ['(not set)']);
    const sample = rowToMetricSample(
      row,
      ['date'],
      ['active1DayUsers'],
      'firebase_dau_wau_mau',
      'app-id-xyz',
    );
    expect(sample.value).toBe(0);
  });
});

describe('FirebaseAnalyticsConnector.sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('returns done:true when all phases return empty pages', async () => {
    const connector = makeConnector();
    vi.stubGlobal(
      'fetch',
      mockFetch({ access_token: 'tok', expires_in: 3600 }, {}),
    );

    const storage = makeStorage();
    const result = await connector.sync({ mode: 'full' }, storage);

    expect(result.done).toBe(true);
  });

  it('writes one metric batch per phase on full sync', async () => {
    const connector = makeConnector();

    vi.stubGlobal(
      'fetch',
      mockFetch({ access_token: 'tok', expires_in: 3600 }, {}),
    );

    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const writtenNames = storage.metrics.mock.calls.map(
      (c) => (c[1] as { names: string[] }).names[0],
    );
    expect(writtenNames).toContain('firebase_dau_wau_mau');
    expect(writtenNames).toContain('firebase_events_per_day');
    expect(writtenNames).toContain('firebase_retention');
  });

  it('writes metric samples for returned rows', async () => {
    const connector = makeConnector();

    const dauReport = {
      rows: [makeReportRow(['20250101'], ['1000', '5000', '20000'])],
      rowCount: 1,
      dimensionHeaders: [{ name: 'date' }],
      metricHeaders: [
        { name: 'active1DayUsers', type: 'TYPE_INTEGER' },
        { name: 'active7DayUsers', type: 'TYPE_INTEGER' },
        { name: 'active28DayUsers', type: 'TYPE_INTEGER' },
      ],
    };

    vi.stubGlobal(
      'fetch',
      mockFetch({ access_token: 'tok', expires_in: 3600 }, { date: dauReport }),
    );

    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const dauCall = storage.metrics.mock.calls.find(
      (c) => (c[1] as { names: string[] }).names[0] === 'firebase_dau_wau_mau',
    );
    expect(dauCall).toBeDefined();
    const samples = dauCall![0] as Array<{
      name: string;
      value: number;
      attributes: Record<string, string | number>;
    }>;
    expect(samples).toHaveLength(1);
    expect(samples[0]!.value).toBe(1000);
    expect(samples[0]!.attributes['firebaseAppId']).toBe(
      '1:1234567890:web:abcdef',
    );
  });

  it('uses the configured propertyId in the report URL', async () => {
    const connector = new FirebaseAnalyticsConnector(
      { propertyId: '987654321', firebaseAppId: 'app-xyz' },
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

  it('sends Authorization header with Bearer token', async () => {
    const connector = makeConnector();

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

  it('resumes from a saved cursor', async () => {
    const connector = makeConnector();
    const fetchSpy = mockFetch({ access_token: 'tok', expires_in: 3600 }, {});
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector.sync(
      {
        mode: 'full',
        cursor: {
          phase: 'retention',
          dateRange: { startDate: '2025-01-01', endDate: '2025-01-31' },
        },
      },
      storage,
    );

    const ga4Calls = fetchSpy.mock.calls.filter((c: unknown[]) =>
      String(c[0]).includes('analyticsdata.googleapis.com'),
    );
    expect(ga4Calls.length).toBeGreaterThan(0);

    const firstBody = JSON.parse(
      String((ga4Calls[0] as [string, { body: string }])[1].body),
    ) as {
      dimensions: Array<{ name: string }>;
      dateRanges: Array<{ startDate: string; endDate: string }>;
    };
    const dimNames = firstBody.dimensions.map((d) => d.name);
    expect(dimNames).toContain('firstSessionDate');
    expect(firstBody.dateRanges[0]!.startDate).toBe('2025-01-01');
    expect(firstBody.dateRanges[0]!.endDate).toBe('2025-01-31');
  });

  it('honors options.resources by skipping phases not in the allowlist', async () => {
    const connector = makeConnector();
    const fetchSpy = mockFetch({ access_token: 'tok', expires_in: 3600 }, {});
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector.sync(
      {
        mode: 'full',
        resources: new Set(['firebase_dau_wau_mau']),
      },
      storage,
    );

    const ga4Calls = fetchSpy.mock.calls.filter((c: unknown[]) =>
      String(c[0]).includes('analyticsdata.googleapis.com'),
    );
    const dimensionSets = ga4Calls.map((c) => {
      const body = JSON.parse(
        String((c as [string, { body: string }])[1].body),
      ) as { dimensions: Array<{ name: string }> };
      return body.dimensions.map((d) => d.name).join(',');
    });
    expect(dimensionSets.every((d) => d === 'date')).toBe(true);

    const writtenNames = new Set(
      storage.metrics.mock.calls.map(
        (c) => (c[1] as { names: string[] }).names[0],
      ),
    );
    expect(writtenNames).toEqual(new Set(['firebase_dau_wau_mau']));
  });

  it('does not wipe older history when an incremental sync returns no rows', async () => {
    const connector = makeConnector();
    vi.stubGlobal(
      'fetch',
      mockFetch({ access_token: 'tok', expires_in: 3600 }, {}),
    );

    const storage = new InMemoryStorage();
    const handle = storage.getStorageHandle('firebase-analytics');
    const oldTs = Date.now() - 60 * 24 * 60 * 60 * 1000;
    await handle.metric({
      name: 'firebase_dau_wau_mau',
      ts: oldTs,
      value: 123,
      attributes: { firebaseAppId: '1:1234567890:web:abcdef' },
    });

    await connector.sync(
      { mode: 'latest', since: new Date().toISOString() },
      handle,
    );

    const surviving = await handle.queryMetrics({
      name: 'firebase_dau_wau_mau',
    });
    expect(surviving.map((m) => m.ts)).toContain(oldTs);
  });

  it('returns a resumable cursor when the abort signal trips mid-drain', async () => {
    const connector = makeConnector();

    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
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
      ).toBe('dau_wau_mau');
    }
  });
});

describe('FirebaseAnalyticsConnector.create', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the connector instance directly', () => {
    vi.stubEnv('FA_REFRESH_TOKEN', 'test-refresh-token');
    vi.stubEnv('FA_CLIENT_SECRET', 'test-client-secret');
    const connector = FirebaseAnalyticsConnector.create({
      propertyId: '123456789',
      firebaseAppId: '1:1234567890:web:abcdef',
      refreshToken: { $secret: 'FA_REFRESH_TOKEN' },
      clientId: 'my-client-id',
      clientSecret: { $secret: 'FA_CLIENT_SECRET' },
    });
    expect(connector).toBeInstanceOf(FirebaseAnalyticsConnector);
    expect(connector.id).toBe('firebase-analytics');
  });
});
