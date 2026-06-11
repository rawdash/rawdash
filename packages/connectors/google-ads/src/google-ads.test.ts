import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  GoogleAdsConnector,
  adGroupMetricRowToSample,
  campaignMetricRowToSample,
  campaignToEntity,
  configFields,
  getDateRange,
  keywordMetricRowToSample,
} from './google-ads';

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

function mockFetch(
  tokenResponse: object,
  searchResponses: Record<string, object>,
): ReturnType<typeof vi.fn> {
  return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    const urlStr = String(url);
    if (urlStr.includes('oauth2.googleapis.com/token')) {
      return Promise.resolve(
        new Response(JSON.stringify(tokenResponse), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }
    if (urlStr.includes('googleads.googleapis.com')) {
      const body = init?.body
        ? (JSON.parse(String(init.body)) as { query: string })
        : { query: '' };
      const q = body.query ?? '';
      let key = 'unknown';
      if (q.includes('FROM keyword_view')) {
        key = 'keyword';
      } else if (q.includes('FROM ad_group')) {
        key = 'ad_group';
      } else if (q.includes('FROM campaign')) {
        key = q.includes('segments.date BETWEEN')
          ? 'campaign_metrics'
          : 'campaigns';
      }
      const resp = searchResponses[key] ?? { results: [] };
      return Promise.resolve(
        new Response(JSON.stringify(resp), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
}

function makeConnector(
  overrides?: Partial<{
    customerId: string;
    loginCustomerId: string;
    resources: Array<
      'campaigns' | 'campaign_metrics' | 'ad_group_metrics' | 'keyword_metrics'
    >;
    lookbackDays: number;
  }>,
): GoogleAdsConnector {
  return new GoogleAdsConnector(
    {
      customerId: overrides?.customerId ?? '1234567890',
      loginCustomerId: overrides?.loginCustomerId,
      lookbackDays: overrides?.lookbackDays,
      resources: overrides?.resources,
    },
    {
      clientId: 'client-id',
      clientSecret: 'client-secret' as unknown as { $secret: string },
      refreshToken: 'refresh-token' as unknown as { $secret: string },
      developerToken: 'developer-token' as unknown as { $secret: string },
    },
  );
}

describe('configFields', () => {
  it('parses a fully-specified config', () => {
    const result = configFields.safeParse({
      customerId: '1234567890',
      loginCustomerId: '9876543210',
      clientId: 'cid.apps.googleusercontent.com',
      clientSecret: { $secret: 'GADS_CLIENT_SECRET' },
      refreshToken: { $secret: 'GADS_REFRESH_TOKEN' },
      developerToken: { $secret: 'GADS_DEVELOPER_TOKEN' },
      lookbackDays: 30,
    });
    expect(result.success).toBe(true);
  });

  it('rejects dashed customerId', () => {
    const result = configFields.safeParse({
      customerId: '123-456-7890',
      clientId: 'cid',
      clientSecret: { $secret: 'X' },
      refreshToken: { $secret: 'X' },
      developerToken: { $secret: 'X' },
    });
    expect(result.success).toBe(false);
  });

  it('requires all three secrets', () => {
    const result = configFields.safeParse({
      customerId: '1234567890',
      clientId: 'cid',
      clientSecret: { $secret: 'X' },
      refreshToken: { $secret: 'X' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects plain string for clientSecret (must be secret object)', () => {
    const result = configFields.safeParse({
      customerId: '1234567890',
      clientId: 'cid',
      clientSecret: 'raw-string',
      refreshToken: { $secret: 'X' },
      developerToken: { $secret: 'X' },
    });
    expect(result.success).toBe(false);
  });

  it('accepts an explicit resources allowlist', () => {
    const result = configFields.safeParse({
      customerId: '1234567890',
      clientId: 'cid',
      clientSecret: { $secret: 'X' },
      refreshToken: { $secret: 'X' },
      developerToken: { $secret: 'X' },
      resources: ['campaigns', 'campaign_metrics'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown resource name', () => {
    const result = configFields.safeParse({
      customerId: '1234567890',
      clientId: 'cid',
      clientSecret: { $secret: 'X' },
      refreshToken: { $secret: 'X' },
      developerToken: { $secret: 'X' },
      resources: ['nope'],
    });
    expect(result.success).toBe(false);
  });
});

describe('getDateRange', () => {
  const NOW = Date.UTC(2025, 0, 31);

  it('returns a 3-day window in latest mode', () => {
    const r = getDateRange({ mode: 'latest' }, 90, NOW);
    expect(r.endDate).toBe('2025-01-31');
    expect(r.startDate).toBe('2025-01-29');
  });

  it('returns the full lookback window when no since is provided', () => {
    const r = getDateRange({ mode: 'full' }, 7, NOW);
    expect(r.endDate).toBe('2025-01-31');
    expect(r.startDate).toBe('2025-01-25');
  });

  it('clamps a wider since window to lookbackDays', () => {
    const since = new Date(NOW - 30 * 24 * 60 * 60 * 1000).toISOString();
    const r = getDateRange({ mode: 'full', since }, 7, NOW);
    expect(r.startDate).toBe('2025-01-25');
  });

  it('honors a narrower since window inside lookbackDays', () => {
    const since = new Date(NOW - 2 * 24 * 60 * 60 * 1000).toISOString();
    const r = getDateRange({ mode: 'full', since }, 90, NOW);
    expect(r.startDate).toBe('2025-01-30');
  });
});

describe('row conversion helpers', () => {
  it('campaignToEntity converts a campaign row', () => {
    const e = campaignToEntity({
      campaign: {
        id: '111',
        name: 'Launch',
        status: 'ENABLED',
        biddingStrategyType: 'MAXIMIZE_CONVERSIONS',
        startDate: '2025-01-01',
        endDate: null,
        resourceName: 'customers/1234567890/campaigns/111',
      },
    });
    expect(e.type).toBe('google_ads_campaign');
    expect(e.id).toBe('111');
    expect(e.attributes.name).toBe('Launch');
    expect(e.attributes.status).toBe('ENABLED');
    expect(e.attributes.startDate).toBe('2025-01-01');
    expect(e.updated_at).toBe(Date.UTC(2025, 0, 1));
  });

  it('campaignMetricRowToSample converts micros to currency units in value', () => {
    const sample = campaignMetricRowToSample({
      segments: { date: '2025-01-15' },
      campaign: { id: '111', name: 'Launch' },
      metrics: {
        impressions: '12000',
        clicks: '320',
        costMicros: '1500000',
        conversions: 4.5,
        conversionsValue: 200,
      },
    });
    expect(sample.name).toBe('google_ads_campaign_metrics');
    expect(sample.ts).toBe(Date.UTC(2025, 0, 15));
    expect(sample.value).toBeCloseTo(1.5);
    expect(sample.attributes.cost).toBeCloseTo(1.5);
    expect(sample.attributes.costMicros).toBe(1500000);
    expect(sample.attributes.impressions).toBe(12000);
    expect(sample.attributes.clicks).toBe(320);
    expect(sample.attributes.conversions).toBe(4.5);
    expect(sample.attributes.conversionsValue).toBe(200);
    expect(sample.attributes.campaignId).toBe('111');
  });

  it('campaignMetricRowToSample tolerates missing nullable counters', () => {
    const sample = campaignMetricRowToSample({
      segments: { date: '2025-02-01' },
      campaign: { id: 222 },
      metrics: {
        impressions: 0,
        clicks: 0,
        costMicros: 0,
        conversions: null,
        conversionsValue: null,
      },
    });
    expect(sample.value).toBe(0);
    expect(sample.attributes.conversions).toBe(0);
    expect(sample.attributes.conversionsValue).toBe(0);
    expect(sample.attributes.campaignName).toBeNull();
  });

  it('adGroupMetricRowToSample carries adGroupId and parent campaignId', () => {
    const sample = adGroupMetricRowToSample({
      segments: { date: '2025-01-10' },
      campaign: { id: '111' },
      adGroup: { id: '999', name: 'Brand' },
      metrics: {
        impressions: '500',
        clicks: '20',
        costMicros: '750000',
        conversions: 1.0,
      },
    });
    expect(sample.name).toBe('google_ads_ad_group_metrics');
    expect(sample.attributes.adGroupId).toBe('999');
    expect(sample.attributes.campaignId).toBe('111');
    expect(sample.value).toBeCloseTo(0.75);
  });

  it('keywordMetricRowToSample exposes match type and qualityScore', () => {
    const sample = keywordMetricRowToSample({
      segments: { date: '2025-01-12' },
      adGroup: { id: '999' },
      adGroupCriterion: {
        criterionId: '42',
        keyword: { text: 'rawdash', matchType: 'EXACT' },
      },
      metrics: {
        impressions: '100',
        clicks: '7',
        costMicros: '2500000',
        historicalQualityScore: '8',
      },
    });
    expect(sample.name).toBe('google_ads_keyword_metrics');
    expect(sample.attributes.criterionId).toBe('42');
    expect(sample.attributes.keywordText).toBe('rawdash');
    expect(sample.attributes.matchType).toBe('EXACT');
    expect(sample.attributes.qualityScore).toBe(8);
    expect(sample.attributes.adGroupId).toBe('999');
    expect(sample.value).toBeCloseTo(2.5);
  });

  it('keywordMetricRowToSample emits null qualityScore when missing', () => {
    const sample = keywordMetricRowToSample({
      segments: { date: '2025-01-12' },
      adGroup: { id: '999' },
      adGroupCriterion: { criterionId: '42', keyword: { text: 'rawdash' } },
      metrics: { impressions: '0', clicks: '0', costMicros: '0' },
    });
    expect(sample.attributes.qualityScore).toBeNull();
  });
});

describe('GoogleAdsConnector.sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns done:true when every phase returns no results', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({ access_token: 'tok', expires_in: 3600 }, {}),
    );
    const storage = makeStorage();
    const result = await makeConnector().sync({ mode: 'full' }, storage);
    expect(result.done).toBe(true);
  });

  it('writes each metric phase atomically via storage.metrics with a names scope', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        { access_token: 'tok', expires_in: 3600 },
        {
          campaign_metrics: {
            results: [
              {
                segments: { date: '2025-01-01' },
                campaign: { id: '1', name: 'C1' },
                metrics: {
                  impressions: '100',
                  clicks: '10',
                  costMicros: '5000000',
                  conversions: 1,
                  conversionsValue: 50,
                },
              },
            ],
          },
        },
      ),
    );
    const storage = makeStorage();
    await makeConnector().sync({ mode: 'full' }, storage);

    const campaignMetricsWrites = storage.metrics.mock.calls.filter(
      (c) =>
        (c[1] as { names: string[] }).names[0] ===
        'google_ads_campaign_metrics',
    );
    const withSamples = campaignMetricsWrites.filter(
      (c) => (c[0] as unknown[]).length > 0,
    );
    expect(withSamples).toHaveLength(1);
    const samples = withSamples[0]![0] as Array<{ value: number }>;
    expect(samples).toHaveLength(1);
    expect(samples[0]!.value).toBeCloseTo(5);
  });

  it('clears entity types and metric names on first page', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({ access_token: 'tok', expires_in: 3600 }, {}),
    );
    const storage = makeStorage();
    await makeConnector().sync({ mode: 'full' }, storage);

    const entityClears = storage.entities.mock.calls.map(
      (c) => (c[1] as { types: string[] }).types[0],
    );
    expect(entityClears).toContain('google_ads_campaign');

    const metricClears = storage.metrics.mock.calls.map(
      (c) => (c[1] as { names: string[] }).names[0],
    );
    expect(metricClears).toContain('google_ads_campaign_metrics');
    expect(metricClears).toContain('google_ads_ad_group_metrics');
    expect(metricClears).toContain('google_ads_keyword_metrics');
  });

  it('does NOT clear entities on a `latest` (incremental) sync', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({ access_token: 'tok', expires_in: 3600 }, {}),
    );
    const storage = makeStorage();
    await makeConnector().sync({ mode: 'latest' }, storage);
    expect(storage.entities).not.toHaveBeenCalled();
  });

  it('sends Authorization, developer-token, and login-customer-id headers', async () => {
    const spy = mockFetch({ access_token: 'access-tok', expires_in: 3600 }, {});
    vi.stubGlobal('fetch', spy);

    const storage = makeStorage();
    await makeConnector({ loginCustomerId: '9876543210' }).sync(
      { mode: 'full' },
      storage,
    );

    const apiCalls = spy.mock.calls.filter((c: unknown[]) =>
      String(c[0]).includes('googleads.googleapis.com'),
    );
    expect(apiCalls.length).toBeGreaterThan(0);
    const headers = (
      apiCalls[0] as [string, { headers: Record<string, string> }]
    )[1].headers;
    expect(headers['authorization']).toBe('Bearer access-tok');
    expect(headers['developer-token']).toBe('developer-token');
    expect(headers['login-customer-id']).toBe('9876543210');
  });

  it('omits login-customer-id when loginCustomerId is unset', async () => {
    const spy = mockFetch({ access_token: 'tok', expires_in: 3600 }, {});
    vi.stubGlobal('fetch', spy);

    const storage = makeStorage();
    await makeConnector().sync({ mode: 'full' }, storage);

    const apiCalls = spy.mock.calls.filter((c: unknown[]) =>
      String(c[0]).includes('googleads.googleapis.com'),
    );
    const headers = (
      apiCalls[0] as [string, { headers: Record<string, string> }]
    )[1].headers;
    expect(headers['login-customer-id']).toBeUndefined();
  });

  it('hits the configured customerId in the search URL', async () => {
    const spy = mockFetch({ access_token: 'tok', expires_in: 3600 }, {});
    vi.stubGlobal('fetch', spy);

    const storage = makeStorage();
    await makeConnector({ customerId: '5555555555' }).sync(
      { mode: 'full' },
      storage,
    );

    const apiCalls = spy.mock.calls.filter((c: unknown[]) =>
      String(c[0]).includes('googleads.googleapis.com'),
    );
    expect(apiCalls.length).toBeGreaterThan(0);
    expect(String((apiCalls[0] as [string])[0])).toContain(
      '/customers/5555555555/googleAds:search',
    );
  });

  it('honors the resources allowlist by only fetching listed phases', async () => {
    const spy = mockFetch({ access_token: 'tok', expires_in: 3600 }, {});
    vi.stubGlobal('fetch', spy);

    const storage = makeStorage();
    await makeConnector({ resources: ['campaigns'] }).sync(
      { mode: 'full' },
      storage,
    );

    const apiBodies = spy.mock.calls
      .filter((c: unknown[]) =>
        String(c[0]).includes('googleads.googleapis.com'),
      )
      .map(
        (c) =>
          JSON.parse(String((c as [string, { body: string }])[1].body)) as {
            query: string;
          },
      );
    expect(apiBodies.length).toBeGreaterThan(0);
    for (const body of apiBodies) {
      expect(body.query).toContain('FROM campaign');
      expect(body.query).not.toContain('segments.date BETWEEN');
      expect(body.query).not.toContain('FROM ad_group');
      expect(body.query).not.toContain('FROM keyword_view');
    }
  });

  it('paginates via nextPageToken', async () => {
    let campaignCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        const urlStr = String(url);
        if (urlStr.includes('oauth2.googleapis.com/token')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ access_token: 'tok', expires_in: 3600 }),
              { status: 200, headers: { 'content-type': 'application/json' } },
            ),
          );
        }
        const body = init?.body
          ? (JSON.parse(String(init.body)) as {
              query: string;
              pageToken?: string;
            })
          : { query: '' };
        const isCampaignList =
          body.query.includes('FROM campaign') &&
          !body.query.includes('segments.date BETWEEN');
        if (isCampaignList) {
          campaignCalls += 1;
          if (!body.pageToken) {
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  results: [{ campaign: { id: '1', name: 'A' } }],
                  nextPageToken: 'page2',
                }),
                {
                  status: 200,
                  headers: { 'content-type': 'application/json' },
                },
              ),
            );
          }
          return Promise.resolve(
            new Response(
              JSON.stringify({
                results: [{ campaign: { id: '2', name: 'B' } }],
              }),
              {
                status: 200,
                headers: { 'content-type': 'application/json' },
              },
            ),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify({ results: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }),
    );

    const storage = makeStorage();
    await makeConnector({ resources: ['campaigns'] }).sync(
      { mode: 'full' },
      storage,
    );

    expect(campaignCalls).toBe(2);
    expect(storage.entity).toHaveBeenCalledTimes(2);
  });

  it('resumes from a saved cursor at the given phase', async () => {
    const spy = mockFetch({ access_token: 'tok', expires_in: 3600 }, {});
    vi.stubGlobal('fetch', spy);

    const storage = makeStorage();
    await makeConnector().sync(
      {
        mode: 'full',
        cursor: { phase: 'keyword_metrics', page: null },
      },
      storage,
    );

    const apiBodies = spy.mock.calls
      .filter((c: unknown[]) =>
        String(c[0]).includes('googleads.googleapis.com'),
      )
      .map(
        (c) =>
          JSON.parse(String((c as [string, { body: string }])[1].body)) as {
            query: string;
          },
      );

    expect(apiBodies.length).toBeGreaterThan(0);
    for (const body of apiBodies) {
      expect(body.query).toContain('FROM keyword_view');
    }
  });
});

describe('GoogleAdsConnector campaign filter pushdown', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function campaignQueries(spy: ReturnType<typeof vi.fn>): string[] {
    return spy.mock.calls
      .filter((c: unknown[]) =>
        String(c[0]).includes('googleads.googleapis.com'),
      )
      .map(
        (c) =>
          JSON.parse(String((c as [string, { body: string }])[1].body)) as {
            query: string;
          },
      )
      .map((b) => b.query)
      .filter(
        (q) => q.includes('FROM campaign') && !q.includes('segments.date'),
      );
  }

  it('pushes a single status spec into the campaign GAQL WHERE clause', async () => {
    const spy = mockFetch({ access_token: 'tok', expires_in: 3600 }, {});
    vi.stubGlobal('fetch', spy);

    const storage = makeStorage();
    await makeConnector({ resources: ['campaigns'] }).sync(
      {
        mode: 'full',
        fetchSpecs: {
          google_ads_campaign: [
            { filter: [{ field: 'status', op: 'eq', value: 'PAUSED' }] },
          ],
        },
      },
      storage,
    );

    const queries = campaignQueries(spy);
    expect(queries.length).toBeGreaterThan(0);
    for (const q of queries) {
      expect(q).toContain("campaign.status = 'PAUSED'");
    }
  });

  it('does NOT push when more than one spec is provided', async () => {
    const spy = mockFetch({ access_token: 'tok', expires_in: 3600 }, {});
    vi.stubGlobal('fetch', spy);

    const storage = makeStorage();
    await makeConnector({ resources: ['campaigns'] }).sync(
      {
        mode: 'full',
        fetchSpecs: {
          google_ads_campaign: [
            { filter: [{ field: 'status', op: 'eq', value: 'PAUSED' }] },
            { filter: [{ field: 'status', op: 'eq', value: 'ENABLED' }] },
          ],
        },
      },
      storage,
    );

    const queries = campaignQueries(spy);
    expect(queries.length).toBeGreaterThan(0);
    for (const q of queries) {
      expect(q).not.toContain('campaign.status =');
    }
  });

  it('does not push an unknown status value', async () => {
    const spy = mockFetch({ access_token: 'tok', expires_in: 3600 }, {});
    vi.stubGlobal('fetch', spy);

    const storage = makeStorage();
    await makeConnector({ resources: ['campaigns'] }).sync(
      {
        mode: 'full',
        fetchSpecs: {
          google_ads_campaign: [
            { filter: [{ field: 'status', op: 'eq', value: 'BOGUS' }] },
          ],
        },
      },
      storage,
    );

    const queries = campaignQueries(spy);
    expect(queries.length).toBeGreaterThan(0);
    for (const q of queries) {
      expect(q).not.toContain('campaign.status =');
    }
  });
});

describe('GoogleAdsConnector.create', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the connector instance directly', () => {
    vi.stubEnv('GADS_CLIENT_SECRET', 'cs');
    vi.stubEnv('GADS_REFRESH_TOKEN', 'rt');
    vi.stubEnv('GADS_DEVELOPER_TOKEN', 'dt');
    const c = GoogleAdsConnector.create({
      customerId: '1234567890',
      clientId: 'cid',
      clientSecret: { $secret: 'GADS_CLIENT_SECRET' },
      refreshToken: { $secret: 'GADS_REFRESH_TOKEN' },
      developerToken: { $secret: 'GADS_DEVELOPER_TOKEN' },
    });
    expect(c).toBeInstanceOf(GoogleAdsConnector);
    expect(c.id).toBe('google-ads');
  });
});
