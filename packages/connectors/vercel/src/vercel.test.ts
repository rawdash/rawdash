import { afterEach, describe, expect, it, vi } from 'vitest';

import { VercelConnector, configFields } from './vercel';

describe('configFields', () => {
  it('parses a valid config with required fields only', () => {
    const result = configFields.safeParse({
      apiToken: { $secret: 'VERCEL_API_TOKEN' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a config missing apiToken', () => {
    const result = configFields.safeParse({ teamId: 'team_abc' });
    expect(result.success).toBe(false);
  });

  it('rejects an apiToken passed as a plain string', () => {
    const result = configFields.safeParse({ apiToken: 'vercel_plain' });
    expect(result.success).toBe(false);
  });

  it('accepts optional teamId, projects, resources, and lookback', () => {
    const result = configFields.safeParse({
      apiToken: { $secret: 'VERCEL_API_TOKEN' },
      teamId: 'team_abc',
      projects: ['prj_one', 'prj_two'],
      resources: ['projects', 'deployments'],
      deploymentsLookbackDays: 14,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.projects).toEqual(['prj_one', 'prj_two']);
      expect(result.data.resources).toEqual(['projects', 'deployments']);
    }
  });

  it('rejects empty projects array', () => {
    const result = configFields.safeParse({
      apiToken: { $secret: 'VERCEL_API_TOKEN' },
      projects: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects deploymentsLookbackDays above 365', () => {
    const result = configFields.safeParse({
      apiToken: { $secret: 'VERCEL_API_TOKEN' },
      deploymentsLookbackDays: 400,
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
    teamId: string;
    projects: readonly string[];
    resources: readonly ('projects' | 'deployments' | 'deployment_events')[];
    deploymentsLookbackDays: number;
  }> = {},
): VercelConnector {
  return new VercelConnector(
    { ...overrides },
    { apiToken: 'vercel_test' as unknown as { $secret: string } },
  );
}

function emptyProjectsResponse() {
  return { body: { projects: [], pagination: { count: 0, next: null } } };
}

function emptyDeploymentsResponse() {
  return { body: { deployments: [], pagination: { count: 0, next: null } } };
}

describe('VercelConnector.sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns done:true when every endpoint returns empty', async () => {
    installRouter((u) =>
      u.includes('/v9/projects')
        ? emptyProjectsResponse()
        : emptyDeploymentsResponse(),
    );
    const result = await makeConnector().sync({ mode: 'full' }, makeStorage());
    expect(result.done).toBe(true);
  });

  it('clears entity types and event names on full sync first page', async () => {
    installRouter((u) =>
      u.includes('/v9/projects')
        ? emptyProjectsResponse()
        : emptyDeploymentsResponse(),
    );
    const storage = makeStorage();
    await makeConnector().sync({ mode: 'full' }, storage);

    const clearedTypes = storage.entities.mock.calls
      .filter((c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0)
      .map((c) => (c[1] as { types: string[] }).types[0]);
    expect(clearedTypes).toEqual(
      expect.arrayContaining(['vercel_project', 'vercel_deployment']),
    );

    const clearedEvents = storage.events.mock.calls
      .filter((c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0)
      .map((c) => (c[1] as { names: string[] }).names[0]);
    expect(clearedEvents).toContain('vercel_deployment_event');
  });

  it('does not clear storage in latest (incremental) mode', async () => {
    installRouter((u) =>
      u.includes('/v9/projects')
        ? emptyProjectsResponse()
        : emptyDeploymentsResponse(),
    );
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

  it('writes project entities', async () => {
    const connector = makeConnector({ resources: ['projects'] });
    installRouter((u) => {
      if (u.includes('/v9/projects')) {
        return {
          body: {
            projects: [
              {
                id: 'prj_1',
                name: 'web',
                framework: 'nextjs',
                accountId: 'acct_1',
                createdAt: 1714521600000,
                updatedAt: 1714608000000,
              },
              {
                id: 'prj_2',
                name: 'api',
                framework: null,
                accountId: 'acct_1',
                createdAt: 1714521600000,
                updatedAt: 1714608000000,
              },
            ],
            pagination: { count: 2, next: null },
          },
        };
      }
      return emptyDeploymentsResponse();
    });
    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const projects = storage.entity.mock.calls
      .map((c) => c[0] as { type: string; id: string })
      .filter((e) => e.type === 'vercel_project')
      .map((e) => e.id);
    expect(projects).toEqual(['prj_1', 'prj_2']);
  });

  it('writes deployment entities and deployment_events with build duration', async () => {
    const connector = makeConnector({
      resources: ['deployments', 'deployment_events'],
    });
    installRouter((u) => {
      if (u.includes('/v9/projects')) {
        return emptyProjectsResponse();
      }
      return {
        body: {
          deployments: [
            {
              uid: 'dpl_1',
              name: 'web',
              url: 'web-foo.vercel.app',
              created: 1714521600000,
              state: 'READY',
              target: 'production',
              creator: { uid: 'u_1', username: 'alice' },
              buildingAt: 1714521610000,
              ready: 1714521700000,
              source: 'git',
              meta: {
                githubCommitRef: 'main',
                githubCommitSha: 'deadbeef',
              },
              projectId: 'prj_1',
            },
          ],
          pagination: { count: 1, next: null },
        },
      };
    });
    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const deployments = storage.entity.mock.calls
      .map(
        (c) =>
          c[0] as {
            type: string;
            id: string;
            attributes: Record<string, unknown>;
          },
      )
      .filter((e) => e.type === 'vercel_deployment');
    expect(deployments).toHaveLength(1);
    expect(deployments[0]!.id).toBe('dpl_1');
    expect(deployments[0]!.attributes.buildDurationMs).toBe(90000);
    expect(deployments[0]!.attributes.gitRef).toBe('main');
    expect(deployments[0]!.attributes.state).toBe('READY');

    const events = storage.event.mock.calls
      .map((c) => c[0] as { name: string; attributes: Record<string, unknown> })
      .filter((e) => e.name === 'vercel_deployment_event');
    expect(events).toHaveLength(1);
    expect(events[0]!.attributes.deploymentId).toBe('dpl_1');
    expect(events[0]!.attributes.state).toBe('READY');
  });

  it('writes events for in-flight deployments (buildingAt set, ready null)', async () => {
    const connector = makeConnector({
      resources: ['deployment_events'],
    });
    installRouter((u) => {
      if (u.includes('/v9/projects')) {
        return emptyProjectsResponse();
      }
      return {
        body: {
          deployments: [
            {
              uid: 'dpl_1',
              name: 'web',
              url: 'web-foo.vercel.app',
              created: 1714521600000,
              state: 'BUILDING',
              target: 'preview',
              creator: { uid: 'u_1' },
              buildingAt: 1714521610000,
              ready: null,
            },
          ],
          pagination: { count: 1, next: null },
        },
      };
    });
    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const events = storage.event.mock.calls
      .map((c) => c[0] as { name: string; attributes: Record<string, unknown> })
      .filter((e) => e.name === 'vercel_deployment_event');
    expect(events).toHaveLength(1);
    expect(events[0]!.attributes.buildDurationMs).toBeNull();
    expect(events[0]!.attributes.readyAt).toBeNull();
  });

  it('skips deployments with unparseable created timestamp', async () => {
    const connector = makeConnector({ resources: ['deployments'] });
    installRouter((u) => {
      if (u.includes('/v9/projects')) {
        return emptyProjectsResponse();
      }
      return {
        body: {
          deployments: [
            {
              uid: 'dpl_bad',
              name: 'web',
              url: 'web.vercel.app',
              created: Number.NaN,
              state: 'READY',
              target: null,
              creator: { uid: 'u_1' },
            },
            {
              uid: 'dpl_ok',
              name: 'web',
              url: 'web.vercel.app',
              created: 1714521600000,
              state: 'READY',
              target: 'production',
              creator: { uid: 'u_1' },
            },
          ],
          pagination: { count: 2, next: null },
        },
      };
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const storage = makeStorage();
      await connector.sync({ mode: 'full' }, storage);

      const written = storage.entity.mock.calls
        .map((c) => c[0] as { type: string; id: string })
        .filter((e) => e.type === 'vercel_deployment')
        .map((e) => e.id);
      expect(written).toEqual(['dpl_ok']);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('applies since query param in latest mode for deployments', async () => {
    const connector = makeConnector({ resources: ['deployments'] });
    const { calls } = installRouter((u) =>
      u.includes('/v9/projects')
        ? emptyProjectsResponse()
        : emptyDeploymentsResponse(),
    );
    const sinceIso = '2024-05-01T00:00:00.000Z';
    await connector.sync({ mode: 'latest', since: sinceIso }, makeStorage());

    const deploymentsCall = calls.find((c) => c.includes('/v6/deployments'));
    expect(deploymentsCall).toBeDefined();
    const params = new URL(deploymentsCall!).searchParams;
    expect(params.get('since')).toBe(String(new Date(sinceIso).getTime()));
  });

  it('passes Authorization header on every request', async () => {
    const connector = new VercelConnector(
      { resources: ['projects'] },
      { apiToken: 'vercel_secret' as unknown as { $secret: string } },
    );
    const { spy } = installRouter(() => emptyProjectsResponse());
    await connector.sync({ mode: 'full' }, makeStorage());

    expect(spy.mock.calls.length).toBeGreaterThan(0);
    for (const call of spy.mock.calls) {
      const headers = call[1].headers as Record<string, string>;
      expect(headers.authorization).toBe('Bearer vercel_secret');
    }
  });

  it('adds teamId query param when configured', async () => {
    const connector = makeConnector({
      teamId: 'team_abc',
      resources: ['projects'],
    });
    const { calls } = installRouter(() => emptyProjectsResponse());
    await connector.sync({ mode: 'full' }, makeStorage());

    const projectsCall = calls.find((c) => c.includes('/v9/projects'));
    expect(projectsCall).toBeDefined();
    expect(new URL(projectsCall!).searchParams.get('teamId')).toBe('team_abc');
  });

  it('adds projectId query params when projects are configured', async () => {
    const connector = makeConnector({
      resources: ['deployments'],
      projects: ['prj_one', 'prj_two'],
    });
    const { calls } = installRouter((u) =>
      u.includes('/v9/projects')
        ? emptyProjectsResponse()
        : emptyDeploymentsResponse(),
    );
    await connector.sync({ mode: 'full' }, makeStorage());

    const deploymentsCall = calls.find((c) => c.includes('/v6/deployments'));
    expect(deploymentsCall).toBeDefined();
    const params = new URL(deploymentsCall!).searchParams.getAll('projectId');
    expect(params).toEqual(['prj_one', 'prj_two']);
  });

  it('only fetches phases enabled in settings.resources', async () => {
    const connector = makeConnector({ resources: ['projects'] });
    const { calls } = installRouter(() => emptyProjectsResponse());
    await connector.sync({ mode: 'full' }, makeStorage());

    const paths = calls.map((c) => new URL(c).pathname);
    expect(paths.some((p) => p === '/v9/projects')).toBe(true);
    expect(paths.some((p) => p === '/v6/deployments')).toBe(false);
  });

  it('follows pagination.next as an `until` cursor', async () => {
    const connector = makeConnector({ resources: ['projects'] });
    let firstCall = true;
    const { calls } = installRouter((u) => {
      if (u.includes('/v9/projects')) {
        if (firstCall) {
          firstCall = false;
          return {
            body: {
              projects: [
                {
                  id: 'prj_1',
                  name: 'web',
                  framework: 'nextjs',
                  createdAt: 1714521600000,
                  updatedAt: 1714608000000,
                },
              ],
              pagination: { count: 1, next: 1714000000000 },
            },
          };
        }
        return {
          body: { projects: [], pagination: { count: 0, next: null } },
        };
      }
      return emptyDeploymentsResponse();
    });
    const result = await connector.sync({ mode: 'full' }, makeStorage());
    expect(result.done).toBe(true);
    const projectsCalls = calls.filter((c) => c.includes('/v9/projects'));
    expect(projectsCalls).toHaveLength(2);
    expect(new URL(projectsCalls[1]!).searchParams.get('until')).toBe(
      '1714000000000',
    );
  });

  it('rejects malicious pagination URLs from a saved cursor', async () => {
    const connector = makeConnector({ resources: ['projects'] });
    const { calls } = installRouter(() => emptyProjectsResponse());

    await connector.sync(
      {
        mode: 'full',
        cursor: { phase: 'projects', page: 'https://evil.example.com/exfil' },
      },
      makeStorage(),
    );

    expect(calls.some((c) => c.includes('evil.example.com'))).toBe(false);
    expect(calls.some((c) => c.includes('api.vercel.com'))).toBe(true);
  });

  it('resumes from a saved cursor at the right phase', async () => {
    const connector = makeConnector();
    const { calls } = installRouter((u) =>
      u.includes('/v9/projects')
        ? emptyProjectsResponse()
        : emptyDeploymentsResponse(),
    );

    await connector.sync(
      { mode: 'full', cursor: { phase: 'deployments', page: null } },
      makeStorage(),
    );

    expect(calls.some((c) => c.includes('/v9/projects'))).toBe(false);
    expect(calls.some((c) => c.includes('/v6/deployments'))).toBe(true);
  });
});

describe('VercelConnector.create', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns a connector instance bound to the parsed config', () => {
    vi.stubEnv('VERCEL_TEST_TOKEN', 'vercel_fixture');
    const connector = VercelConnector.create({
      apiToken: { $secret: 'VERCEL_TEST_TOKEN' },
    });
    expect(connector).toBeInstanceOf(VercelConnector);
    expect(connector.id).toBe('vercel');
  });
});

describe('VercelConnector filter pushdown', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function deploymentsUrl(calls: string[]): URL {
    const url = calls.find((u) => u.includes('/v6/deployments'));
    expect(url).toBeDefined();
    return new URL(url!);
  }

  async function syncWith(
    fetchSpecs: Record<string, { filter: unknown[] }[]>,
  ): Promise<string[]> {
    const { calls } = installRouter(() => emptyDeploymentsResponse());
    await makeConnector({ resources: ['deployments'] }).sync(
      { mode: 'full', fetchSpecs: fetchSpecs as never },
      makeStorage(),
    );
    return calls;
  }

  it('pushes a declared state filter to the deployments query', async () => {
    const calls = await syncWith({
      vercel_deployment: [
        { filter: [{ field: 'state', op: 'eq', value: 'READY' }] },
      ],
    });
    expect(deploymentsUrl(calls).searchParams.get('state')).toBe('READY');
  });

  it('pushes a declared target filter to the deployments query', async () => {
    const calls = await syncWith({
      vercel_deployment: [
        { filter: [{ field: 'target', op: 'eq', value: 'production' }] },
      ],
    });
    expect(deploymentsUrl(calls).searchParams.get('target')).toBe('production');
  });

  it('does not push when multiple specs target the resource', async () => {
    const calls = await syncWith({
      vercel_deployment: [
        { filter: [{ field: 'state', op: 'eq', value: 'READY' }] },
        { filter: [{ field: 'state', op: 'eq', value: 'ERROR' }] },
      ],
    });
    expect(deploymentsUrl(calls).searchParams.get('state')).toBeNull();
  });
});
