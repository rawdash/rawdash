import { afterEach, describe, expect, it, vi } from 'vitest';

import { NewRelicConnector, configFields } from './new-relic';

// ---------------------------------------------------------------------------
// configFields
// ---------------------------------------------------------------------------

describe('configFields', () => {
  it('parses a valid config with required fields only', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'NEWRELIC_USER_KEY' },
      accountId: 42,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a config missing apiKey', () => {
    const result = configFields.safeParse({
      accountId: 42,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a config missing accountId', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'NEWRELIC_USER_KEY' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects apiKey passed as a plain string', () => {
    const result = configFields.safeParse({
      apiKey: 'plain',
      accountId: 42,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a negative accountId', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'NEWRELIC_USER_KEY' },
      accountId: -1,
    });
    expect(result.success).toBe(false);
  });

  it('accepts optional region, resources, nrqlQueries, and lookbacks', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'NEWRELIC_USER_KEY' },
      accountId: 42,
      region: 'EU',
      resources: ['alerts', 'nrql_queries'],
      nrqlQueries: [
        { name: 'error_rate', query: 'SELECT count(*) FROM Transaction' },
      ],
      incidentsLookbackHours: 24,
      metricsLookbackHours: 12,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a region outside US/EU', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'NEWRELIC_USER_KEY' },
      accountId: 42,
      region: 'APAC',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty nrqlQueries array', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'NEWRELIC_USER_KEY' },
      accountId: 42,
      nrqlQueries: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an nrql query with a non-alphanumeric name', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'NEWRELIC_USER_KEY' },
      accountId: 42,
      nrqlQueries: [
        { name: 'has-dash', query: 'SELECT count(*) FROM Transaction' },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects metricsLookbackHours above 168', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'NEWRELIC_USER_KEY' },
      accountId: 42,
      metricsLookbackHours: 200,
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test scaffolding
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

interface GraphQLCall {
  query: string;
  variables: Record<string, unknown>;
}

interface MockedCall {
  url: string;
  init: RequestInit;
  parsed: GraphQLCall;
}

function operationName(query: string): string {
  return query.match(/query\s+(\w+)/)?.[1] ?? '';
}

function emptyData() {
  return {
    actor: {
      account: {
        alerts: {
          nrqlConditionsSearch: {
            nrqlConditions: [],
            nextCursor: null,
            totalCount: 0,
          },
        },
        nrql: { results: [], metadata: { facets: null, timeWindow: null } },
      },
    },
  };
}

function installGraphqlRouter(
  responseFor: (op: string, call: GraphQLCall) => unknown = () => emptyData(),
): { spy: ReturnType<typeof vi.fn>; calls: MockedCall[] } {
  const calls: MockedCall[] = [];
  const spy = vi
    .fn()
    .mockImplementation((url: string | URL, init: RequestInit) => {
      const u = typeof url === 'string' ? url : url.toString();
      const parsed = JSON.parse(init.body as string) as GraphQLCall;
      calls.push({ url: u, init, parsed });
      const data = responseFor(operationName(parsed.query), parsed);
      return Promise.resolve(
        new Response(JSON.stringify({ data }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });
  vi.stubGlobal('fetch', spy);
  return { spy, calls };
}

function makeConnector(
  overrides: Partial<{
    accountId: number;
    region: 'US' | 'EU';
    resources: readonly ('alerts' | 'alert_violations' | 'nrql_queries')[];
    nrqlQueries: readonly { name: string; query: string }[];
    incidentsLookbackHours: number;
    metricsLookbackHours: number;
  }> = {},
): NewRelicConnector {
  const { accountId = 42, ...rest } = overrides;
  return new NewRelicConnector(
    { accountId, ...rest },
    { apiKey: 'nrak_test' as unknown as { $secret: string } },
  );
}

// ---------------------------------------------------------------------------
// NewRelicConnector.sync
// ---------------------------------------------------------------------------

describe('NewRelicConnector.sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns done:true when every endpoint returns empty', async () => {
    installGraphqlRouter();
    const result = await makeConnector().sync({ mode: 'full' }, makeStorage());
    expect(result.done).toBe(true);
  });

  it('sends API-Key and Content-Type headers', async () => {
    const { spy } = installGraphqlRouter();
    await makeConnector().sync({ mode: 'full' }, makeStorage());
    expect(spy).toHaveBeenCalled();
    const firstCall = spy.mock.calls[0]!;
    const init = firstCall[1] as RequestInit;
    expect(init.headers).toMatchObject({
      'api-key': 'nrak_test',
      'content-type': 'application/json',
    });
  });

  it('targets the US endpoint by default', async () => {
    const { calls } = installGraphqlRouter();
    await makeConnector().sync({ mode: 'full' }, makeStorage());
    expect(
      calls.every((c) => c.url === 'https://api.newrelic.com/graphql'),
    ).toBe(true);
  });

  it('targets the EU endpoint when region is EU', async () => {
    const { calls } = installGraphqlRouter();
    await makeConnector({ region: 'EU' }).sync({ mode: 'full' }, makeStorage());
    expect(
      calls.every((c) => c.url === 'https://api.eu.newrelic.com/graphql'),
    ).toBe(true);
  });

  it('clears alert conditions, violations, and metric samples on full sync', async () => {
    installGraphqlRouter();
    const storage = makeStorage();
    await makeConnector({
      nrqlQueries: [{ name: 'cpu', query: 'SELECT average(cpu) FROM Metric' }],
    }).sync({ mode: 'full' }, storage);

    const clearedTypes = storage.entities.mock.calls
      .filter((c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0)
      .map((c) => (c[1] as { types: string[] }).types[0]);
    expect(clearedTypes).toContain('newrelic_alert_condition');

    const clearedEventNames = storage.events.mock.calls
      .filter((c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0)
      .map((c) => (c[1] as { names: string[] }).names[0]);
    expect(clearedEventNames).toContain('newrelic_alert_violation');

    const clearedMetricNames = storage.metrics.mock.calls
      .filter((c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0)
      .map((c) => (c[1] as { names: string[] }).names[0]);
    expect(clearedMetricNames).toContain('newrelic_nrql_metric.cpu');
  });

  it('does not clear storage in latest (incremental) mode', async () => {
    installGraphqlRouter();
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

  it('writes alert condition entities', async () => {
    const connector = makeConnector({ resources: ['alerts'] });
    installGraphqlRouter((op) => {
      if (op === 'AlertConditions') {
        return {
          actor: {
            account: {
              alerts: {
                nrqlConditionsSearch: {
                  nrqlConditions: [
                    {
                      id: 'cond_1',
                      name: 'High CPU',
                      enabled: true,
                      policyId: 'pol_1',
                      type: 'STATIC',
                      createdAt: 1714000000000,
                      updatedAt: 1714500000000,
                      nrql: { query: 'SELECT average(cpu) FROM Metric' },
                    },
                  ],
                  nextCursor: null,
                  totalCount: 1,
                },
              },
            },
          },
        };
      }
      return emptyData();
    });
    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const conditions = storage.entity.mock.calls
      .map(
        (c) =>
          c[0] as {
            type: string;
            id: string;
            attributes: Record<string, unknown>;
          },
      )
      .filter((e) => e.type === 'newrelic_alert_condition');
    expect(conditions).toHaveLength(1);
    expect(conditions[0]!.id).toBe('cond_1');
    expect(conditions[0]!.attributes.policyId).toBe('pol_1');
    expect(conditions[0]!.attributes.enabled).toBe(true);
    expect(conditions[0]!.attributes.nrqlQuery).toBe(
      'SELECT average(cpu) FROM Metric',
    );
  });

  it('paginates alert conditions via nextCursor', async () => {
    const { calls } = installGraphqlRouter((op, call) => {
      if (op === 'AlertConditions') {
        const cursor = call.variables.cursor as string | null;
        if (cursor === null) {
          return {
            actor: {
              account: {
                alerts: {
                  nrqlConditionsSearch: {
                    nrqlConditions: [],
                    nextCursor: 'next-1',
                    totalCount: 0,
                  },
                },
              },
            },
          };
        }
        return {
          actor: {
            account: {
              alerts: {
                nrqlConditionsSearch: {
                  nrqlConditions: [],
                  nextCursor: null,
                  totalCount: 0,
                },
              },
            },
          },
        };
      }
      return emptyData();
    });
    await makeConnector({ resources: ['alerts'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const alertCalls = calls.filter(
      (c) => operationName(c.parsed.query) === 'AlertConditions',
    );
    expect(alertCalls).toHaveLength(2);
    expect(alertCalls[1]!.parsed.variables.cursor).toBe('next-1');
  });

  it('writes alert violation events from NrAiIncident rows', async () => {
    const connector = makeConnector({ resources: ['alert_violations'] });
    installGraphqlRouter((op) => {
      if (op === 'RunNrql') {
        return {
          actor: {
            account: {
              nrql: {
                results: [
                  {
                    incidentId: 'inc_42',
                    conditionFamilyId: 'cf_7',
                    conditionName: 'High latency',
                    policyName: 'API SLO',
                    openedAt: 1714521600000,
                    closedAt: 1714525200000,
                    durationSeconds: 3600,
                    priority: 'CRITICAL',
                    title: 'API latency above threshold',
                    state: 'CLOSED',
                  },
                ],
                metadata: { facets: null, timeWindow: null },
              },
            },
          },
        };
      }
      return emptyData();
    });
    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const events = storage.event.mock.calls
      .map(
        (c) =>
          c[0] as {
            name: string;
            start_ts: number;
            end_ts: number | null;
            attributes: Record<string, unknown>;
          },
      )
      .filter((e) => e.name === 'newrelic_alert_violation');
    expect(events).toHaveLength(1);
    expect(events[0]!.start_ts).toBe(1714521600000);
    expect(events[0]!.end_ts).toBe(1714525200000);
    expect(events[0]!.attributes.incidentId).toBe('inc_42');
    expect(events[0]!.attributes.priority).toBe('CRITICAL');
  });

  it('skips incident rows missing incidentId or openedAt', async () => {
    const connector = makeConnector({ resources: ['alert_violations'] });
    installGraphqlRouter((op) => {
      if (op === 'RunNrql') {
        return {
          actor: {
            account: {
              nrql: {
                results: [
                  { openedAt: 1, conditionName: 'no id' },
                  { incidentId: 'has-id-no-openedAt' },
                  {
                    incidentId: 'inc_real',
                    openedAt: 1714521600000,
                    closedAt: null,
                  },
                ],
                metadata: { facets: null, timeWindow: null },
              },
            },
          },
        };
      }
      return emptyData();
    });
    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const events = storage.event.mock.calls
      .map((c) => c[0] as { name: string; attributes: Record<string, unknown> })
      .filter((e) => e.name === 'newrelic_alert_violation');
    expect(events).toHaveLength(1);
    expect(events[0]!.attributes.incidentId).toBe('inc_real');
  });

  it('filters incidents by options.since when provided', async () => {
    const { calls } = installGraphqlRouter();
    const since = new Date(1714521600000).toISOString();
    await makeConnector({ resources: ['alert_violations'] }).sync(
      { mode: 'latest', since },
      makeStorage(),
    );
    const nrqlCalls = calls.filter(
      (c) => operationName(c.parsed.query) === 'RunNrql',
    );
    expect(nrqlCalls).toHaveLength(1);
    const query = nrqlCalls[0]!.parsed.variables.query as string;
    expect(query).toContain('FROM NrAiIncident');
    expect(query).toContain('openedAt > 1714521600000');
  });

  it('runs each declared NRQL query and writes metric samples', async () => {
    const connector = makeConnector({
      resources: ['nrql_queries'],
      nrqlQueries: [
        { name: 'error_rate', query: 'SELECT count(*) FROM Transaction' },
      ],
    });
    installGraphqlRouter((op) => {
      if (op === 'RunNrql') {
        return {
          actor: {
            account: {
              nrql: {
                results: [
                  {
                    beginTimeSeconds: 1714521600,
                    endTimeSeconds: 1714525200,
                    'count.value': 17,
                  },
                  {
                    beginTimeSeconds: 1714525200,
                    endTimeSeconds: 1714528800,
                    'count.value': 25,
                  },
                ],
                metadata: { facets: null, timeWindow: null },
              },
            },
          },
        };
      }
      return emptyData();
    });
    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const metricBatches = storage.metrics.mock.calls
      .map((c) => c[0] as Array<{ name: string; value: number }>)
      .filter((arr) => Array.isArray(arr) && arr.length > 0);
    const samples = metricBatches
      .flat()
      .filter((m) => m.name === 'newrelic_nrql_metric.error_rate');
    expect(samples).toHaveLength(2);
    expect(samples[0]!.value).toBe(17);
    expect(samples[1]!.value).toBe(25);
  });

  it('appends a SINCE clause to NRQL queries that lack one', async () => {
    const { calls } = installGraphqlRouter();
    await makeConnector({
      resources: ['nrql_queries'],
      nrqlQueries: [{ name: 'q1', query: 'SELECT average(cpu) FROM Metric' }],
      metricsLookbackHours: 6,
    }).sync({ mode: 'full' }, makeStorage());
    const nrqlCall = calls.find(
      (c) => operationName(c.parsed.query) === 'RunNrql',
    );
    expect(nrqlCall).toBeDefined();
    expect(nrqlCall!.parsed.variables.query).toBe(
      'SELECT average(cpu) FROM Metric SINCE 6 hours ago',
    );
  });

  it('leaves NRQL queries with their own SINCE clause untouched', async () => {
    const { calls } = installGraphqlRouter();
    await makeConnector({
      resources: ['nrql_queries'],
      nrqlQueries: [
        {
          name: 'q1',
          query: 'SELECT count(*) FROM Transaction SINCE 1 day ago',
        },
      ],
    }).sync({ mode: 'full' }, makeStorage());
    const nrqlCall = calls.find(
      (c) => operationName(c.parsed.query) === 'RunNrql',
    );
    expect(nrqlCall!.parsed.variables.query).toBe(
      'SELECT count(*) FROM Transaction SINCE 1 day ago',
    );
  });

  it('skips the metrics phase when no queries are declared', async () => {
    const { calls } = installGraphqlRouter();
    await makeConnector({ resources: ['nrql_queries'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );
    // Only the empty-result NRQL setup may fire, but the metrics phase shouldn't issue any RunNrql calls.
    const nrqlCalls = calls.filter(
      (c) => operationName(c.parsed.query) === 'RunNrql',
    );
    expect(nrqlCalls).toHaveLength(0);
  });

  it('reports NerdGraph error responses as transient errors on the cursor', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ errors: [{ message: 'bad key' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const result = await makeConnector({ resources: ['alerts'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );
    expect(result.done).toBe(false);
    expect(result.transientError).toBeInstanceOf(Error);
    expect((result.transientError as Error).message).toMatch(/bad key/);
  });
});
