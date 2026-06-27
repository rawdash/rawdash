import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  GooglePlayConsoleConnector,
  configFields,
  reviewToRatingSample,
  rowToMetricSample,
} from './google-play-console';

async function generateTestPrivateKeyPem(): Promise<string> {
  const { privateKey } = await globalThis.crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );
  const pkcs8 = new Uint8Array(
    await globalThis.crypto.subtle.exportKey('pkcs8', privateKey),
  );
  let binary = '';
  for (let i = 0; i < pkcs8.length; i++) {
    binary += String.fromCharCode(pkcs8[i]!);
  }
  const lines = btoa(binary).match(/.{1,64}/g) ?? [];
  return `-----BEGIN PRIVATE KEY-----\n${lines.join('\n')}\n-----END PRIVATE KEY-----`;
}

const TEST_PRIVATE_KEY = await generateTestPrivateKeyPem();

const TEST_SA_JSON = JSON.stringify({
  client_email: 'test-sa@test-project.iam.gserviceaccount.com',
  private_key: TEST_PRIVATE_KEY,
  token_uri: 'https://oauth2.googleapis.com/token',
});

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

function dailyRow(date: string, metrics: Record<string, number>) {
  const [year, month, day] = date.split('-').map(Number) as [
    number,
    number,
    number,
  ];
  return {
    startTime: { year, month, day },
    metrics: Object.entries(metrics).map(([m, v]) => ({
      metric: m,
      decimalValue: { value: String(v) },
    })),
  };
}

interface MetricSetSpec {
  rows?: Array<{
    startTime: { year: number; month: number; day: number };
    metrics?: Array<{ metric: string; decimalValue?: { value: string } }>;
  }>;
  nextPageToken?: string;
}

function mockFetch(
  tokenResponse: object,
  metricSetResponses: Record<string, MetricSetSpec>,
  reviewsResponse?: object,
) {
  return vi.fn().mockImplementation((url: string, _init?: RequestInit) => {
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

    if (urlStr.includes('androidpublisher.googleapis.com')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () =>
          Promise.resolve(JSON.stringify(reviewsResponse ?? { reviews: [] })),
      } as Response);
    }

    if (urlStr.includes('playdeveloperreporting.googleapis.com')) {
      const match = urlStr.match(/(\w+MetricSet):query$/);
      const setName = match ? match[1]! : '';
      const resp = metricSetResponses[setName] ?? { rows: [] };
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
      text: () => Promise.resolve('{}'),
    } as Response);
  });
}

describe('configFields', () => {
  it('parses a config with packageName and serviceAccountJson', () => {
    const result = configFields.safeParse({
      packageName: 'com.example.app',
      serviceAccountJson: { $secret: 'GPLAY_SA' },
    });
    expect(result.success).toBe(true);
  });

  it('requires packageName', () => {
    const result = configFields.safeParse({
      serviceAccountJson: { $secret: 'GPLAY_SA' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid packageName', () => {
    const result = configFields.safeParse({
      packageName: 'not a package',
      serviceAccountJson: { $secret: 'GPLAY_SA' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a single-segment package id', () => {
    const result = configFields.safeParse({
      packageName: 'example',
      serviceAccountJson: { $secret: 'GPLAY_SA' },
    });
    expect(result.success).toBe(false);
  });

  it('requires the service account secret', () => {
    const result = configFields.safeParse({
      packageName: 'com.example.app',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty serviceAccountJson secret', () => {
    const result = configFields.safeParse({
      packageName: 'com.example.app',
      serviceAccountJson: { $secret: '' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects plain string for serviceAccountJson', () => {
    const result = configFields.safeParse({
      packageName: 'com.example.app',
      serviceAccountJson: 'raw-json',
    });
    expect(result.success).toBe(false);
  });

  it('accepts optional lookbackDays', () => {
    const result = configFields.safeParse({
      packageName: 'com.example.app',
      serviceAccountJson: { $secret: 'GPLAY_SA' },
      lookbackDays: 7,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lookbackDays).toBe(7);
    }
  });

  it('rejects non-positive lookbackDays', () => {
    const result = configFields.safeParse({
      packageName: 'com.example.app',
      serviceAccountJson: { $secret: 'GPLAY_SA' },
      lookbackDays: 0,
    });
    expect(result.success).toBe(false);
  });
});

describe('rowToMetricSample', () => {
  it('maps a Play Reporting row to a metric sample with date and package_name', () => {
    const row = dailyRow('2025-04-12', {
      crashRate: 0.034,
      distinctUsers: 4200,
    });
    const sample = rowToMetricSample(
      row,
      ['crashRate', 'distinctUsers'],
      'gplay_crash_rate_by_day',
      'crashRate',
      'com.example.app',
    );
    expect(sample).not.toBeNull();
    expect(sample!.name).toBe('gplay_crash_rate_by_day');
    expect(sample!.ts).toBe(Date.UTC(2025, 3, 12));
    expect(sample!.value).toBeCloseTo(0.034);
    expect(sample!.attributes['date']).toBe('2025-04-12');
    expect(sample!.attributes['package_name']).toBe('com.example.app');
    expect(sample!.attributes['crashRate']).toBeCloseTo(0.034);
    expect(sample!.attributes['distinctUsers']).toBe(4200);
  });

  it('defaults missing metric fields to 0', () => {
    const row = { startTime: { year: 2025, month: 1, day: 1 }, metrics: [] };
    const sample = rowToMetricSample(
      row,
      ['errorReportCount', 'distinctUsers'],
      'gplay_error_count_by_day',
      'errorReportCount',
      'com.example.app',
    );
    expect(sample).not.toBeNull();
    expect(sample!.attributes['errorReportCount']).toBe(0);
    expect(sample!.attributes['distinctUsers']).toBe(0);
    expect(sample!.value).toBe(0);
  });

  it('returns null when startTime is missing', () => {
    const sample = rowToMetricSample(
      { metrics: [] },
      ['crashRate'],
      'gplay_crash_rate_by_day',
      'crashRate',
      'com.example.app',
    );
    expect(sample).toBeNull();
  });
});

describe('reviewToRatingSample', () => {
  it('maps a user review to a star-rating sample', () => {
    const sample = reviewToRatingSample(
      {
        reviewId: 'rev-9',
        comments: [
          {
            userComment: {
              starRating: 3,
              lastModified: { seconds: '1690000000', nanos: 500000000 },
            },
          },
        ],
      },
      'com.example.app',
    );
    expect(sample).not.toBeNull();
    expect(sample!.name).toBe('gplay_app_ratings');
    expect(sample!.value).toBe(3);
    expect(sample!.ts).toBe(1690000000 * 1000 + 500);
    expect(sample!.attributes['review_id']).toBe('rev-9');
  });

  it('returns null when there is no user comment', () => {
    const sample = reviewToRatingSample(
      { reviewId: 'rev-1', comments: [] },
      'com.example.app',
    );
    expect(sample).toBeNull();
  });

  it('returns null for an out-of-range star rating', () => {
    const sample = reviewToRatingSample(
      {
        reviewId: 'rev-1',
        comments: [
          {
            userComment: {
              starRating: 0,
              lastModified: { seconds: '1690000000' },
            },
          },
        ],
      },
      'com.example.app',
    );
    expect(sample).toBeNull();
  });

  it('returns null when the timestamp is missing', () => {
    const sample = reviewToRatingSample(
      { reviewId: 'rev-1', comments: [{ userComment: { starRating: 5 } }] },
      'com.example.app',
    );
    expect(sample).toBeNull();
  });
});

describe('GooglePlayConsoleConnector.sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function makeConnector() {
    return new GooglePlayConsoleConnector(
      { packageName: 'com.example.app' },
      { serviceAccountJson: TEST_SA_JSON },
    );
  }

  it('returns done:true when all phases return empty rows', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({ access_token: 'tok', expires_in: 3600 }, {}),
    );
    const storage = makeStorage();
    const result = await makeConnector().sync({ mode: 'full' }, storage);
    expect(result.done).toBe(true);
  });

  it('accepts a serviceAccountJson credential that the resolver pre-parsed into an object', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({ access_token: 'tok', expires_in: 3600 }, {}),
    );
    const storage = makeStorage();
    const connector = new GooglePlayConsoleConnector(
      { packageName: 'com.example.app' },
      {
        serviceAccountJson: JSON.parse(TEST_SA_JSON) as Record<string, unknown>,
      } as unknown as { serviceAccountJson: string },
    );
    const result = await connector.sync({ mode: 'full' }, storage);
    expect(result.done).toBe(true);
  });

  it('writes one storage.metrics call per metric phase plus one entities call for apps', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({ access_token: 'tok', expires_in: 3600 }, {}),
    );
    const storage = makeStorage();
    await makeConnector().sync({ mode: 'full' }, storage);

    const metricNames = storage.metrics.mock.calls.map(
      (c) => (c[1] as { names: string[] }).names[0],
    );
    expect(metricNames).toEqual(
      expect.arrayContaining([
        'gplay_crash_rate_by_day',
        'gplay_anr_rate_by_day',
        'gplay_error_count_by_day',
      ]),
    );
    expect(metricNames).not.toContain('gplay_ratings_by_day');
    expect(storage.entities).toHaveBeenCalledTimes(1);
    const entityCall = storage.entities.mock.calls[0]!;
    const entities = entityCall[0] as Array<{ type: string; id: string }>;
    expect(entities).toHaveLength(1);
    expect(entities[0]!.type).toBe('apps');
    expect(entities[0]!.id).toBe('com.example.app');
  });

  it('emits the apps entity from the configured package name alone', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({ access_token: 'tok', expires_in: 3600 }, {}),
    );
    const storage = makeStorage();
    await makeConnector().sync({ mode: 'full' }, storage);

    const entityCall = storage.entities.mock.calls[0]!;
    const entities = entityCall[0] as Array<{
      attributes: Record<string, string>;
    }>;
    expect(entities[0]!.attributes['package_name']).toBe('com.example.app');
    expect(entities[0]!.attributes).not.toHaveProperty('title');
    expect(entities[0]!.attributes).not.toHaveProperty('default_language');
  });

  it('maps Android Publisher reviews to gplay_app_ratings samples', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        { access_token: 'tok', expires_in: 3600 },
        {},
        {
          reviews: [
            {
              reviewId: 'rev-1',
              comments: [
                {
                  userComment: {
                    starRating: 4,
                    reviewerLanguage: 'en',
                    device: 'klte',
                    appVersionName: '1.2.3',
                    androidOsVersion: 31,
                    lastModified: { seconds: '1700000000', nanos: 0 },
                  },
                },
              ],
            },
          ],
        },
      ),
    );
    const storage = makeStorage();
    await makeConnector().sync({ mode: 'full' }, storage);

    const ratingsCall = storage.metrics.mock.calls.find(
      (c) => (c[1] as { names: string[] }).names[0] === 'gplay_app_ratings',
    );
    expect(ratingsCall).toBeDefined();
    const samples = ratingsCall![0] as Array<{
      value: number;
      ts: number;
      attributes: Record<string, string | number>;
    }>;
    expect(samples).toHaveLength(1);
    expect(samples[0]!.value).toBe(4);
    expect(samples[0]!.ts).toBe(1700000000 * 1000);
    expect(samples[0]!.attributes['review_id']).toBe('rev-1');
    expect(samples[0]!.attributes['package_name']).toBe('com.example.app');
    expect(samples[0]!.attributes['reviewer_language']).toBe('en');
  });

  it('paginates the reviews API, ranks newest-first, then caps at reviewLimit', async () => {
    let reviewCalls = 0;
    const review = (id: string, seconds: string) => ({
      reviewId: id,
      comments: [{ userComment: { starRating: 5, lastModified: { seconds } } }],
    });
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
        if (urlStr.includes('androidpublisher.googleapis.com')) {
          reviewCalls += 1;
          const resp =
            reviewCalls === 1
              ? {
                  reviews: [review('old', '100'), review('newest', '300')],
                  tokenPagination: { nextPageToken: 'p2' },
                }
              : { reviews: [review('middle', '200')] };
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
          text: () => Promise.resolve(JSON.stringify({ rows: [] })),
        } as Response);
      }),
    );

    const connector = new GooglePlayConsoleConnector(
      { packageName: 'com.example.app', reviewLimit: 2 },
      { serviceAccountJson: TEST_SA_JSON },
    );
    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const ratingsCall = storage.metrics.mock.calls.find(
      (c) => (c[1] as { names: string[] }).names[0] === 'gplay_app_ratings',
    );
    const samples = ratingsCall![0] as Array<{
      attributes: { review_id: string };
    }>;
    expect(reviewCalls).toBe(2);
    expect(samples.map((s) => s.attributes.review_id)).toEqual([
      'newest',
      'middle',
    ]);
  });

  it('writes samples for returned rows', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        { access_token: 'tok', expires_in: 3600 },
        {
          crashRateMetricSet: {
            rows: [
              dailyRow('2025-01-01', { crashRate: 0.05, distinctUsers: 100 }),
            ],
          },
        },
      ),
    );
    const storage = makeStorage();
    await makeConnector().sync({ mode: 'full' }, storage);

    const crashCall = storage.metrics.mock.calls.find(
      (c) =>
        (c[1] as { names: string[] }).names[0] === 'gplay_crash_rate_by_day',
    );
    expect(crashCall).toBeDefined();
    const samples = crashCall![0] as Array<{ value: number }>;
    expect(samples).toHaveLength(1);
    expect(samples[0]!.value).toBeCloseTo(0.05);
  });

  it('uses the trailing 3-day window in mode:latest', async () => {
    const fetchSpy = mockFetch({ access_token: 'tok', expires_in: 3600 }, {});
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await makeConnector().sync({ mode: 'latest' }, storage);

    const queryCalls = fetchSpy.mock.calls.filter((c: unknown[]) =>
      String(c[0]).includes('playdeveloperreporting.googleapis.com'),
    );
    expect(queryCalls.length).toBeGreaterThan(0);
    for (const c of queryCalls) {
      const init = (c as [string, RequestInit])[1];
      const body = JSON.parse(String(init.body)) as {
        timelineSpec: {
          startTime: { year: number; month: number; day: number };
          endTime: { year: number; month: number; day: number };
        };
      };
      const start = Date.UTC(
        body.timelineSpec.startTime.year,
        body.timelineSpec.startTime.month - 1,
        body.timelineSpec.startTime.day,
      );
      const end = Date.UTC(
        body.timelineSpec.endTime.year,
        body.timelineSpec.endTime.month - 1,
        body.timelineSpec.endTime.day,
      );
      const spanDays = (end - start) / (24 * 60 * 60 * 1000);
      expect(spanDays).toBe(2);
    }
  });

  it('resumes from a saved cursor and uses its date range', async () => {
    const fetchSpy = mockFetch({ access_token: 'tok', expires_in: 3600 }, {});
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await makeConnector().sync(
      {
        mode: 'full',
        cursor: {
          phase: 'anr_rate',
          dateRange: { startDate: '2025-02-01', endDate: '2025-02-28' },
        },
      },
      storage,
    );

    const queryCalls = fetchSpy.mock.calls.filter((c: unknown[]) =>
      String(c[0]).includes('playdeveloperreporting.googleapis.com'),
    );
    expect(queryCalls.length).toBeGreaterThan(0);

    const firstUrl = String((queryCalls[0] as [string])[0]);
    expect(firstUrl).toContain('anrRateMetricSet:query');

    for (const c of queryCalls) {
      const init = (c as [string, RequestInit])[1];
      const body = JSON.parse(String(init.body)) as {
        timelineSpec: {
          startTime: { year: number; month: number; day: number };
          endTime: { year: number; month: number; day: number };
        };
      };
      expect(body.timelineSpec.startTime).toEqual({
        year: 2025,
        month: 2,
        day: 1,
        timeZone: { id: 'America/Los_Angeles' },
      });
      expect(body.timelineSpec.endTime).toEqual({
        year: 2025,
        month: 2,
        day: 28,
        timeZone: { id: 'America/Los_Angeles' },
      });
    }

    expect(storage.entities).not.toHaveBeenCalled();
  });

  it('sends America/Los_Angeles, never UTC, for DAILY queries', async () => {
    const fetchSpy = mockFetch({ access_token: 'tok', expires_in: 3600 }, {});
    vi.stubGlobal('fetch', fetchSpy);

    await makeConnector().sync({ mode: 'full' }, makeStorage());

    const queryCalls = fetchSpy.mock.calls.filter((c: unknown[]) =>
      String(c[0]).includes('playdeveloperreporting.googleapis.com'),
    );
    expect(queryCalls.length).toBeGreaterThan(0);
    for (const c of queryCalls) {
      const init = (c as [string, RequestInit])[1];
      const body = JSON.parse(String(init.body)) as {
        timelineSpec: {
          aggregationPeriod: string;
          startTime: { timeZone: { id: string } };
          endTime: { timeZone: { id: string } };
        };
      };
      expect(body.timelineSpec.aggregationPeriod).toBe('DAILY');
      expect(body.timelineSpec.startTime.timeZone.id).toBe(
        'America/Los_Angeles',
      );
      expect(body.timelineSpec.endTime.timeZone.id).toBe('America/Los_Angeles');
      expect(body.timelineSpec.startTime.timeZone.id).not.toBe('UTC');
      expect(body.timelineSpec.endTime.timeZone.id).not.toBe('UTC');
    }
  });

  it('honors options.resources by skipping unrequested phases', async () => {
    const fetchSpy = mockFetch({ access_token: 'tok', expires_in: 3600 }, {});
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await makeConnector().sync(
      { mode: 'full', resources: new Set(['gplay_anr_rate_by_day']) },
      storage,
    );

    const queriedSets = fetchSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .filter((u) => u.includes('playdeveloperreporting.googleapis.com'))
      .map((u) => u.match(/(\w+MetricSet):query$/)?.[1]);

    expect(queriedSets).toEqual(['anrRateMetricSet']);
    expect(storage.entities).not.toHaveBeenCalled();
    expect(storage.metrics).toHaveBeenCalledTimes(1);
  });

  it('sends Authorization header with bearer token to every API call', async () => {
    const fetchSpy = mockFetch(
      { access_token: 'test-token', expires_in: 3600 },
      {},
    );
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await makeConnector().sync({ mode: 'full' }, storage);

    const apiCalls = fetchSpy.mock.calls.filter((c: unknown[]) => {
      const url = String(c[0]);
      return (
        url.includes('playdeveloperreporting.googleapis.com') ||
        url.includes('androidpublisher.googleapis.com')
      );
    });
    expect(apiCalls.length).toBeGreaterThan(0);
    for (const c of apiCalls) {
      const headers = (c as [string, { headers: Record<string, string> }])[1]
        .headers;
      const authKey = Object.keys(headers).find(
        (k) => k.toLowerCase() === 'authorization',
      );
      expect(authKey).toBeDefined();
      expect(headers[authKey!]).toBe('Bearer test-token');
    }
  });

  it('encodes the packageName in the query URL', async () => {
    const fetchSpy = mockFetch({ access_token: 'tok', expires_in: 3600 }, {});
    vi.stubGlobal('fetch', fetchSpy);

    const connector = new GooglePlayConsoleConnector(
      { packageName: 'com.example.app' },
      { serviceAccountJson: TEST_SA_JSON },
    );
    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const reportingCalls = fetchSpy.mock.calls.filter((c: unknown[]) =>
      String(c[0]).includes('playdeveloperreporting.googleapis.com'),
    );
    expect(reportingCalls.length).toBeGreaterThan(0);
    const url = String((reportingCalls[0] as [string])[0]);
    expect(url).toContain('/v1beta1/apps/com.example.app/');
  });

  it('returns a resumable cursor when the abort signal trips mid-drain', async () => {
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
        if (urlStr.includes('androidpublisher.googleapis.com')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: new Headers({ 'content-type': 'application/json' }),
            text: () =>
              Promise.resolve(
                JSON.stringify({ defaultLanguage: 'en-US', listings: [] }),
              ),
          } as Response);
        }
        controller.abort();
        const abortErr = new Error('aborted');
        abortErr.name = 'AbortError';
        return Promise.reject(abortErr);
      }),
    );

    const storage = makeStorage();
    const result = await makeConnector().sync(
      { mode: 'full' },
      storage,
      controller.signal,
    );

    expect(result.done).toBe(false);
    if (!result.done) {
      const cursor = result.cursor as { phase: string };
      expect(cursor.phase).toBe('crash_rate');
    }
  });

  it('returns a resumable reviews cursor when the abort signal trips mid-reviews', async () => {
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
        if (urlStr.includes('androidpublisher.googleapis.com')) {
          controller.abort();
          const abortErr = new Error('aborted');
          abortErr.name = 'AbortError';
          return Promise.reject(abortErr);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ rows: [] })),
        } as Response);
      }),
    );

    const storage = makeStorage();
    const result = await makeConnector().sync(
      { mode: 'full' },
      storage,
      controller.signal,
    );

    expect(result.done).toBe(false);
    if (!result.done) {
      const cursor = result.cursor as { phase: string };
      expect(cursor.phase).toBe('reviews');
    }
    const ratingsCall = storage.metrics.mock.calls.find(
      (c) => (c[1] as { names: string[] }).names[0] === 'gplay_app_ratings',
    );
    expect(ratingsCall).toBeUndefined();
  });

  it('handles paginated metric set responses', async () => {
    let crashCalls = 0;
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
        if (urlStr.includes('androidpublisher.googleapis.com')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: new Headers({ 'content-type': 'application/json' }),
            text: () =>
              Promise.resolve(
                JSON.stringify({ defaultLanguage: 'en-US', listings: [] }),
              ),
          } as Response);
        }
        if (urlStr.includes('crashRateMetricSet')) {
          crashCalls += 1;
          const resp =
            crashCalls === 1
              ? {
                  rows: [dailyRow('2025-01-01', { crashRate: 0.01 })],
                  nextPageToken: 'page2',
                }
              : { rows: [dailyRow('2025-01-02', { crashRate: 0.02 })] };
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
          text: () => Promise.resolve(JSON.stringify({ rows: [] })),
        } as Response);
      }),
    );

    const storage = makeStorage();
    await makeConnector().sync({ mode: 'full' }, storage);

    const crashCall = storage.metrics.mock.calls.find(
      (c) =>
        (c[1] as { names: string[] }).names[0] === 'gplay_crash_rate_by_day',
    );
    expect(crashCall).toBeDefined();
    const samples = crashCall![0] as Array<{ value: number }>;
    expect(samples).toHaveLength(2);
    expect(crashCalls).toBe(2);
  });
});

function utf16leWithBom(text: string): Uint8Array {
  const bytes = new Uint8Array(2 + text.length * 2);
  bytes[0] = 0xff;
  bytes[1] = 0xfe;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    bytes[2 + i * 2] = code & 0xff;
    bytes[2 + i * 2 + 1] = (code >> 8) & 0xff;
  }
  return bytes;
}

function gcsResponse(bytes: Uint8Array): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'text/csv' }),
    arrayBuffer: () =>
      Promise.resolve(
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ),
      ),
    text: () => Promise.resolve(''),
  } as unknown as Response;
}

function gcsNotFound(): Response {
  return {
    ok: false,
    status: 404,
    statusText: 'Not Found',
    headers: new Headers({ 'content-type': 'application/json' }),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    text: () => Promise.resolve('{"error":{"code":404}}'),
  } as unknown as Response;
}

describe('GooglePlayConsoleConnector installs', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const OVERVIEW_CSV = [
    'Date,Package Name,Daily Device Installs,Daily Device Uninstalls,Installs on active devices',
    '2025-04-01,com.example.app,120,4,5000',
    '2025-04-02,com.example.app,131,7,5050',
  ].join('\r\n');

  function makeInstallsConnector() {
    return new GooglePlayConsoleConnector(
      {
        packageName: 'com.example.app',
        installsBucketId: 'pubsite_prod_rev_1',
      },
      { serviceAccountJson: TEST_SA_JSON },
    );
  }

  function tokenResponse(): Response {
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      text: () =>
        Promise.resolve(
          JSON.stringify({ access_token: 'tok', expires_in: 3600 }),
        ),
    } as Response;
  }

  it('downloads monthly CSVs across the window and writes install samples', async () => {
    const requestedUrls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        const urlStr = String(url);
        if (urlStr.includes('oauth2.googleapis.com/token')) {
          return Promise.resolve(tokenResponse());
        }
        if (urlStr.includes('storage.googleapis.com')) {
          requestedUrls.push(urlStr);
          return Promise.resolve(gcsResponse(utf16leWithBom(OVERVIEW_CSV)));
        }
        return Promise.resolve(gcsNotFound());
      }),
    );

    const storage = makeStorage();
    await makeInstallsConnector().sync(
      {
        mode: 'full',
        resources: new Set(['gplay_installs_overview_by_day']),
        cursor: {
          phase: 'installs_overview',
          dateRange: { startDate: '2025-03-20', endDate: '2025-04-05' },
        },
      },
      storage,
    );

    expect(requestedUrls).toHaveLength(2);
    expect(requestedUrls[0]).toContain(
      '/b/pubsite_prod_rev_1/o/stats%2Finstalls%2Finstalls_com.example.app_202503_overview.csv',
    );
    expect(requestedUrls[0]).toContain('alt=media');
    expect(requestedUrls[1]).toContain('_202504_overview.csv');

    const call = storage.metrics.mock.calls.find(
      (c) =>
        (c[1] as { names: string[] }).names[0] ===
        'gplay_installs_overview_by_day',
    );
    expect(call).toBeDefined();
    const samples = call![0] as Array<{
      value: number;
      attributes: Record<string, string | number>;
    }>;
    expect(samples).toHaveLength(4);
    expect(samples[0]!.value).toBe(120);
    expect(samples[0]!.attributes['active_device_installs']).toBe(5000);
  });

  it('tolerates a 404 for a month with no report yet', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        const urlStr = String(url);
        if (urlStr.includes('oauth2.googleapis.com/token')) {
          return Promise.resolve(tokenResponse());
        }
        if (urlStr.includes('_202503_overview.csv')) {
          return Promise.resolve(gcsNotFound());
        }
        if (urlStr.includes('storage.googleapis.com')) {
          return Promise.resolve(gcsResponse(utf16leWithBom(OVERVIEW_CSV)));
        }
        return Promise.resolve(gcsNotFound());
      }),
    );

    const storage = makeStorage();
    await makeInstallsConnector().sync(
      {
        mode: 'full',
        resources: new Set(['gplay_installs_overview_by_day']),
        cursor: {
          phase: 'installs_overview',
          dateRange: { startDate: '2025-03-20', endDate: '2025-04-05' },
        },
      },
      storage,
    );

    const call = storage.metrics.mock.calls.find(
      (c) =>
        (c[1] as { names: string[] }).names[0] ===
        'gplay_installs_overview_by_day',
    );
    const samples = call![0] as unknown[];
    expect(samples).toHaveLength(2);
  });

  it('skips installs phases entirely when no bucket is configured', async () => {
    const fetchSpy = vi.fn().mockImplementation((url: string) => {
      const urlStr = String(url);
      if (urlStr.includes('oauth2.googleapis.com/token')) {
        return Promise.resolve(tokenResponse());
      }
      return Promise.resolve(gcsNotFound());
    });
    vi.stubGlobal('fetch', fetchSpy);

    const connector = new GooglePlayConsoleConnector(
      { packageName: 'com.example.app' },
      { serviceAccountJson: TEST_SA_JSON },
    );
    const storage = makeStorage();
    await connector.sync(
      { mode: 'full', resources: new Set(['gplay_installs_by_country']) },
      storage,
    );

    const storageCalled = fetchSpy.mock.calls.some((c: unknown[]) =>
      String(c[0]).includes('storage.googleapis.com'),
    );
    expect(storageCalled).toBe(false);
    expect(storage.metrics).not.toHaveBeenCalled();
  });

  it('sends the bearer token to the Cloud Storage download', async () => {
    const fetchSpy = vi.fn().mockImplementation((url: string) => {
      const urlStr = String(url);
      if (urlStr.includes('oauth2.googleapis.com/token')) {
        return Promise.resolve(tokenResponse());
      }
      return Promise.resolve(gcsResponse(utf16leWithBom(OVERVIEW_CSV)));
    });
    vi.stubGlobal('fetch', fetchSpy);

    await makeInstallsConnector().sync(
      {
        mode: 'full',
        resources: new Set(['gplay_installs_overview_by_day']),
        cursor: {
          phase: 'installs_overview',
          dateRange: { startDate: '2025-04-01', endDate: '2025-04-05' },
        },
      },
      makeStorage(),
    );

    const gcsCall = fetchSpy.mock.calls.find((c: unknown[]) =>
      String(c[0]).includes('storage.googleapis.com'),
    );
    expect(gcsCall).toBeDefined();
    const headers = (
      gcsCall as [string, { headers: Record<string, string> }]
    )[1].headers;
    const authKey = Object.keys(headers).find(
      (k) => k.toLowerCase() === 'authorization',
    );
    expect(headers[authKey!]).toBe('Bearer tok');
  });
});

describe('GooglePlayConsoleConnector.create', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns a connector instance with the configured id', () => {
    vi.stubEnv('GPLAY_SA', TEST_SA_JSON);
    const connector = GooglePlayConsoleConnector.create({
      packageName: 'com.example.app',
      serviceAccountJson: { $secret: 'GPLAY_SA' },
    });
    expect(connector).toBeInstanceOf(GooglePlayConsoleConnector);
    expect(connector.id).toBe('google-play-console');
  });

  it('normalizes a gs:// installs bucket id', () => {
    vi.stubEnv('GPLAY_SA', TEST_SA_JSON);
    const connector = GooglePlayConsoleConnector.create({
      packageName: 'com.example.app',
      serviceAccountJson: { $secret: 'GPLAY_SA' },
      installsBucketId: 'gs://pubsite_prod_rev_9/stats/',
    });
    expect(connector.serializeConfig()['installsBucketId']).toBe(
      'pubsite_prod_rev_9',
    );
  });
});
