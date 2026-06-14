import { afterEach, describe, expect, it, vi } from 'vitest';

import { DatadogConnector, configFields } from './datadog';

describe('configFields', () => {
  it('parses a valid config with required fields only', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'DD_API_KEY' },
      appKey: { $secret: 'DD_APP_KEY' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a config missing apiKey', () => {
    const result = configFields.safeParse({
      appKey: { $secret: 'DD_APP_KEY' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a config missing appKey', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'DD_API_KEY' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects apiKey passed as a plain string', () => {
    const result = configFields.safeParse({
      apiKey: 'dd_plain',
      appKey: { $secret: 'DD_APP_KEY' },
    });
    expect(result.success).toBe(false);
  });

  it('accepts optional site, resources, metricQueries, and lookback', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'DD_API_KEY' },
      appKey: { $secret: 'DD_APP_KEY' },
      site: 'datadoghq.eu',
      resources: ['monitors', 'incidents'],
      metricQueries: [{ name: 'cpu_user', query: 'avg:system.cpu.user{*}' }],
      metricsLookbackHours: 12,
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty metricQueries array', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'DD_API_KEY' },
      appKey: { $secret: 'DD_APP_KEY' },
      metricQueries: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects metric query with non-alphanumeric name', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'DD_API_KEY' },
      appKey: { $secret: 'DD_APP_KEY' },
      metricQueries: [{ name: 'has-dash', query: 'avg:system.cpu.user{*}' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects metricsLookbackHours above 168', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'DD_API_KEY' },
      appKey: { $secret: 'DD_APP_KEY' },
      metricsLookbackHours: 200,
    });
    expect(result.success).toBe(false);
  });
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

interface MockResponseSpec {
  body: unknown;
  headers?: Record<string, string>;
  status?: number;
}

function mockResponse(spec: MockResponseSpec): Response {
  return {
    ok: spec.status === undefined ? true : spec.status < 400,
    status: spec.status ?? 200,
    statusText: 'OK',
    headers: new Headers({
      'content-type': 'application/json',
      ...(spec.headers ?? {}),
    }),
    text: () => Promise.resolve(JSON.stringify(spec.body)),
  } as Response;
}

function installRouter(route: (url: string) => MockResponseSpec): {
  spy: ReturnType<typeof vi.fn>;
  calls: string[];
} {
  const calls: string[] = [];
  const spy = vi.fn().mockImplementation((url: string | URL) => {
    const u = typeof url === 'string' ? url : url.toString();
    calls.push(u);
    return Promise.resolve(mockResponse(route(u)));
  });
  vi.stubGlobal('fetch', spy);
  return { spy, calls };
}

function makeConnector(
  overrides: Partial<{
    site: string;
    resources: readonly (
      | 'monitors'
      | 'monitor_events'
      | 'incidents'
      | 'slos'
      | 'metric_queries'
    )[];
    metricQueries: readonly { name: string; query: string }[];
    metricsLookbackHours: number;
  }> = {},
): DatadogConnector {
  return new DatadogConnector(
    { ...overrides },
    {
      apiKey: 'dd_api' as unknown as { $secret: string },
      appKey: 'dd_app' as unknown as { $secret: string },
    },
  );
}

function emptyMonitorsBody() {
  return {
    body: {
      monitors: [],
      metadata: { page: 0, page_count: 1, per_page: 100, total_count: 0 },
    },
  };
}

function emptyIncidentsBody() {
  return {
    body: {
      data: [],
      meta: { pagination: { next_offset: null } },
    },
  };
}

function emptySlosBody() {
  return { body: { data: [] } };
}

function emptyTimeseriesBody() {
  return {
    body: {
      data: {
        type: 'timeseries_response',
        attributes: { series: [], times: [], values: [] },
      },
    },
  };
}

function routeAllEmpty(u: string): MockResponseSpec {
  if (u.includes('/api/v1/monitor/search')) {
    return emptyMonitorsBody();
  }
  if (u.includes('/api/v2/incidents')) {
    return emptyIncidentsBody();
  }
  if (u.includes('/api/v1/slo')) {
    return emptySlosBody();
  }
  if (u.includes('/api/v2/query/timeseries')) {
    return emptyTimeseriesBody();
  }
  throw new Error(`Unexpected URL ${u}`);
}

describe('DatadogConnector.sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns done:true when every endpoint returns empty', async () => {
    installRouter(routeAllEmpty);
    const result = await makeConnector().sync({ mode: 'full' }, makeStorage());
    expect(result.done).toBe(true);
  });

  it('sends DD-API-KEY and DD-APPLICATION-KEY headers', async () => {
    const { spy } = installRouter(routeAllEmpty);
    await makeConnector().sync({ mode: 'full' }, makeStorage());
    expect(spy).toHaveBeenCalled();
    const firstCall = spy.mock.calls[0]!;
    const init = firstCall[1] as RequestInit;
    expect(init.headers).toMatchObject({
      'dd-api-key': 'dd_api',
      'dd-application-key': 'dd_app',
    });
  });

  it('clears incident, slo, slo metric entries on full sync first page', async () => {
    installRouter(routeAllEmpty);
    const storage = makeStorage();
    await makeConnector().sync({ mode: 'full' }, storage);

    const clearedTypes = storage.entities.mock.calls
      .filter((c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0)
      .map((c) => (c[1] as { types: string[] }).types[0]);
    expect(clearedTypes).toEqual(
      expect.arrayContaining(['datadog_incident', 'datadog_slo']),
    );

    const clearedMetricNames = storage.metrics.mock.calls
      .filter((c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0)
      .map((c) => (c[1] as { names: string[] }).names[0]);
    expect(clearedMetricNames).toContain('datadog_slo_sli');
  });

  it('does NOT clear monitor entities on full sync (entities serve as event diff baseline)', async () => {
    installRouter(routeAllEmpty);
    const storage = makeStorage();
    await makeConnector().sync({ mode: 'full' }, storage);

    const clearedTypes = storage.entities.mock.calls
      .filter((c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0)
      .map((c) => (c[1] as { types: string[] }).types[0]);
    expect(clearedTypes).not.toContain('datadog_monitor');
  });

  it('does not clear storage in latest (incremental) mode', async () => {
    installRouter(routeAllEmpty);
    const storage = makeStorage();
    await makeConnector().sync(
      { mode: 'latest', since: new Date(Date.now() - 60_000).toISOString() },
      storage,
    );

    const entityClears = storage.entities.mock.calls.filter(
      (c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0,
    );
    expect(entityClears).toHaveLength(0);
  });

  it('writes monitor entities with status attributes', async () => {
    const connector = makeConnector({ resources: ['monitors'] });
    installRouter((u) => {
      if (u.includes('/api/v1/monitor/search')) {
        return {
          body: {
            monitors: [
              {
                id: 42,
                name: 'High CPU',
                type: 'metric alert',
                status: 'Alert',
                priority: 1,
                tags: ['service:web'],
                created: '2024-05-01T00:00:00.000Z',
                modified: '2024-05-02T00:00:00.000Z',
                overall_state_modified: '2024-05-02T00:00:00.000Z',
              },
            ],
            metadata: {
              page: 0,
              page_count: 1,
              per_page: 100,
              total_count: 1,
            },
          },
        };
      }
      return routeAllEmpty(u);
    });
    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const monitors = storage.entity.mock.calls
      .map(
        (c) =>
          c[0] as {
            type: string;
            id: string;
            attributes: Record<string, unknown>;
          },
      )
      .filter((e) => e.type === 'datadog_monitor');
    expect(monitors).toHaveLength(1);
    expect(monitors[0]!.id).toBe('42');
    expect(monitors[0]!.attributes.status).toBe('Alert');
    expect(monitors[0]!.attributes.priority).toBe(1);
    expect(monitors[0]!.attributes.tags).toEqual(['service:web']);
  });

  it('emits monitor_event when prior status differs from current', async () => {
    const connector = makeConnector({
      resources: ['monitors', 'monitor_events'],
    });
    installRouter((u) => {
      if (u.includes('/api/v1/monitor/search')) {
        return {
          body: {
            monitors: [
              {
                id: 7,
                name: 'Latency',
                type: 'metric alert',
                status: 'Alert',
                priority: 2,
                tags: [],
                created: '2024-05-01T00:00:00.000Z',
                modified: '2024-05-02T00:00:00.000Z',
                overall_state_modified: '2024-05-02T00:00:00.000Z',
              },
            ],
            metadata: {
              page: 0,
              page_count: 1,
              per_page: 100,
              total_count: 1,
            },
          },
        };
      }
      return routeAllEmpty(u);
    });
    const storage = makeStorage();
    storage.getEntity.mockResolvedValueOnce({
      type: 'datadog_monitor',
      id: '7',
      attributes: { status: 'OK' },
      updated_at: 0,
    });

    await connector.sync({ mode: 'full' }, storage);

    const events = storage.event.mock.calls
      .map((c) => c[0] as { name: string; attributes: Record<string, unknown> })
      .filter((e) => e.name === 'datadog_monitor_event');
    expect(events).toHaveLength(1);
    expect(events[0]!.attributes.fromStatus).toBe('OK');
    expect(events[0]!.attributes.toStatus).toBe('Alert');
  });

  it('does not emit monitor_event when prior status matches', async () => {
    const connector = makeConnector({
      resources: ['monitors', 'monitor_events'],
    });
    installRouter((u) => {
      if (u.includes('/api/v1/monitor/search')) {
        return {
          body: {
            monitors: [
              {
                id: 7,
                name: 'Latency',
                type: 'metric alert',
                status: 'OK',
                priority: 2,
                tags: [],
                created: '2024-05-01T00:00:00.000Z',
                modified: '2024-05-02T00:00:00.000Z',
                overall_state_modified: '2024-05-02T00:00:00.000Z',
              },
            ],
            metadata: {
              page: 0,
              page_count: 1,
              per_page: 100,
              total_count: 1,
            },
          },
        };
      }
      return routeAllEmpty(u);
    });
    const storage = makeStorage();
    storage.getEntity.mockResolvedValueOnce({
      type: 'datadog_monitor',
      id: '7',
      attributes: { status: 'OK' },
      updated_at: 0,
    });

    await connector.sync({ mode: 'full' }, storage);

    const events = storage.event.mock.calls
      .map((c) => c[0] as { name: string })
      .filter((e) => e.name === 'datadog_monitor_event');
    expect(events).toHaveLength(0);
  });

  it('paginates monitor search via page_count', async () => {
    const { calls } = installRouter((u) => {
      if (u.includes('/api/v1/monitor/search')) {
        const url = new URL(u);
        const page = Number(url.searchParams.get('page') ?? '0');
        if (page === 0) {
          return {
            body: {
              monitors: [],
              metadata: {
                page: 0,
                page_count: 2,
                per_page: 100,
                total_count: 100,
              },
            },
          };
        }
        return {
          body: {
            monitors: [],
            metadata: {
              page: 1,
              page_count: 2,
              per_page: 100,
              total_count: 100,
            },
          },
        };
      }
      return routeAllEmpty(u);
    });
    await makeConnector({ resources: ['monitors'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const monitorCalls = calls.filter((c) =>
      c.includes('/api/v1/monitor/search'),
    );
    expect(monitorCalls).toHaveLength(2);
    expect(monitorCalls[1]).toContain('page=1');
  });

  it('writes incident entities', async () => {
    const connector = makeConnector({ resources: ['incidents'] });
    installRouter((u) => {
      if (u.includes('/api/v2/incidents')) {
        return {
          body: {
            data: [
              {
                id: 'inc_1',
                type: 'incidents',
                attributes: {
                  title: 'API down',
                  severity: 'SEV-2',
                  state: 'active',
                  created: '2024-05-01T00:00:00.000Z',
                  modified: '2024-05-01T01:00:00.000Z',
                  resolved: null,
                },
              },
            ],
            meta: { pagination: { next_offset: null } },
          },
        };
      }
      return routeAllEmpty(u);
    });
    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const incidents = storage.entity.mock.calls
      .map(
        (c) =>
          c[0] as {
            type: string;
            id: string;
            attributes: Record<string, unknown>;
          },
      )
      .filter((e) => e.type === 'datadog_incident');
    expect(incidents).toHaveLength(1);
    expect(incidents[0]!.id).toBe('inc_1');
    expect(incidents[0]!.attributes.title).toBe('API down');
    expect(incidents[0]!.attributes.severity).toBe('SEV-2');
    expect(incidents[0]!.attributes.resolvedAt).toBeNull();
  });

  it('applies since filter on incidents in latest mode', async () => {
    const { calls } = installRouter(routeAllEmpty);
    const since = '2024-05-01T00:00:00.000Z';
    await makeConnector({ resources: ['incidents'] }).sync(
      { mode: 'latest', since },
      makeStorage(),
    );
    const incidentsCall = calls.find((c) => c.includes('/api/v2/incidents'));
    expect(incidentsCall).toBeDefined();
    const params = new URL(incidentsCall!).searchParams;
    const filterEntries: [string, string][] = [];
    params.forEach((value, key) => {
      if (key.startsWith('filter[')) {
        filterEntries.push([key, value]);
      }
    });
    expect(filterEntries.length).toBeGreaterThan(0);
    expect(filterEntries.some(([, v]) => v === since)).toBe(true);
  });

  it('writes slo entities and sli metrics from the history endpoint', async () => {
    const connector = makeConnector({ resources: ['slos'] });
    installRouter((u) => {
      if (u.includes('/api/v1/slo/slo_1/history')) {
        return {
          body: {
            data: {
              from_ts: 1711929600,
              to_ts: 1714608000,
              overall: { sli_value: 99.95 },
            },
          },
        };
      }
      if (u.includes('/api/v1/slo')) {
        return {
          body: {
            data: [
              {
                id: 'slo_1',
                name: 'API uptime',
                type: 'monitor',
                thresholds: [{ timeframe: '30d', target: 99.9 }],
                created_at: 1714000000,
                modified_at: 1714500000,
              },
            ],
          },
        };
      }
      return routeAllEmpty(u);
    });
    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const slos = storage.entity.mock.calls
      .map(
        (c) =>
          c[0] as {
            type: string;
            id: string;
            attributes: Record<string, unknown>;
          },
      )
      .filter((e) => e.type === 'datadog_slo');
    expect(slos).toHaveLength(1);
    expect(slos[0]!.attributes.target).toBe(99.9);
    expect(slos[0]!.attributes.latestSliValue).toBe(99.95);

    const sliSamples = storage.metrics.mock.calls
      .map((c) => c[0] as Array<{ name: string; value: number; ts: number }>)
      .filter((arr) => Array.isArray(arr) && arr.length > 0)
      .flat()
      .filter((m) => m.name === 'datadog_slo_sli');
    expect(sliSamples).toHaveLength(1);
    expect(sliSamples[0]!.value).toBe(99.95);
    expect(sliSamples[0]!.ts).toBe(1714608000 * 1000);
  });

  it('requests slo history over a window derived from the threshold timeframe', async () => {
    const connector = makeConnector({ resources: ['slos'] });
    const { calls } = installRouter((u) => {
      if (u.includes('/api/v1/slo/slo_1/history')) {
        return { body: { data: { overall: { sli_value: 99.9 } } } };
      }
      if (u.includes('/api/v1/slo')) {
        return {
          body: {
            data: [
              {
                id: 'slo_1',
                name: 'API uptime',
                type: 'monitor',
                thresholds: [{ timeframe: '30d', target: 99.9 }],
                created_at: 1714000000,
                modified_at: 1714500000,
              },
            ],
          },
        };
      }
      return routeAllEmpty(u);
    });
    await connector.sync({ mode: 'full' }, makeStorage());

    const historyCall = calls.find((c) => c.includes('/history'));
    expect(historyCall).toBeDefined();
    const params = new URL(historyCall!).searchParams;
    const fromTs = Number(params.get('from_ts'));
    const toTs = Number(params.get('to_ts'));
    expect(toTs - fromTs).toBe(30 * 24 * 60 * 60);
  });

  it('posts metric query body to /query/timeseries and writes samples', async () => {
    const connector = makeConnector({
      resources: ['metric_queries'],
      metricQueries: [{ name: 'cpu_user', query: 'avg:system.cpu.user{*}' }],
    });
    const requestBodies: unknown[] = [];
    const spy = vi
      .fn()
      .mockImplementation((url: string | URL, init?: RequestInit) => {
        const u = typeof url === 'string' ? url : url.toString();
        if (u.includes('/api/v2/query/timeseries')) {
          if (init?.body) {
            requestBodies.push(JSON.parse(init.body as string));
          }
          return Promise.resolve(
            mockResponse({
              body: {
                data: {
                  type: 'timeseries_response',
                  attributes: {
                    series: [{ group_tags: ['env:prod'], query_index: 0 }],
                    times: [1714521600000, 1714525200000],
                    values: [[10.5, 12.5]],
                  },
                },
              },
            }),
          );
        }
        return Promise.resolve(mockResponse(routeAllEmpty(u)));
      });
    vi.stubGlobal('fetch', spy);

    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    expect(requestBodies).toHaveLength(1);
    const body = requestBodies[0] as {
      data: {
        attributes: {
          queries: Array<{ query: string }>;
        };
      };
    };
    expect(body.data.attributes.queries[0]!.query).toBe(
      'avg:system.cpu.user{*}',
    );

    const allMetrics = storage.metrics.mock.calls
      .map((c) => c[0] as Array<{ name: string; value: number; ts: number }>)
      .filter((arr) => Array.isArray(arr) && arr.length > 0)
      .flat();
    const cpuSamples = allMetrics.filter(
      (m) => m.name === 'datadog_metric.cpu_user',
    );
    expect(cpuSamples).toHaveLength(2);
    expect(cpuSamples[0]!.value).toBe(10.5);
    expect(cpuSamples[1]!.value).toBe(12.5);
  });

  it('skips metric phase when no queries are declared', async () => {
    const { calls } = installRouter(routeAllEmpty);
    await makeConnector({ resources: ['metric_queries'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );
    const metricsCalls = calls.filter((c) =>
      c.includes('/api/v2/query/timeseries'),
    );
    expect(metricsCalls).toHaveLength(0);
  });

  it('honors the configured site for the API host', async () => {
    const { calls } = installRouter(routeAllEmpty);
    await makeConnector({ site: 'datadoghq.eu' }).sync(
      { mode: 'full' },
      makeStorage(),
    );
    expect(calls.every((c) => c.startsWith('https://api.datadoghq.eu/'))).toBe(
      true,
    );
  });
});

describe('DatadogConnector filter pushdown', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function monitorSearchUrl(calls: string[]): URL {
    const url = calls.find((u) => u.includes('/api/v1/monitor/search'));
    expect(url).toBeDefined();
    return new URL(url!);
  }

  async function syncWith(
    fetchSpecs: Record<string, { filter: unknown[] }[]>,
  ): Promise<string[]> {
    const { calls } = installRouter(routeAllEmpty);
    await makeConnector({ resources: ['monitors'] }).sync(
      { mode: 'full', fetchSpecs: fetchSpecs as never },
      makeStorage(),
    );
    return calls;
  }

  it('pushes a declared status filter into the monitor search query', async () => {
    const calls = await syncWith({
      datadog_monitor: [
        { filter: [{ field: 'status', op: 'eq', value: 'Alert' }] },
      ],
    });
    expect(monitorSearchUrl(calls).searchParams.get('query')).toBe(
      'status:"Alert"',
    );
  });

  it('does not push when multiple specs target the resource', async () => {
    const calls = await syncWith({
      datadog_monitor: [
        { filter: [{ field: 'status', op: 'eq', value: 'Alert' }] },
        { filter: [{ field: 'status', op: 'eq', value: 'OK' }] },
      ],
    });
    expect(monitorSearchUrl(calls).searchParams.get('query')).toBeNull();
  });
});

describe('DatadogConnector response schemas', () => {
  function monitorPayload(status: string) {
    return {
      monitors: [
        {
          id: 1,
          name: 'A monitor',
          type: 'metric alert',
          status,
          priority: 1,
          tags: [],
          created: '2024-05-01T00:00:00.000Z',
          modified: '2024-05-02T00:00:00.000Z',
        },
      ],
      metadata: { page: 0, page_count: 1, per_page: 100, total_count: 1 },
    };
  }

  it('parses a monitor with status Skipped without throwing', () => {
    const result = DatadogConnector.schemas.monitors.safeParse(
      monitorPayload('Skipped'),
    );
    expect(result.success).toBe(true);
  });

  it('parses a monitor with status Unknown without throwing', () => {
    const result = DatadogConnector.schemas.monitors.safeParse(
      monitorPayload('Unknown'),
    );
    expect(result.success).toBe(true);
  });

  it('parses a timeseries response containing a null value', () => {
    const result = DatadogConnector.schemas.metric_queries.safeParse({
      data: {
        type: 'timeseries_response',
        attributes: {
          series: [{ group_tags: [], query_index: 0 }],
          times: [1714521600000, 1714525200000, 1714528800000],
          values: [[10.5, null, 12.5]],
        },
      },
    });
    expect(result.success).toBe(true);
  });
});

describe('DatadogConnector timeseries gaps', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('skips null gap points when writing metric samples', async () => {
    const connector = makeConnector({
      resources: ['metric_queries'],
      metricQueries: [{ name: 'cpu_user', query: 'avg:system.cpu.user{*}' }],
    });
    installRouter((u) => {
      if (u.includes('/api/v2/query/timeseries')) {
        return {
          body: {
            data: {
              type: 'timeseries_response',
              attributes: {
                series: [{ group_tags: ['env:prod'], query_index: 0 }],
                times: [1714521600000, 1714525200000, 1714528800000],
                values: [[10.5, null, 12.5]],
              },
            },
          },
        };
      }
      return routeAllEmpty(u);
    });
    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const samples = storage.metrics.mock.calls
      .map((c) => c[0] as Array<{ name: string; value: number }>)
      .filter((arr) => Array.isArray(arr) && arr.length > 0)
      .flat()
      .filter((m) => m.name === 'datadog_metric.cpu_user');
    expect(samples).toHaveLength(2);
    expect(samples.map((s) => s.value)).toEqual([10.5, 12.5]);
  });
});
