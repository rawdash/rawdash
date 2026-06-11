import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AzureMonitorConnector,
  buildAlertEntities,
  buildMetricSamples,
  computeMetricsTimespan,
  configFields,
} from './azure-monitor';

// ---------------------------------------------------------------------------
// configFields
// ---------------------------------------------------------------------------

const validBaseConfig = {
  tenantId: '11111111-1111-1111-1111-111111111111',
  clientId: '22222222-2222-2222-2222-222222222222',
  clientSecret: { $secret: 'AZ_CLIENT_SECRET' },
  subscriptionId: '33333333-3333-3333-3333-333333333333',
  metricQueries: [
    {
      id: 'cpu',
      resourceUri:
        '/subscriptions/33333333-3333-3333-3333-333333333333/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/web-01',
      metricNamespace: 'Microsoft.Compute/virtualMachines',
      metric: 'Percentage CPU',
      aggregation: 'Average',
      interval: 'PT1H',
    },
  ],
};

describe('configFields', () => {
  it('parses a valid minimal config', () => {
    const result = configFields.safeParse(validBaseConfig);
    expect(result.success).toBe(true);
  });

  it('rejects an empty metricQueries array', () => {
    const result = configFields.safeParse({
      ...validBaseConfig,
      metricQueries: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects duplicate query ids', () => {
    const result = configFields.safeParse({
      ...validBaseConfig,
      metricQueries: [
        validBaseConfig.metricQueries[0],
        validBaseConfig.metricQueries[0],
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown aggregation', () => {
    const result = configFields.safeParse({
      ...validBaseConfig,
      metricQueries: [
        { ...validBaseConfig.metricQueries[0], aggregation: 'StdDev' },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown interval', () => {
    const result = configFields.safeParse({
      ...validBaseConfig,
      metricQueries: [
        { ...validBaseConfig.metricQueries[0], interval: 'PT7M' },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a resourceUri without /subscriptions/.../resourceGroups/.../providers/', () => {
    const result = configFields.safeParse({
      ...validBaseConfig,
      metricQueries: [
        { ...validBaseConfig.metricQueries[0], resourceUri: '/foo/bar' },
      ],
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
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('computeMetricsTimespan', () => {
  it('uses since as the lower bound when provided', () => {
    const since = '2025-01-01T00:00:00.000Z';
    const ts = computeMetricsTimespan(
      { mode: 'full', since },
      180,
      Date.UTC(2025, 0, 1, 5, 0, 0),
    );
    expect(ts.startsWith('2025-01-01T00:00:00.000Z/')).toBe(true);
  });

  it('uses lookback minutes when no since is provided', () => {
    const now = Date.UTC(2025, 5, 1, 12, 0, 0);
    const ts = computeMetricsTimespan({ mode: 'full' }, 60, now);
    expect(ts).toBe('2025-06-01T11:00:00.000Z/2025-06-01T12:00:00.000Z');
  });

  it('uses a one hour window on latest with no since', () => {
    const now = Date.UTC(2025, 5, 1, 12, 0, 0);
    const ts = computeMetricsTimespan({ mode: 'latest' }, 180, now);
    expect(ts).toBe('2025-06-01T11:00:00.000Z/2025-06-01T12:00:00.000Z');
  });
});

describe('buildMetricSamples', () => {
  const query = {
    id: 'cpu',
    resourceUri: '/subscriptions/s/resourceGroups/rg/providers/x/y/z',
    metricNamespace: 'Microsoft.Compute/virtualMachines',
    metric: 'Percentage CPU',
    aggregation: 'Average' as const,
    interval: 'PT1H' as const,
  };

  it('builds one sample per timeseries datapoint', () => {
    const samples = buildMetricSamples(
      {
        value: [
          {
            unit: 'Percent',
            timeseries: [
              {
                data: [
                  { timeStamp: '2025-01-01T00:00:00Z', average: 12.5 },
                  { timeStamp: '2025-01-01T01:00:00Z', average: 17 },
                ],
              },
            ],
          },
        ],
      },
      query,
    );
    expect(samples).toHaveLength(2);
    expect(samples[0]!.name).toBe(
      'Microsoft.Compute/virtualMachines/Percentage CPU',
    );
    expect(samples[0]!.value).toBe(12.5);
    expect(samples[0]!.attributes['aggregation']).toBe('Average');
    expect(samples[0]!.attributes['queryId']).toBe('cpu');
    expect(samples[0]!.attributes['unit']).toBe('Percent');
    expect(samples[0]!.ts).toBe(Date.UTC(2025, 0, 1, 0, 0, 0));
  });

  it('picks the configured aggregation', () => {
    const samples = buildMetricSamples(
      {
        value: [
          {
            timeseries: [
              {
                data: [
                  {
                    timeStamp: '2025-01-01T00:00:00Z',
                    average: 5,
                    maximum: 99,
                  },
                ],
              },
            ],
          },
        ],
      },
      { ...query, aggregation: 'Maximum' },
    );
    expect(samples[0]!.value).toBe(99);
  });

  it('attaches metadata dimensions as attributes', () => {
    const samples = buildMetricSamples(
      {
        value: [
          {
            timeseries: [
              {
                metadatavalues: [
                  { name: { value: 'instance' }, value: 'web-01' },
                ],
                data: [{ timeStamp: '2025-01-01T00:00:00Z', average: 1 }],
              },
            ],
          },
        ],
      },
      query,
    );
    expect(samples[0]!.attributes['instance']).toBe('web-01');
  });

  it('drops datapoints without the requested aggregation', () => {
    const samples = buildMetricSamples(
      {
        value: [
          {
            timeseries: [
              {
                data: [
                  { timeStamp: '2025-01-01T00:00:00Z', maximum: 12 },
                  { timeStamp: '2025-01-01T01:00:00Z', average: 13 },
                ],
              },
            ],
          },
        ],
      },
      query,
    );
    expect(samples).toHaveLength(1);
    expect(samples[0]!.value).toBe(13);
  });

  it('drops datapoints with invalid timestamps', () => {
    const samples = buildMetricSamples(
      {
        value: [
          {
            timeseries: [
              {
                data: [
                  { timeStamp: 'not-a-date', average: 1 },
                  { timeStamp: '2025-01-01T00:00:00Z', average: 2 },
                ],
              },
            ],
          },
        ],
      },
      query,
    );
    expect(samples).toHaveLength(1);
    expect(samples[0]!.value).toBe(2);
  });
});

describe('buildAlertEntities', () => {
  it('builds one entity per alert with essentials flattened to attributes', () => {
    const entities = buildAlertEntities({
      value: [
        {
          id: '/subscriptions/s/providers/Microsoft.AlertsManagement/alerts/a1',
          name: 'high-cpu',
          properties: {
            essentials: {
              severity: 'Sev2',
              alertState: 'New',
              monitorCondition: 'Fired',
              signalType: 'Metric',
              monitorService: 'Platform',
              targetResource:
                '/subscriptions/s/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/web-01',
              targetResourceType: 'Microsoft.Compute/virtualMachines',
              targetResourceGroup: 'rg',
              startDateTime: '2025-01-01T00:00:00Z',
              lastModifiedDateTime: '2025-01-01T01:00:00Z',
            },
          },
        },
      ],
    });
    expect(entities).toHaveLength(1);
    expect(entities[0]!.id).toBe(
      '/subscriptions/s/providers/Microsoft.AlertsManagement/alerts/a1',
    );
    expect(entities[0]!.type).toBe('azure_alert');
    expect(entities[0]!.attributes['severity']).toBe('Sev2');
    expect(entities[0]!.attributes['state']).toBe('New');
    expect(entities[0]!.attributes['monitorCondition']).toBe('Fired');
    expect(entities[0]!.attributes['startedAt']).toBe(
      Date.UTC(2025, 0, 1, 0, 0, 0),
    );
    expect(entities[0]!.updated_at).toBe(Date.UTC(2025, 0, 1, 1, 0, 0));
  });

  it('skips alerts without an id', () => {
    const entities = buildAlertEntities({
      value: [{ name: 'orphan' }, { id: '/x/y', name: 'ok' }],
    });
    expect(entities).toHaveLength(1);
    expect(entities[0]!.id).toBe('/x/y');
  });
});

// ---------------------------------------------------------------------------
// sync — orchestration with mocked fetch
// ---------------------------------------------------------------------------

interface MockResponse {
  status?: number;
  body: unknown;
  headers?: Record<string, string>;
}

function jsonResponse(input: MockResponse): Response {
  const status = input.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    headers: new Headers({
      'content-type': 'application/json',
      ...(input.headers ?? {}),
    }),
    text: () => Promise.resolve(JSON.stringify(input.body)),
  } as Response;
}

interface MockCall {
  url: string;
  method: string;
  body?: string;
  headers: Record<string, string>;
}

function recordCalls(spy: ReturnType<typeof vi.fn>): MockCall[] {
  return spy.mock.calls.map((c: unknown[]) => {
    const init = (c[1] ?? {}) as RequestInit;
    return {
      url: String(c[0]),
      method: (init.method ?? 'GET').toUpperCase(),
      body: typeof init.body === 'string' ? init.body : undefined,
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
    resources?: ('metric_queries' | 'alerts')[];
    lookbackMinutes?: number;
  } = {},
) {
  return new AzureMonitorConnector(
    {
      tenantId: 'tid',
      clientId: 'cid',
      subscriptionId: 'sub-1',
      metricQueries: [
        {
          id: 'cpu',
          resourceUri:
            '/subscriptions/sub-1/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/web-01',
          metricNamespace: 'Microsoft.Compute/virtualMachines',
          metric: 'Percentage CPU',
          aggregation: 'Average',
          interval: 'PT1H',
        },
      ],
      ...(overrides.resources ? { resources: overrides.resources } : {}),
      ...(overrides.lookbackMinutes !== undefined
        ? { lookbackMinutes: overrides.lookbackMinutes }
        : {}),
    },
    { clientSecret: TOKEN },
  );
}

const TOKEN_URL_PREFIX = 'https://login.microsoftonline.com/';

const TOKEN_BODY = {
  access_token: 'mock-access-token',
  expires_in: 3600,
  token_type: 'Bearer',
};

function routeFetch(
  routes: Record<
    string,
    (req: { method: string; url: string }) => MockResponse | undefined
  >,
) {
  return vi.fn().mockImplementation((url: string | URL, init?: RequestInit) => {
    const u = typeof url === 'string' ? url : url.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    if (u.startsWith(TOKEN_URL_PREFIX)) {
      return Promise.resolve(jsonResponse({ body: TOKEN_BODY }));
    }
    for (const [pattern, handler] of Object.entries(routes)) {
      if (u.includes(pattern)) {
        const result = handler({ url: u, method });
        if (result !== undefined) {
          return Promise.resolve(jsonResponse(result));
        }
      }
    }
    return Promise.resolve(jsonResponse({ body: {} }));
  });
}

describe('AzureMonitorConnector.sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('exchanges client credentials for an ARM token before calling ARM', async () => {
    const fetchSpy = routeFetch({
      '/providers/Microsoft.Insights/metrics': () => ({
        body: { value: [] },
      }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    await connector({ resources: ['metric_queries'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const calls = recordCalls(fetchSpy);
    const tokenCall = calls.find((c) => c.url.startsWith(TOKEN_URL_PREFIX));
    expect(tokenCall).toBeDefined();
    expect(tokenCall!.method).toBe('POST');
    expect(tokenCall!.body).toContain('grant_type=client_credentials');
    expect(tokenCall!.body).toContain('client_id=cid');
    expect(tokenCall!.body).toContain(
      'scope=https%3A%2F%2Fmanagement.azure.com%2F.default',
    );
  });

  it('writes metric samples from a metrics response', async () => {
    const fetchSpy = routeFetch({
      '/providers/Microsoft.Insights/metrics': () => ({
        body: {
          value: [
            {
              unit: 'Percent',
              timeseries: [
                {
                  data: [{ timeStamp: '2025-01-01T00:00:00Z', average: 22 }],
                },
              ],
            },
          ],
        },
      }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector({ resources: ['metric_queries'] }).sync(
      { mode: 'full' },
      storage,
    );

    const batch = storage.metrics.mock.calls[0]![0] as Array<{
      name: string;
      value: number;
    }>;
    expect(batch).toHaveLength(1);
    expect(batch[0]!.name).toBe(
      'Microsoft.Compute/virtualMachines/Percentage CPU',
    );
    expect(batch[0]!.value).toBe(22);
  });

  it('clears stale samples in the metric_queries scope on each sync', async () => {
    const fetchSpy = routeFetch({
      '/providers/Microsoft.Insights/metrics': () => ({
        body: { value: [] },
      }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector({ resources: ['metric_queries'] }).sync(
      { mode: 'full' },
      storage,
    );

    const scope = storage.metrics.mock.calls[0]![1] as {
      names: string[];
    };
    expect(scope.names).toEqual([
      'Microsoft.Compute/virtualMachines/Percentage CPU',
    ]);
  });

  it('paginates alerts via nextLink and clears stale alerts', async () => {
    let page = 0;
    const fetchSpy = routeFetch({
      '/providers/Microsoft.AlertsManagement/alerts': () => {
        page += 1;
        if (page === 1) {
          return {
            body: {
              value: [{ id: '/x/a1', name: 'a1' }],
              nextLink:
                'https://management.azure.com/subscriptions/sub-1/providers/Microsoft.AlertsManagement/alerts?api-version=2019-05-05-preview&$skiptoken=abc',
            },
          };
        }
        return {
          body: {
            value: [{ id: '/x/a2', name: 'a2' }],
          },
        };
      },
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector({ resources: ['alerts'] }).sync({ mode: 'full' }, storage);

    const entitiesCall = storage.entities.mock.calls[0]!;
    const items = entitiesCall[0] as Array<{ id: string }>;
    expect(items.map((i) => i.id)).toEqual(['/x/a1', '/x/a2']);
    const scope = entitiesCall[1] as { types: string[] };
    expect(scope.types).toEqual(['azure_alert']);
  });

  it('rejects alerts nextLink pointed at a non-management.azure.com host', async () => {
    let page = 0;
    const fetchSpy = routeFetch({
      '/providers/Microsoft.AlertsManagement/alerts': () => {
        page += 1;
        if (page === 1) {
          return {
            body: {
              value: [{ id: '/x/a1', name: 'a1' }],
              nextLink: 'https://evil.example.com/x/y',
            },
          };
        }
        return { body: { value: [] } };
      },
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector({ resources: ['alerts'] }).sync({ mode: 'full' }, storage);
    expect(page).toBe(1);
    const items = storage.entities.mock.calls[0]![0] as Array<unknown>;
    expect(items).toHaveLength(1);
  });

  it('skips a resource when the runner allowlist does not include it', async () => {
    const fetchSpy = routeFetch({
      '/providers/Microsoft.Insights/metrics': () => ({
        body: { value: [] },
      }),
      '/providers/Microsoft.AlertsManagement/alerts': () => ({
        body: { value: [{ id: '/x/a' }] },
      }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector().sync(
      { mode: 'full', resources: new Set(['metric_queries']) },
      storage,
    );

    expect(storage.metrics).toHaveBeenCalled();
    expect(storage.entities).not.toHaveBeenCalled();
  });

  it('pushes a single alerts spec onto the request URL', async () => {
    const fetchSpy = routeFetch({
      '/providers/Microsoft.AlertsManagement/alerts': () => ({
        body: { value: [] },
      }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    await connector({ resources: ['alerts'] }).sync(
      {
        mode: 'full',
        fetchSpecs: {
          azure_alert: [
            {
              filter: [
                { field: 'severity', op: 'eq', value: 'Sev1' },
                { field: 'state', op: 'eq', value: 'Acknowledged' },
                { field: 'monitorCondition', op: 'eq', value: 'Fired' },
              ],
            },
          ],
        },
      },
      makeStorage(),
    );

    const alertsCall = recordCalls(fetchSpy).find((c) =>
      c.url.includes('/providers/Microsoft.AlertsManagement/alerts'),
    );
    expect(alertsCall).toBeDefined();
    const url = new URL(alertsCall!.url);
    expect(url.searchParams.get('severity')).toBe('Sev1');
    expect(url.searchParams.get('alertState')).toBe('Acknowledged');
    expect(url.searchParams.get('monitorCondition')).toBe('Fired');
  });

  it('does not push alerts filters when more than one spec is provided', async () => {
    const fetchSpy = routeFetch({
      '/providers/Microsoft.AlertsManagement/alerts': () => ({
        body: { value: [] },
      }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    await connector({ resources: ['alerts'] }).sync(
      {
        mode: 'full',
        fetchSpecs: {
          azure_alert: [
            { filter: [{ field: 'severity', op: 'eq', value: 'Sev1' }] },
            { filter: [{ field: 'state', op: 'eq', value: 'Closed' }] },
          ],
        },
      },
      makeStorage(),
    );

    const alertsCall = recordCalls(fetchSpy).find((c) =>
      c.url.includes('/providers/Microsoft.AlertsManagement/alerts'),
    );
    expect(alertsCall).toBeDefined();
    const url = new URL(alertsCall!.url);
    expect(url.searchParams.get('severity')).toBeNull();
    expect(url.searchParams.get('alertState')).toBeNull();
    expect(url.searchParams.get('monitorCondition')).toBeNull();
  });

  it('returns done:true at end of sync', async () => {
    const fetchSpy = routeFetch({
      '/providers/Microsoft.Insights/metrics': () => ({
        body: { value: [] },
      }),
      '/providers/Microsoft.AlertsManagement/alerts': () => ({
        body: { value: [] },
      }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await connector().sync({ mode: 'full' }, makeStorage());
    expect(result.done).toBe(true);
  });
});
