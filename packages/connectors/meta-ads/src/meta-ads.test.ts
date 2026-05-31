import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MetaAdsConnector,
  campaignToEntity,
  configFields,
  insightRowToMetricSample,
} from './meta-ads';

// ---------------------------------------------------------------------------
// configFields
// ---------------------------------------------------------------------------

describe('configFields', () => {
  it('parses a valid config with adAccountId and accessToken', () => {
    const result = configFields.safeParse({
      adAccountId: 'act_1234567890',
      accessToken: { $secret: 'META_TOKEN' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects an ad account id that lacks the act_ prefix', () => {
    const result = configFields.safeParse({
      adAccountId: '1234567890',
      accessToken: { $secret: 'META_TOKEN' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a plain-string access token (must be a secret reference)', () => {
    const result = configFields.safeParse({
      adAccountId: 'act_1234567890',
      accessToken: 'EAAB-plain',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown resource name', () => {
    const result = configFields.safeParse({
      adAccountId: 'act_1234567890',
      accessToken: { $secret: 'META_TOKEN' },
      resources: ['campaigns', 'creative_insights'],
    });
    expect(result.success).toBe(false);
  });

  it('accepts a custom api version', () => {
    const result = configFields.safeParse({
      adAccountId: 'act_1',
      accessToken: { $secret: 'META_TOKEN' },
      apiVersion: 'v20.0',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a malformed api version', () => {
    const result = configFields.safeParse({
      adAccountId: 'act_1',
      accessToken: { $secret: 'META_TOKEN' },
      apiVersion: 'v20',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Row converters
// ---------------------------------------------------------------------------

describe('campaignToEntity', () => {
  it('maps a campaign row into an entity with normalized attributes', () => {
    const entity = campaignToEntity({
      id: 'c1',
      name: 'My Campaign',
      objective: 'OUTCOME_SALES',
      status: 'ACTIVE',
      effective_status: 'ACTIVE',
      daily_budget: '5000',
      lifetime_budget: null,
      created_time: '2025-01-01T00:00:00+0000',
      updated_time: '2025-01-15T12:00:00+0000',
    });
    expect(entity.type).toBe('meta_campaign');
    expect(entity.id).toBe('c1');
    expect(entity.attributes['name']).toBe('My Campaign');
    expect(entity.attributes['objective']).toBe('OUTCOME_SALES');
    expect(entity.attributes['dailyBudget']).toBe(5000);
    expect(entity.attributes['lifetimeBudget']).toBeNull();
    expect(entity.updated_at).toBe(Date.parse('2025-01-15T12:00:00+0000'));
  });

  it('falls back to created_time when updated_time is missing', () => {
    const entity = campaignToEntity({
      id: 'c2',
      name: null,
      created_time: '2025-02-01T00:00:00+0000',
    });
    expect(entity.updated_at).toBe(Date.parse('2025-02-01T00:00:00+0000'));
    expect(entity.attributes['name']).toBeNull();
  });

  it('returns updated_at=0 when both timestamps are missing', () => {
    const entity = campaignToEntity({ id: 'c3' });
    expect(entity.updated_at).toBe(0);
  });
});

describe('insightRowToMetricSample', () => {
  it('uses spend as the primary value and date_start as the ts', () => {
    const sample = insightRowToMetricSample(
      {
        date_start: '2025-01-15',
        campaign_id: 'c1',
        campaign_name: 'My Campaign',
        impressions: '12000',
        clicks: '300',
        spend: '42.50',
        reach: '8000',
        actions: [
          { action_type: 'link_click', value: '300' },
          { action_type: 'purchase', value: '5' },
        ],
        action_values: [{ action_type: 'purchase', value: '125' }],
      },
      'campaign_insights',
    );
    expect(sample.name).toBe('meta_campaign_insights');
    expect(sample.value).toBeCloseTo(42.5);
    expect(sample.ts).toBe(Date.UTC(2025, 0, 15));
    expect(sample.attributes['campaignId']).toBe('c1');
    expect(sample.attributes['campaignName']).toBe('My Campaign');
    expect(sample.attributes['impressions']).toBe(12000);
    expect(sample.attributes['conversions']).toBe(305);
    expect(sample.attributes['conversion_value']).toBe(125);
  });

  it('includes adset attrs on adset_insights rows', () => {
    const sample = insightRowToMetricSample(
      {
        date_start: '2025-01-15',
        campaign_id: 'c1',
        adset_id: 'as1',
        adset_name: 'Adset A',
        spend: '10',
      },
      'adset_insights',
    );
    expect(sample.name).toBe('meta_adset_insights');
    expect(sample.attributes['adsetId']).toBe('as1');
    expect(sample.attributes['adsetName']).toBe('Adset A');
    expect(sample.attributes['adId']).toBeUndefined();
  });

  it('includes ad attrs on ad_insights rows', () => {
    const sample = insightRowToMetricSample(
      {
        date_start: '2025-01-15',
        campaign_id: 'c1',
        adset_id: 'as1',
        ad_id: 'ad1',
        ad_name: 'Ad A',
        spend: '1.25',
      },
      'ad_insights',
    );
    expect(sample.name).toBe('meta_ad_insights');
    expect(sample.attributes['adId']).toBe('ad1');
    expect(sample.attributes['adName']).toBe('Ad A');
    expect(sample.value).toBeCloseTo(1.25);
  });
});

// ---------------------------------------------------------------------------
// Fetch + storage mocks
// ---------------------------------------------------------------------------

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

const TOKEN = 'META_TOKEN' as unknown as { $secret: string };

function connector(overrides?: { resources?: string[]; apiVersion?: string }) {
  return new MetaAdsConnector(
    {
      adAccountId: 'act_1234567890',
      resources: overrides?.resources as never,
      apiVersion: overrides?.apiVersion,
    },
    { accessToken: TOKEN },
  );
}

// ---------------------------------------------------------------------------
// sync — phase orchestration
// ---------------------------------------------------------------------------

describe('MetaAdsConnector.sync', () => {
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

  it('clears entity types only on full sync; always clears metric scopes', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetch(() => undefined),
    );
    const storage = makeStorage();
    await connector().sync({ mode: 'full' }, storage);

    const clearedEntities = storage.entities.mock.calls
      .filter((c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0)
      .map((c) => (c[1] as { types: string[] }).types[0]);
    expect(clearedEntities).toContain('meta_campaign');

    const clearedMetrics = storage.metrics.mock.calls
      .filter((c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0)
      .map((c) => (c[1] as { names: string[] }).names[0]);
    expect(clearedMetrics).toContain('meta_campaign_insights');
    expect(clearedMetrics).toContain('meta_adset_insights');
    expect(clearedMetrics).toContain('meta_ad_insights');
  });

  it('does not clear entity scope on a latest-mode sync', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetch(() => undefined),
    );
    const storage = makeStorage();
    await connector().sync(
      { mode: 'latest', since: new Date(Date.now() - 60_000).toISOString() },
      storage,
    );
    const entityClears = storage.entities.mock.calls.filter(
      (c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0,
    );
    expect(entityClears).toHaveLength(0);

    // Metric scopes are always rewritten, even in latest mode.
    const metricClears = storage.metrics.mock.calls.filter(
      (c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0,
    );
    expect(metricClears.length).toBeGreaterThanOrEqual(3);
  });

  it('writes a campaign entity from a paged campaigns response', async () => {
    const fetchSpy = makeFetch((url) => {
      if (url.includes('/campaigns') && !url.includes('/insights')) {
        return {
          data: [
            {
              id: '1001',
              name: 'My Campaign',
              objective: 'OUTCOME_SALES',
              status: 'ACTIVE',
              effective_status: 'ACTIVE',
              daily_budget: '5000',
              created_time: '2025-01-01T00:00:00+0000',
              updated_time: '2025-01-15T12:00:00+0000',
            },
          ],
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector({ resources: ['campaigns'] }).sync(
      { mode: 'full' },
      storage,
    );

    const entityCalls = storage.entity.mock.calls;
    expect(entityCalls).toHaveLength(1);
    const written = entityCalls[0]![0] as {
      type: string;
      id: string;
      attributes: Record<string, unknown>;
    };
    expect(written.type).toBe('meta_campaign');
    expect(written.id).toBe('1001');
    expect(written.attributes['name']).toBe('My Campaign');
  });

  it('writes a metric sample per insights row, keyed by date_start', async () => {
    const fetchSpy = makeFetch((url) => {
      if (url.includes('/insights') && url.includes('level=campaign')) {
        return {
          data: [
            {
              date_start: '2025-01-15',
              date_stop: '2025-01-15',
              campaign_id: 'c1',
              campaign_name: 'My Campaign',
              impressions: '12000',
              clicks: '300',
              spend: '42.50',
              reach: '8000',
              actions: [{ action_type: 'purchase', value: '5' }],
              action_values: [{ action_type: 'purchase', value: '125' }],
            },
          ],
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector({ resources: ['campaign_insights'] }).sync(
      { mode: 'full' },
      storage,
    );

    const metricCalls = storage.metric.mock.calls;
    expect(metricCalls).toHaveLength(1);
    const sample = metricCalls[0]![0] as {
      name: string;
      ts: number;
      value: number;
      attributes: Record<string, unknown>;
    };
    expect(sample.name).toBe('meta_campaign_insights');
    expect(sample.ts).toBe(Date.UTC(2025, 0, 15));
    expect(sample.value).toBeCloseTo(42.5);
    expect(sample.attributes['conversions']).toBe(5);
    expect(sample.attributes['conversion_value']).toBe(125);
  });

  it('sends Bearer access token in the Authorization header', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector({ resources: ['campaigns'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const calls = recordCalls(fetchSpy);
    expect(calls.length).toBeGreaterThan(0);
    const authHeader = Object.entries(calls[0]!.headers).find(
      ([k]) => k.toLowerCase() === 'authorization',
    );
    expect(authHeader).toBeDefined();
    expect(authHeader![1]).toBe('Bearer META_TOKEN');
  });

  it('hits the configured ad account id and api version', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector({
      resources: ['campaigns'],
      apiVersion: 'v20.0',
    }).sync({ mode: 'full' }, makeStorage());

    const calls = recordCalls(fetchSpy);
    const campaignsCall = calls.find((c) => c.url.includes('/campaigns'));
    expect(campaignsCall).toBeDefined();
    expect(campaignsCall!.url).toContain('/v20.0/');
    expect(campaignsCall!.url).toContain('act_1234567890');
  });

  it('paginates campaigns through paging.cursors.after', async () => {
    let pageIdx = 0;
    const fetchSpy = vi.fn().mockImplementation((url: string | URL) => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.includes('/campaigns') && !u.includes('/insights')) {
        if (pageIdx === 0) {
          pageIdx += 1;
          return Promise.resolve(
            jsonResponse({
              data: [{ id: 'c1' }],
              paging: { cursors: { after: 'AFTER_TOKEN' } },
            }),
          );
        }
        // second page reached when after=AFTER_TOKEN
        if (u.includes('after=AFTER_TOKEN')) {
          return Promise.resolve(
            jsonResponse({
              data: [{ id: 'c2' }],
            }),
          );
        }
      }
      return Promise.resolve(jsonResponse({ data: [] }));
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector({ resources: ['campaigns'] }).sync(
      { mode: 'full' },
      storage,
    );

    expect(storage.entity.mock.calls).toHaveLength(2);
    const ids = storage.entity.mock.calls.map(
      (c) => (c[0] as { id: string }).id,
    );
    expect(ids).toEqual(['c1', 'c2']);
  });

  it('passes a time_range filter on insights queries', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector({ resources: ['campaign_insights'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const calls = recordCalls(fetchSpy);
    const insightsCall = calls.find((c) => c.url.includes('/insights'));
    expect(insightsCall).toBeDefined();
    expect(insightsCall!.url).toContain('time_increment=1');
    expect(insightsCall!.url).toContain('level=campaign');
    expect(insightsCall!.url).toContain('time_range=');
  });

  it('honors the resources allowlist (skips ad_insights when not listed)', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector({
      resources: ['campaigns', 'campaign_insights'],
    }).sync({ mode: 'full' }, makeStorage());

    const calls = recordCalls(fetchSpy);
    const adInsightsCalls = calls.filter((c) => c.url.includes('level=ad&'));
    expect(adInsightsCalls).toHaveLength(0);
  });

  it('resumes from a saved cursor at the specified phase', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector().sync(
      {
        mode: 'full',
        cursor: { phase: 'adset_insights', page: null },
      },
      makeStorage(),
    );

    const calls = recordCalls(fetchSpy);
    // No campaigns call, no campaign_insights call — both phases skipped
    expect(
      calls.find((c) => new URL(c.url).pathname.endsWith('/campaigns')),
    ).toBeUndefined();
    expect(
      calls.find((c) => c.url.includes('level=campaign&')),
    ).toBeUndefined();
    // adset and ad insights both hit
    expect(calls.find((c) => c.url.includes('level=adset&'))).toBeDefined();
    expect(calls.find((c) => c.url.includes('level=ad&'))).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// MetaAdsConnector.create
// ---------------------------------------------------------------------------

describe('MetaAdsConnector.create', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns a configured connector from JSON config', () => {
    vi.stubEnv('META_TOKEN', 'real-token-value');
    const c = MetaAdsConnector.create({
      adAccountId: 'act_42',
      accessToken: { $secret: 'META_TOKEN' },
    });
    expect(c).toBeInstanceOf(MetaAdsConnector);
    expect(c.id).toBe('meta-ads');
  });
});
