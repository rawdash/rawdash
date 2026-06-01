import { afterEach, describe, expect, it, vi } from 'vitest';

import { LaunchDarklyConnector, configFields } from './launchdarkly';

// ---------------------------------------------------------------------------
// configFields
// ---------------------------------------------------------------------------

describe('configFields', () => {
  it('parses a valid config with required fields only', () => {
    const result = configFields.safeParse({
      apiToken: { $secret: 'LD_API_TOKEN' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a config missing apiToken', () => {
    const result = configFields.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects an apiToken passed as a plain string', () => {
    const result = configFields.safeParse({ apiToken: 'api-plain' });
    expect(result.success).toBe(false);
  });

  it('accepts optional projects and resources', () => {
    const result = configFields.safeParse({
      apiToken: { $secret: 'LD_API_TOKEN' },
      projects: ['my-proj'],
      resources: ['feature_flags', 'flag_events'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.projects).toEqual(['my-proj']);
      expect(result.data.resources).toEqual(['feature_flags', 'flag_events']);
    }
  });

  it('rejects empty projects array', () => {
    const result = configFields.safeParse({
      apiToken: { $secret: 'LD_API_TOKEN' },
      projects: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects auditLogLookbackDays above 90', () => {
    const result = configFields.safeParse({
      apiToken: { $secret: 'LD_API_TOKEN' },
      auditLogLookbackDays: 120,
    });
    expect(result.success).toBe(false);
  });

  it('accepts auditLogLookbackDays at the boundary of 90', () => {
    const result = configFields.safeParse({
      apiToken: { $secret: 'LD_API_TOKEN' },
      auditLogLookbackDays: 90,
    });
    expect(result.success).toBe(true);
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
    projects: readonly string[];
    resources: readonly ('projects' | 'feature_flags' | 'flag_events')[];
    auditLogLookbackDays: number;
  }> = {},
): LaunchDarklyConnector {
  return new LaunchDarklyConnector(
    { ...overrides },
    { apiToken: 'api-test' as unknown as { $secret: string } },
  );
}

function emptyProjectsBody() {
  return { body: { items: [], totalCount: 0 } };
}

function emptyFlagsBody() {
  return { body: { items: [], totalCount: 0 } };
}

function emptyAuditBody() {
  return { body: { items: [], totalCount: 0 } };
}

function routeDefault(url: string): MockResponseSpec {
  if (url.includes('/api/v2/projects')) {
    return emptyProjectsBody();
  }
  if (url.includes('/api/v2/flags/')) {
    return emptyFlagsBody();
  }
  if (url.includes('/api/v2/auditlog')) {
    return emptyAuditBody();
  }
  return { body: {} };
}

// ---------------------------------------------------------------------------
// LaunchDarklyConnector — sync
// ---------------------------------------------------------------------------

describe('LaunchDarklyConnector.sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns done:true when every endpoint returns empty', async () => {
    installRouter(routeDefault);
    const result = await makeConnector({ projects: ['p1'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );
    expect(result.done).toBe(true);
  });

  it('clears entity types and event names on full sync first page', async () => {
    installRouter(routeDefault);
    const storage = makeStorage();
    await makeConnector({ projects: ['p1'] }).sync({ mode: 'full' }, storage);

    const clearedTypes = storage.entities.mock.calls
      .filter((c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0)
      .map((c) => (c[1] as { types: string[] }).types[0]);
    expect(clearedTypes).toEqual(
      expect.arrayContaining([
        'launchdarkly_project',
        'launchdarkly_feature_flag',
      ]),
    );

    const clearedEvents = storage.events.mock.calls
      .filter((c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0)
      .map((c) => (c[1] as { names: string[] }).names[0]);
    expect(clearedEvents).toContain('launchdarkly_flag_event');
  });

  it('does not clear storage in latest (incremental) mode', async () => {
    installRouter(routeDefault);
    const storage = makeStorage();
    await makeConnector({ projects: ['p1'] }).sync(
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

  it('writes project entities', async () => {
    const connector = makeConnector({ resources: ['projects'] });
    installRouter((u) => {
      if (u.includes('/api/v2/projects')) {
        return {
          body: {
            items: [
              { _id: 'p1id', key: 'proj-1', name: 'Project One', tags: ['a'] },
              { _id: 'p2id', key: 'proj-2', name: 'Project Two' },
            ],
          },
        };
      }
      return routeDefault(u);
    });
    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const projects = storage.entity.mock.calls
      .map(
        (c) =>
          c[0] as {
            type: string;
            id: string;
            attributes: Record<string, unknown>;
          },
      )
      .filter((e) => e.type === 'launchdarkly_project');
    expect(projects).toHaveLength(2);
    expect(projects.map((p) => p.id)).toEqual(['proj-1', 'proj-2']);
    expect(projects[0]!.attributes.tags).toEqual(['a']);
  });

  it('writes flag entities scoped to the configured projects', async () => {
    const connector = makeConnector({
      resources: ['feature_flags'],
      projects: ['proj-1'],
    });
    const flag = {
      _id: 'fid-1',
      key: 'show-banner',
      name: 'Show Banner',
      description: 'Toggle the banner.',
      kind: 'boolean',
      archived: false,
      tags: ['ui'],
      creationDate: 1714000000000,
      variations: [
        { _id: 'v1', name: 'on', value: true },
        { _id: 'v2', name: 'off', value: false },
      ],
      environments: {
        production: { on: true, archived: false, lastModified: 1715000000000 },
        staging: { on: false, archived: false, lastModified: 1714500000000 },
      },
    };
    installRouter((u) => {
      if (u.includes('/api/v2/flags/proj-1')) {
        return { body: { items: [flag] } };
      }
      return routeDefault(u);
    });
    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const flags = storage.entity.mock.calls
      .map(
        (c) =>
          c[0] as {
            type: string;
            id: string;
            attributes: Record<string, unknown>;
          },
      )
      .filter((e) => e.type === 'launchdarkly_feature_flag');
    expect(flags).toHaveLength(1);
    expect(flags[0]!.id).toBe('proj-1:show-banner');
    expect(flags[0]!.attributes.projectKey).toBe('proj-1');
    expect(flags[0]!.attributes.kind).toBe('boolean');
    expect(flags[0]!.attributes.variationCount).toBe(2);
    expect(flags[0]!.attributes.tags).toEqual(['ui']);
  });

  it('writes audit-log events from the flag_events resource', async () => {
    const connector = makeConnector({ resources: ['flag_events'] });
    installRouter((u) => {
      if (u.includes('/api/v2/auditlog')) {
        return {
          body: {
            items: [
              {
                _id: 'a1',
                kind: 'flag',
                date: Date.now() - 1_000,
                titleVerb: 'updated',
                title: 'Updated flag show-banner',
                member: {
                  email: 'alice@example.com',
                  firstName: 'Alice',
                  lastName: 'A',
                },
                target: {
                  name: 'show-banner',
                  resources: ['proj/p1:env/production:flag/show-banner'],
                },
                comment: null,
              },
            ],
          },
        };
      }
      return routeDefault(u);
    });
    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const events = storage.event.mock.calls
      .map((c) => c[0] as { name: string; attributes: Record<string, unknown> })
      .filter((e) => e.name === 'launchdarkly_flag_event');
    expect(events).toHaveLength(1);
    expect(events[0]!.attributes.auditId).toBe('a1');
    expect(events[0]!.attributes.memberEmail).toBe('alice@example.com');
    expect(events[0]!.attributes.memberName).toBe('Alice A');
    expect(events[0]!.attributes.targetResources).toEqual([
      'proj/p1:env/production:flag/show-banner',
    ]);
  });

  it('skips audit entries with non-finite date instead of writing NaN', async () => {
    const connector = makeConnector({ resources: ['flag_events'] });
    installRouter((u) => {
      if (u.includes('/api/v2/auditlog')) {
        return {
          body: {
            items: [
              { _id: 'good', date: Date.now() - 1_000 },
              { _id: 'bad', date: Number.NaN as unknown as number },
            ],
          },
        };
      }
      return routeDefault(u);
    });
    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const ids = storage.event.mock.calls
      .map((c) => c[0] as { name: string; attributes: Record<string, unknown> })
      .filter((e) => e.name === 'launchdarkly_flag_event')
      .map((e) => e.attributes.auditId);
    expect(ids).toEqual(['good']);
  });

  it('applies after= filter from options.since on audit log', async () => {
    const connector = makeConnector({ resources: ['flag_events'] });
    const { calls } = installRouter(routeDefault);
    const since = '2024-05-01T00:00:00.000Z';
    await connector.sync({ mode: 'latest', since }, makeStorage());

    const auditCall = calls.find((c) => c.includes('/api/v2/auditlog'));
    expect(auditCall).toBeDefined();
    const expectedMs = new Date(since).getTime();
    expect(auditCall!).toContain(`after=${expectedMs}`);
  });

  it('passes Authorization header without Bearer prefix on every request', async () => {
    const connector = new LaunchDarklyConnector(
      { resources: ['projects'] },
      { apiToken: 'api-secret' as unknown as { $secret: string } },
    );
    const { spy } = installRouter(routeDefault);
    await connector.sync({ mode: 'full' }, makeStorage());

    expect(spy.mock.calls.length).toBeGreaterThan(0);
    for (const call of spy.mock.calls) {
      const headers = call[1].headers as Record<string, string>;
      expect(headers.authorization).toBe('api-secret');
    }
  });

  it('only fetches phases enabled in settings.resources', async () => {
    const connector = makeConnector({
      resources: ['flag_events'],
      projects: ['p1'],
    });
    const { calls } = installRouter(routeDefault);
    await connector.sync({ mode: 'full' }, makeStorage());

    const paths = calls.map((c) => new URL(c).pathname);
    expect(paths.some((p) => p.startsWith('/api/v2/auditlog'))).toBe(true);
    expect(paths.some((p) => p.startsWith('/api/v2/projects'))).toBe(false);
    expect(paths.some((p) => p.startsWith('/api/v2/flags/'))).toBe(false);
  });

  it('follows _links.next.href for project pagination', async () => {
    const connector = makeConnector({ resources: ['projects'] });
    let firstCall = true;
    installRouter((u) => {
      if (u.includes('/api/v2/projects')) {
        if (firstCall) {
          firstCall = false;
          return {
            body: {
              items: [{ _id: 'a', key: 'p1', name: 'P1' }],
              _links: {
                next: { href: '/api/v2/projects?limit=100&offset=100' },
              },
            },
          };
        }
        return { body: { items: [{ _id: 'b', key: 'p2', name: 'P2' }] } };
      }
      return routeDefault(u);
    });
    const storage = makeStorage();
    const result = await connector.sync({ mode: 'full' }, storage);
    expect(result.done).toBe(true);
    expect(firstCall).toBe(false);
    const ids = storage.entity.mock.calls
      .map((c) => c[0] as { type: string; id: string })
      .filter((e) => e.type === 'launchdarkly_project')
      .map((e) => e.id);
    expect(ids).toEqual(['p1', 'p2']);
  });

  it('iterates each configured project for feature_flags', async () => {
    const connector = makeConnector({
      resources: ['feature_flags'],
      projects: ['p1', 'p2'],
    });
    const { calls } = installRouter((u) => {
      if (u.includes('/api/v2/flags/p1')) {
        return {
          body: { items: [{ key: 'f1', name: 'F1', kind: 'boolean' }] },
        };
      }
      if (u.includes('/api/v2/flags/p2')) {
        return {
          body: { items: [{ key: 'f2', name: 'F2', kind: 'boolean' }] },
        };
      }
      return routeDefault(u);
    });
    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    expect(calls.some((c) => c.includes('/api/v2/flags/p1'))).toBe(true);
    expect(calls.some((c) => c.includes('/api/v2/flags/p2'))).toBe(true);
    const ids = storage.entity.mock.calls
      .map((c) => c[0] as { type: string; id: string })
      .filter((e) => e.type === 'launchdarkly_feature_flag')
      .map((e) => e.id);
    expect(ids).toEqual(['p1:f1', 'p2:f2']);
  });

  it('discovers projects when none are configured for feature_flags', async () => {
    const connector = makeConnector({
      resources: ['projects', 'feature_flags'],
    });
    const { calls } = installRouter((u) => {
      if (u.includes('/api/v2/projects')) {
        return {
          body: {
            items: [
              { _id: 'a', key: 'auto-1', name: 'Auto 1' },
              { _id: 'b', key: 'auto-2', name: 'Auto 2' },
            ],
          },
        };
      }
      if (u.includes('/api/v2/flags/auto-1')) {
        return {
          body: { items: [{ key: 'fA', name: 'fA', kind: 'boolean' }] },
        };
      }
      if (u.includes('/api/v2/flags/auto-2')) {
        return {
          body: { items: [{ key: 'fB', name: 'fB', kind: 'boolean' }] },
        };
      }
      return routeDefault(u);
    });
    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    expect(calls.some((c) => c.includes('/api/v2/flags/auto-1'))).toBe(true);
    expect(calls.some((c) => c.includes('/api/v2/flags/auto-2'))).toBe(true);
    const flagIds = storage.entity.mock.calls
      .map((c) => c[0] as { type: string; id: string })
      .filter((e) => e.type === 'launchdarkly_feature_flag')
      .map((e) => e.id);
    expect(flagIds.sort()).toEqual(['auto-1:fA', 'auto-2:fB']);
  });

  it('short-circuits audit-log pagination once a page is older than since', async () => {
    const connector = makeConnector({ resources: ['flag_events'] });
    const since = '2024-05-15T00:00:00.000Z';
    const sinceMs = new Date(since).getTime();
    let auditCalls = 0;
    installRouter((u) => {
      if (u.includes('/api/v2/auditlog')) {
        auditCalls++;
        // Returning a page that ends entirely older than `sinceMs` must stop
        // pagination even though a _links.next.href is present.
        return {
          body: {
            items: [{ _id: 'old', date: sinceMs - 10_000 }],
            _links: {
              next: { href: '/api/v2/auditlog?before=foo' },
            },
          },
        };
      }
      return routeDefault(u);
    });
    await connector.sync({ mode: 'latest', since }, makeStorage());
    expect(auditCalls).toBe(1);
  });

  it('rejects malicious pagination URLs from a saved cursor', async () => {
    const connector = makeConnector({ resources: ['projects'] });
    const { calls } = installRouter(routeDefault);
    await connector.sync(
      {
        mode: 'full',
        cursor: { phase: 'projects', page: 'https://evil.example.com/exfil' },
      },
      makeStorage(),
    );

    expect(calls.some((c) => c.includes('evil.example.com'))).toBe(false);
    expect(calls.some((c) => c.includes('app.launchdarkly.com'))).toBe(true);
  });

  it('resumes from a saved cursor at the right phase', async () => {
    const connector = makeConnector({ projects: ['p1'] });
    const { calls } = installRouter(routeDefault);

    await connector.sync(
      { mode: 'full', cursor: { phase: 'audit_log', page: null } },
      makeStorage(),
    );

    expect(calls.some((c) => c.includes('/api/v2/projects'))).toBe(false);
    expect(calls.some((c) => c.includes('/api/v2/flags/'))).toBe(false);
    expect(calls.some((c) => c.includes('/api/v2/auditlog'))).toBe(true);
  });
});

describe('LaunchDarklyConnector.create', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns a connector instance bound to the parsed config', () => {
    vi.stubEnv('LD_TEST_TOKEN', 'api-fixture');
    const connector = LaunchDarklyConnector.create({
      apiToken: { $secret: 'LD_TEST_TOKEN' },
    });
    expect(connector).toBeInstanceOf(LaunchDarklyConnector);
    expect(connector.id).toBe('launchdarkly');
  });
});
