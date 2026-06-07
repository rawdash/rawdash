import { afterEach, describe, expect, it, vi } from 'vitest';

import { StatuspageConnector, configFields } from './statuspage';

// ---------------------------------------------------------------------------
// configFields
// ---------------------------------------------------------------------------

describe('configFields', () => {
  it('parses a valid config with required fields only', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'STATUSPAGE_API_KEY' },
      pageId: 'abc123',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a config missing apiKey', () => {
    const result = configFields.safeParse({ pageId: 'abc123' });
    expect(result.success).toBe(false);
  });

  it('rejects a config missing pageId', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'STATUSPAGE_API_KEY' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an apiKey passed as a plain string', () => {
    const result = configFields.safeParse({
      apiKey: 'plain-key',
      pageId: 'abc123',
    });
    expect(result.success).toBe(false);
  });

  it('accepts optional resources and incidentLookbackDays', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'STATUSPAGE_API_KEY' },
      pageId: 'abc123',
      resources: ['components', 'incidents'],
      incidentLookbackDays: 30,
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty resources array', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'STATUSPAGE_API_KEY' },
      pageId: 'abc123',
      resources: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects incidentLookbackDays above 365', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'STATUSPAGE_API_KEY' },
      pageId: 'abc123',
      incidentLookbackDays: 500,
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
    pageId: string;
    resources: readonly ('components' | 'incidents' | 'incident_updates')[];
    incidentLookbackDays: number;
  }> = {},
): StatuspageConnector {
  return new StatuspageConnector(
    {
      pageId: overrides.pageId ?? 'page-1',
      resources: overrides.resources,
      incidentLookbackDays: overrides.incidentLookbackDays,
    },
    { apiKey: 'api-test' as unknown as { $secret: string } },
  );
}

function emptyComponentsBody() {
  return { body: [] };
}

function emptyIncidentsBody() {
  return { body: [] };
}

function routeDefault(url: string): MockResponseSpec {
  if (url.includes('/components')) {
    return emptyComponentsBody();
  }
  if (url.includes('/incidents')) {
    return emptyIncidentsBody();
  }
  throw new Error(`Unexpected request URL in test router: ${url}`);
}

// ---------------------------------------------------------------------------
// StatuspageConnector — sync
// ---------------------------------------------------------------------------

describe('StatuspageConnector.sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns done:true when every endpoint returns empty', async () => {
    installRouter(routeDefault);
    const result = await makeConnector().sync({ mode: 'full' }, makeStorage());
    expect(result.done).toBe(true);
  });

  it('clears entity types and event names on full sync first page', async () => {
    installRouter(routeDefault);
    const storage = makeStorage();
    await makeConnector().sync({ mode: 'full' }, storage);

    const clearedTypes = storage.entities.mock.calls
      .filter((c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0)
      .map((c) => (c[1] as { types: string[] }).types[0]);
    expect(clearedTypes).toEqual(
      expect.arrayContaining(['statuspage_component', 'statuspage_incident']),
    );

    const clearedEvents = storage.events.mock.calls
      .filter((c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0)
      .map((c) => (c[1] as { names: string[] }).names[0]);
    expect(clearedEvents).toContain('statuspage_incident_update');
  });

  it('does not clear storage in latest (incremental) mode', async () => {
    installRouter(routeDefault);
    const storage = makeStorage();
    await makeConnector().sync(
      { mode: 'latest', since: new Date(Date.now() - 60_000).toISOString() },
      storage,
    );

    const entityClears = storage.entities.mock.calls.filter(
      (c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0,
    );
    const eventClears = storage.events.mock.calls.filter(
      (c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0,
    );
    expect(entityClears).toHaveLength(0);
    expect(eventClears).toHaveLength(0);
  });

  it('writes component entities', async () => {
    const connector = makeConnector({ resources: ['components'] });
    installRouter((u) => {
      if (u.includes('/components')) {
        return {
          body: [
            {
              id: 'c1',
              page_id: 'page-1',
              name: 'API',
              status: 'operational',
              group_id: 'g1',
              created_at: '2024-04-01T00:00:00Z',
              updated_at: '2024-05-01T00:00:00Z',
            },
            {
              id: 'c2',
              page_id: 'page-1',
              name: 'Web',
              status: 'degraded_performance',
              group_id: null,
              only_show_if_degraded: true,
            },
          ],
        };
      }
      return routeDefault(u);
    });
    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const components = storage.entity.mock.calls
      .map(
        (c) =>
          c[0] as {
            type: string;
            id: string;
            attributes: Record<string, unknown>;
          },
      )
      .filter((e) => e.type === 'statuspage_component');
    expect(components).toHaveLength(2);
    expect(components.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(components[0]!.attributes.status).toBe('operational');
    expect(components[0]!.attributes.groupId).toBe('g1');
    expect(components[1]!.attributes.onlyShowIfDegraded).toBe(true);
  });

  it('writes incident entities and inline incident_update events', async () => {
    const connector = makeConnector({
      resources: ['incidents', 'incident_updates'],
    });
    const createdAtIso = new Date(Date.now() - 60_000).toISOString();
    const resolvedAtIso = new Date(Date.now() - 30_000).toISOString();
    installRouter((u) => {
      if (u.includes('/incidents')) {
        return {
          body: [
            {
              id: 'inc1',
              name: 'Database outage',
              status: 'resolved',
              impact: 'major',
              page_id: 'page-1',
              created_at: createdAtIso,
              updated_at: resolvedAtIso,
              monitoring_at: createdAtIso,
              resolved_at: resolvedAtIso,
              shortlink: 'https://stspg.io/abc',
              components: [{ id: 'c1', name: 'API', status: 'operational' }],
              incident_updates: [
                {
                  id: 'u1',
                  incident_id: 'inc1',
                  status: 'investigating',
                  body: 'Looking into it',
                  display_at: createdAtIso,
                  created_at: createdAtIso,
                },
                {
                  id: 'u2',
                  incident_id: 'inc1',
                  status: 'resolved',
                  body: 'All good.',
                  display_at: resolvedAtIso,
                  created_at: resolvedAtIso,
                },
              ],
            },
          ],
        };
      }
      return routeDefault(u);
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
      .filter((e) => e.type === 'statuspage_incident');
    expect(incidents).toHaveLength(1);
    expect(incidents[0]!.id).toBe('inc1');
    expect(incidents[0]!.attributes.impact).toBe('major');
    expect(incidents[0]!.attributes.componentIds).toEqual(['c1']);
    expect(incidents[0]!.attributes.resolvedAt).toBe(Date.parse(resolvedAtIso));

    const updates = storage.event.mock.calls
      .map((c) => c[0] as { name: string; attributes: Record<string, unknown> })
      .filter((e) => e.name === 'statuspage_incident_update');
    expect(updates).toHaveLength(2);
    expect(updates[0]!.attributes.updateId).toBe('u1');
    expect(updates[1]!.attributes.status).toBe('resolved');
  });

  it('skips incident_updates entirely when not enabled', async () => {
    const connector = makeConnector({ resources: ['incidents'] });
    installRouter((u) => {
      if (u.includes('/incidents')) {
        return {
          body: [
            {
              id: 'inc1',
              name: 'Outage',
              status: 'resolved',
              impact: 'minor',
              created_at: '2024-05-01T00:00:00Z',
              updated_at: '2024-05-01T01:00:00Z',
              incident_updates: [
                {
                  id: 'u1',
                  incident_id: 'inc1',
                  status: 'resolved',
                  body: 'fixed',
                  display_at: '2024-05-01T00:00:00Z',
                  created_at: '2024-05-01T00:00:00Z',
                },
              ],
            },
          ],
        };
      }
      return routeDefault(u);
    });
    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const updates = storage.event.mock.calls
      .map((c) => c[0] as { name: string })
      .filter((e) => e.name === 'statuspage_incident_update');
    expect(updates).toHaveLength(0);
  });

  it('passes Authorization header with OAuth prefix on every request', async () => {
    const connector = new StatuspageConnector(
      { pageId: 'page-1' },
      { apiKey: 'sk-secret' as unknown as { $secret: string } },
    );
    const { spy } = installRouter(routeDefault);
    await connector.sync({ mode: 'full' }, makeStorage());

    expect(spy.mock.calls.length).toBeGreaterThan(0);
    for (const call of spy.mock.calls) {
      const headers = call[1].headers as Record<string, string>;
      expect(headers.authorization).toBe('OAuth sk-secret');
    }
  });

  it('only fetches phases enabled in settings.resources', async () => {
    const connector = makeConnector({ resources: ['incidents'] });
    const { calls } = installRouter(routeDefault);
    await connector.sync({ mode: 'full' }, makeStorage());

    const paths = calls.map((c) => new URL(c).pathname);
    expect(paths.some((p) => p.endsWith('/incidents'))).toBe(true);
    expect(paths.some((p) => p.endsWith('/components'))).toBe(false);
  });

  it('advances to page=2 only when the first page is full', async () => {
    const connector = makeConnector({ resources: ['components'] });
    let calls = 0;
    const fullPage = Array.from({ length: 100 }, (_, i) => ({
      id: `c${i}`,
      page_id: 'page-1',
      name: `Component ${i}`,
      status: 'operational',
    }));
    const { calls: urls } = installRouter((u) => {
      if (u.includes('/components')) {
        calls++;
        if (calls === 1) {
          return { body: fullPage };
        }
        return { body: [] };
      }
      return routeDefault(u);
    });
    await connector.sync({ mode: 'full' }, makeStorage());

    expect(calls).toBe(2);
    expect(urls.some((u) => u.includes('page=2'))).toBe(true);
  });

  it('stops pagination on a short page (no next request)', async () => {
    const connector = makeConnector({ resources: ['components'] });
    let calls = 0;
    installRouter((u) => {
      if (u.includes('/components')) {
        calls++;
        return {
          body: [
            { id: 'c1', page_id: 'page-1', name: 'API', status: 'operational' },
          ],
        };
      }
      return routeDefault(u);
    });
    await connector.sync({ mode: 'full' }, makeStorage());
    expect(calls).toBe(1);
  });

  it('short-circuits incident pagination once a full page is older than since', async () => {
    const connector = makeConnector({ resources: ['incidents'] });
    const since = '2024-05-15T00:00:00.000Z';
    const sinceMs = new Date(since).getTime();
    let calls = 0;
    const oldPage = Array.from({ length: 100 }, (_, i) => ({
      id: `old${i}`,
      name: `old incident ${i}`,
      status: 'resolved',
      impact: 'minor',
      created_at: new Date(sinceMs - 10_000 - i * 1000).toISOString(),
      updated_at: new Date(sinceMs - 10_000 - i * 1000).toISOString(),
    }));
    installRouter((u) => {
      if (u.includes('/incidents')) {
        calls++;
        return { body: oldPage };
      }
      return routeDefault(u);
    });
    await connector.sync({ mode: 'latest', since }, makeStorage());
    expect(calls).toBe(1);
  });

  it('rejects malicious pagination URLs from a saved cursor', async () => {
    const connector = makeConnector({ resources: ['components'] });
    const { calls } = installRouter(routeDefault);
    await connector.sync(
      {
        mode: 'full',
        cursor: { phase: 'components', page: 'https://evil.example.com/exfil' },
      },
      makeStorage(),
    );

    expect(calls.some((c) => c.includes('evil.example.com'))).toBe(false);
    expect(calls.some((c) => c.includes('api.statuspage.io'))).toBe(true);
  });

  it('resumes from a saved cursor at the right phase', async () => {
    const connector = makeConnector();
    const { calls } = installRouter(routeDefault);

    await connector.sync(
      { mode: 'full', cursor: { phase: 'incidents', page: null } },
      makeStorage(),
    );

    expect(calls.some((c) => c.includes('/components'))).toBe(false);
    expect(calls.some((c) => c.includes('/incidents'))).toBe(true);
  });

  it('skips incident_updates whose timestamps are unparseable', async () => {
    const connector = makeConnector({ resources: ['incident_updates'] });
    const recentIso = new Date(Date.now() - 60_000).toISOString();
    installRouter((u) => {
      if (u.includes('/incidents')) {
        return {
          body: [
            {
              id: 'inc1',
              name: 'Outage',
              status: 'resolved',
              impact: 'minor',
              created_at: recentIso,
              updated_at: recentIso,
              incident_updates: [
                {
                  id: 'good',
                  incident_id: 'inc1',
                  status: 'resolved',
                  body: 'ok',
                  display_at: recentIso,
                  created_at: recentIso,
                },
                {
                  id: 'bad',
                  incident_id: 'inc1',
                  status: 'resolved',
                  body: 'broken',
                  display_at: 'not-a-date',
                  created_at: 'also-not-a-date',
                },
              ],
            },
          ],
        };
      }
      return routeDefault(u);
    });
    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const ids = storage.event.mock.calls
      .map((c) => c[0] as { name: string; attributes: Record<string, unknown> })
      .filter((e) => e.name === 'statuspage_incident_update')
      .map((e) => e.attributes.updateId);
    expect(ids).toEqual(['good']);
  });
});

describe('StatuspageConnector.create', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('returns a connector instance bound to the parsed config', async () => {
    vi.stubEnv('SP_TEST_KEY', 'sk-fixture');
    const { spy } = installRouter(routeDefault);
    const connector = StatuspageConnector.create({
      apiKey: { $secret: 'SP_TEST_KEY' },
      pageId: 'page-test',
      resources: ['components'],
    });
    expect(connector).toBeInstanceOf(StatuspageConnector);
    expect(connector.id).toBe('statuspage');

    await connector.sync({ mode: 'full' }, makeStorage());
    expect(spy.mock.calls.length).toBeGreaterThan(0);
    for (const call of spy.mock.calls) {
      const headers = call[1].headers as Record<string, string>;
      expect(headers.authorization).toBe('OAuth sk-fixture');
    }
  });
});
