import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AzureCostConnector,
  buildCostSamples,
  configFields,
  getCostWindow,
} from './azure-cost';

// ---------------------------------------------------------------------------
// configFields
// ---------------------------------------------------------------------------

const validBaseConfig = {
  tenantId: 't',
  clientId: 'c',
  clientSecret: { $secret: 'AZ_CLIENT_SECRET' },
  subscriptionId: 'sub-1',
};

describe('configFields', () => {
  it('parses a valid minimal config', () => {
    const result = configFields.safeParse(validBaseConfig);
    expect(result.success).toBe(true);
  });

  it('parses a config with groupBy and lookbackDays', () => {
    const result = configFields.safeParse({
      ...validBaseConfig,
      groupBy: ['ServiceName', 'TAG:Environment'],
      lookbackDays: 30,
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown groupBy dimensions', () => {
    const result = configFields.safeParse({
      ...validBaseConfig,
      groupBy: ['NotARealDimension'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects more than two groupBy entries', () => {
    const result = configFields.safeParse({
      ...validBaseConfig,
      groupBy: ['ServiceName', 'ResourceGroup', 'TAG:Environment'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a string clientSecret (must be secret object)', () => {
    const result = configFields.safeParse({
      ...validBaseConfig,
      clientSecret: 'plain-text-secret',
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative lookbackDays', () => {
    const result = configFields.safeParse({
      ...validBaseConfig,
      lookbackDays: -1,
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getCostWindow
// ---------------------------------------------------------------------------

describe('getCostWindow', () => {
  const NOW = Date.UTC(2025, 5, 1, 12, 0, 0); // 2025-06-01T12:00:00Z

  it('returns a 90-day window on a full sync without since', () => {
    const w = getCostWindow({ mode: 'full' }, 90, NOW);
    // From end-of-today minus 89 days at 00:00 UTC, to end of today.
    expect(w.from).toBe('2025-03-04T00:00:00.000Z');
    expect(w.to).toBe('2025-06-01T23:59:59.999Z');
  });

  it('shrinks the window to the incremental lookback on a latest sync', () => {
    const w = getCostWindow({ mode: 'latest' }, 90, NOW);
    // 3-day trailing window.
    expect(w.from).toBe('2025-05-30T00:00:00.000Z');
    expect(w.to).toBe('2025-06-01T23:59:59.999Z');
  });

  it('uses elapsed days since `since` (clamped to lookbackDays) on a full sync', () => {
    const w = getCostWindow(
      { mode: 'full', since: '2025-05-25T00:00:00Z' },
      90,
      NOW,
    );
    // ceil((NOW - since)/MS_PER_DAY) = 8 days. Expected window: 7 days back.
    expect(w.from).toBe('2025-05-25T00:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// buildCostSamples
// ---------------------------------------------------------------------------

describe('buildCostSamples', () => {
  it('builds one sample per row (no groupBy)', () => {
    const samples = buildCostSamples(
      {
        properties: {
          columns: [
            { name: 'Cost', type: 'Number' },
            { name: 'UsageDate', type: 'Number' },
            { name: 'Currency', type: 'String' },
          ],
          rows: [
            [12.5, 20250601, 'USD'],
            [13.25, 20250602, 'USD'],
          ],
        },
      },
      undefined,
    );
    expect(samples).toHaveLength(2);
    expect(samples[0]!.name).toBe('azure_cost_daily');
    expect(samples[0]!.value).toBe(12.5);
    expect(samples[0]!.attributes['unit']).toBe('USD');
    expect(samples[0]!.ts).toBe(Date.UTC(2025, 5, 1));
    expect(samples[1]!.ts).toBe(Date.UTC(2025, 5, 2));
  });

  it('attaches a grouping dimension as a normalized attribute key', () => {
    const samples = buildCostSamples(
      {
        properties: {
          columns: [
            { name: 'Cost' },
            { name: 'UsageDate' },
            { name: 'ServiceName' },
            { name: 'Currency' },
          ],
          rows: [
            [10, 20250601, 'Virtual Machines', 'USD'],
            [5, 20250601, 'Storage', 'USD'],
          ],
        },
      },
      ['ServiceName'],
    );
    expect(samples).toHaveLength(2);
    expect(samples[0]!.attributes['service_name']).toBe('Virtual Machines');
    expect(samples[1]!.attributes['service_name']).toBe('Storage');
  });

  it('normalizes ResourceGroup dimension to resource_group attribute key', () => {
    const samples = buildCostSamples(
      {
        properties: {
          columns: [
            { name: 'Cost' },
            { name: 'UsageDate' },
            { name: 'ResourceGroup' },
            { name: 'Currency' },
          ],
          rows: [[7, 20250601, 'prod-eastus', 'USD']],
        },
      },
      ['ResourceGroup'],
    );
    expect(samples[0]!.attributes['resource_group']).toBe('prod-eastus');
  });

  it('emits TAG:<key> grouping under tag_<key> attribute key', () => {
    const samples = buildCostSamples(
      {
        properties: {
          columns: [
            { name: 'Cost' },
            { name: 'UsageDate' },
            { name: 'Environment' },
            { name: 'Currency' },
          ],
          rows: [[3, 20250601, 'prod', 'USD']],
        },
      },
      ['TAG:Environment'],
    );
    expect(samples[0]!.attributes['tag_Environment']).toBe('prod');
  });

  it('drops rows with an invalid UsageDate', () => {
    const samples = buildCostSamples(
      {
        properties: {
          columns: [
            { name: 'Cost' },
            { name: 'UsageDate' },
            { name: 'Currency' },
          ],
          rows: [
            [10, 'not-a-date', 'USD'],
            [11, 20250601, 'USD'],
          ],
        },
      },
      undefined,
    );
    expect(samples).toHaveLength(1);
    expect(samples[0]!.value).toBe(11);
  });

  it('drops rows with an impossible calendar UsageDate', () => {
    const samples = buildCostSamples(
      {
        properties: {
          columns: [
            { name: 'Cost' },
            { name: 'UsageDate' },
            { name: 'Currency' },
          ],
          rows: [
            [10, 20250230, 'USD'],
            [11, 20251301, 'USD'],
            [12, 20250601, 'USD'],
          ],
        },
      },
      undefined,
    );
    expect(samples).toHaveLength(1);
    expect(samples[0]!.value).toBe(12);
    expect(samples[0]!.ts).toBe(Date.UTC(2025, 5, 1));
  });

  it('returns an empty array when properties is missing', () => {
    const samples = buildCostSamples({}, undefined);
    expect(samples).toEqual([]);
  });

  it('returns an empty array when Cost column is missing', () => {
    const samples = buildCostSamples(
      {
        properties: {
          columns: [{ name: 'UsageDate' }, { name: 'Currency' }],
          rows: [[20250601, 'USD']],
        },
      },
      undefined,
    );
    expect(samples).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// sync — orchestration with mocked fetch
// ---------------------------------------------------------------------------

interface MockResponse {
  status?: number;
  body: unknown;
}

function jsonResponse(input: MockResponse): Response {
  const status = input.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'application/json' }),
    text: () => Promise.resolve(JSON.stringify(input.body)),
  } as Response;
}

interface MockCall {
  url: string;
  method: string;
  body?: unknown;
  headers: Record<string, string>;
}

function recordCalls(spy: ReturnType<typeof vi.fn>): MockCall[] {
  return spy.mock.calls.map((c: unknown[]) => {
    const init = (c[1] ?? {}) as RequestInit;
    let parsedBody: unknown = undefined;
    if (typeof init.body === 'string') {
      try {
        parsedBody = JSON.parse(init.body);
      } catch {
        parsedBody = init.body;
      }
    }
    return {
      url: String(c[0]),
      method: (init.method ?? 'GET').toUpperCase(),
      body: parsedBody,
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

const TOKEN = 'AZ_CLIENT_SECRET' as unknown as { $secret: string };

function connector(
  overrides: {
    groupBy?: string[];
    lookbackDays?: number;
  } = {},
) {
  return new AzureCostConnector(
    {
      tenantId: 'tid',
      clientId: 'cid',
      subscriptionId: 'sub-1',
      ...(overrides.groupBy ? { groupBy: overrides.groupBy } : {}),
      ...(overrides.lookbackDays !== undefined
        ? { lookbackDays: overrides.lookbackDays }
        : {}),
    },
    { clientSecret: TOKEN },
  );
}

const TOKEN_URL_PREFIX = 'https://login.microsoftonline.com/';
const COST_URL_FRAGMENT = '/providers/Microsoft.CostManagement/query';

const TOKEN_BODY = {
  access_token: 'mock-access-token',
  expires_in: 3600,
  token_type: 'Bearer',
};

function makeFetch(
  handler: (call: { url: string; method: string }) => MockResponse | undefined,
) {
  return vi.fn().mockImplementation((url: string | URL, init?: RequestInit) => {
    const u = typeof url === 'string' ? url : url.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    if (u.startsWith(TOKEN_URL_PREFIX)) {
      return Promise.resolve(jsonResponse({ body: TOKEN_BODY }));
    }
    const result = handler({ url: u, method });
    if (result !== undefined) {
      return Promise.resolve(jsonResponse(result));
    }
    return Promise.resolve(jsonResponse({ body: {} }));
  });
}

const EMPTY_COST_BODY = {
  properties: {
    columns: [
      { name: 'Cost', type: 'Number' },
      { name: 'UsageDate', type: 'Number' },
      { name: 'Currency', type: 'String' },
    ],
    rows: [],
  },
};

describe('AzureCostConnector.sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('exchanges client credentials for an ARM token before querying', async () => {
    const fetchSpy = makeFetch(({ url }) => {
      if (url.includes(COST_URL_FRAGMENT)) {
        return { body: EMPTY_COST_BODY };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);
    await connector().sync({ mode: 'full' }, makeStorage());

    const calls = recordCalls(fetchSpy);
    const tokenCall = calls.find((c) => c.url.startsWith(TOKEN_URL_PREFIX));
    expect(tokenCall).toBeDefined();
    expect(tokenCall!.method).toBe('POST');
  });

  it('posts an ActualCost daily query against the subscription with the configured groupBy', async () => {
    const fetchSpy = makeFetch(({ url }) => {
      if (url.includes(COST_URL_FRAGMENT)) {
        return { body: EMPTY_COST_BODY };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);
    await connector({ groupBy: ['ServiceName'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const calls = recordCalls(fetchSpy);
    const costCall = calls.find((c) => c.url.includes(COST_URL_FRAGMENT));
    expect(costCall).toBeDefined();
    expect(costCall!.method).toBe('POST');
    expect(costCall!.url).toContain('/subscriptions/sub-1/');
    expect(costCall!.url).toContain('api-version=');
    const body = costCall!.body as {
      type: string;
      timeframe: string;
      timePeriod: { from: string; to: string };
      dataset: {
        granularity: string;
        aggregation: Record<string, unknown>;
        grouping?: Array<{ type: string; name: string }>;
      };
    };
    expect(body.type).toBe('ActualCost');
    expect(body.timeframe).toBe('Custom');
    expect(body.dataset.granularity).toBe('Daily');
    expect(body.dataset.grouping).toEqual([
      { type: 'Dimension', name: 'ServiceName' },
    ]);
  });

  it('omits the grouping clause when no groupBy is configured', async () => {
    const fetchSpy = makeFetch(({ url }) => {
      if (url.includes(COST_URL_FRAGMENT)) {
        return { body: EMPTY_COST_BODY };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);
    await connector().sync({ mode: 'full' }, makeStorage());

    const calls = recordCalls(fetchSpy);
    const costCall = calls.find((c) => c.url.includes(COST_URL_FRAGMENT));
    const body = costCall!.body as {
      dataset: { grouping?: unknown };
    };
    expect(body.dataset.grouping).toBeUndefined();
  });

  it('writes cost samples to storage scoped to azure_cost_daily', async () => {
    const fetchSpy = makeFetch(({ url }) => {
      if (url.includes(COST_URL_FRAGMENT)) {
        return {
          body: {
            properties: {
              columns: [
                { name: 'Cost', type: 'Number' },
                { name: 'UsageDate', type: 'Number' },
                { name: 'Currency', type: 'String' },
              ],
              rows: [
                [42.5, 20250601, 'USD'],
                [38.0, 20250602, 'USD'],
              ],
            },
          },
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector().sync({ mode: 'full' }, storage);

    const batch = storage.metrics.mock.calls[0]![0] as Array<{
      value: number;
      name: string;
    }>;
    expect(batch).toHaveLength(2);
    expect(batch[0]!.name).toBe('azure_cost_daily');
    expect(batch.map((b) => b.value)).toEqual([42.5, 38.0]);

    const scope = storage.metrics.mock.calls[0]![1] as { names: string[] };
    expect(scope.names).toEqual(['azure_cost_daily']);
  });

  it('paginates via nextLink and concatenates samples across pages', async () => {
    let page = 0;
    const fetchSpy = makeFetch(({ url }) => {
      if (!url.includes(COST_URL_FRAGMENT)) {
        return undefined;
      }
      page += 1;
      if (page === 1) {
        return {
          body: {
            properties: {
              nextLink:
                'https://management.azure.com/subscriptions/sub-1/providers/Microsoft.CostManagement/query?api-version=2024-08-01&$skiptoken=abc',
              columns: [
                { name: 'Cost' },
                { name: 'UsageDate' },
                { name: 'Currency' },
              ],
              rows: [[1, 20250601, 'USD']],
            },
          },
        };
      }
      return {
        body: {
          properties: {
            columns: [
              { name: 'Cost' },
              { name: 'UsageDate' },
              { name: 'Currency' },
            ],
            rows: [[2, 20250602, 'USD']],
          },
        },
      };
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector().sync({ mode: 'full' }, storage);
    expect(page).toBe(2);
    const batch = storage.metrics.mock.calls[0]![0] as Array<{
      value: number;
    }>;
    expect(batch.map((b) => b.value)).toEqual([1, 2]);
  });

  it('rejects nextLink pointed at a non-management.azure.com host', async () => {
    let page = 0;
    const fetchSpy = makeFetch(({ url }) => {
      if (!url.includes(COST_URL_FRAGMENT)) {
        return undefined;
      }
      page += 1;
      if (page === 1) {
        return {
          body: {
            properties: {
              nextLink: 'https://evil.example.com/exfil',
              columns: [
                { name: 'Cost' },
                { name: 'UsageDate' },
                { name: 'Currency' },
              ],
              rows: [[1, 20250601, 'USD']],
            },
          },
        };
      }
      return { body: EMPTY_COST_BODY };
    });
    vi.stubGlobal('fetch', fetchSpy);

    await expect(
      connector().sync({ mode: 'full' }, makeStorage()),
    ).rejects.toThrow(/rejected by ARM host allowlist/);
    expect(page).toBe(1);
  });

  it('fails loudly when nextLink repeats (pagination cycle)', async () => {
    let page = 0;
    const cyclicNextLink =
      'https://management.azure.com/subscriptions/sub-1/providers/Microsoft.CostManagement/query?api-version=2024-08-01&$skiptoken=loop';
    const fetchSpy = makeFetch(({ url }) => {
      if (!url.includes(COST_URL_FRAGMENT)) {
        return undefined;
      }
      page += 1;
      return {
        body: {
          properties: {
            nextLink: cyclicNextLink,
            columns: [
              { name: 'Cost' },
              { name: 'UsageDate' },
              { name: 'Currency' },
            ],
            rows: [[1, 20250601, 'USD']],
          },
        },
      };
    });
    vi.stubGlobal('fetch', fetchSpy);

    await expect(
      connector().sync({ mode: 'full' }, makeStorage()),
    ).rejects.toThrow(/pagination cycle detected/);
    expect(page).toBe(2);
  });

  it('skips the sync when options.resources excludes azure_cost_daily', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    const result = await connector().sync(
      { mode: 'full', resources: new Set(['something_else']) },
      storage,
    );
    expect(result.done).toBe(true);
    expect(storage.metrics).not.toHaveBeenCalled();
  });
});
