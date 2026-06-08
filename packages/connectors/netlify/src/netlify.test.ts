import { afterEach, describe, expect, it, vi } from 'vitest';

import { NetlifyConnector, configFields } from './netlify';

// ---------------------------------------------------------------------------
// configFields
// ---------------------------------------------------------------------------

describe('configFields', () => {
  it('parses a valid config with required fields only', () => {
    const result = configFields.safeParse({
      apiToken: { $secret: 'NETLIFY_API_TOKEN' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a config missing apiToken', () => {
    const result = configFields.safeParse({ siteIds: ['site_a'] });
    expect(result.success).toBe(false);
  });

  it('rejects an apiToken passed as a plain string', () => {
    const result = configFields.safeParse({ apiToken: 'nfp_plain' });
    expect(result.success).toBe(false);
  });

  it('accepts optional siteIds, resources, and lookback', () => {
    const result = configFields.safeParse({
      apiToken: { $secret: 'NETLIFY_API_TOKEN' },
      siteIds: ['site_a', 'site_b'],
      resources: ['sites', 'deploys'],
      deploysLookbackDays: 14,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.siteIds).toEqual(['site_a', 'site_b']);
      expect(result.data.resources).toEqual(['sites', 'deploys']);
    }
  });

  it('rejects empty siteIds array', () => {
    const result = configFields.safeParse({
      apiToken: { $secret: 'NETLIFY_API_TOKEN' },
      siteIds: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects deploysLookbackDays above 365', () => {
    const result = configFields.safeParse({
      apiToken: { $secret: 'NETLIFY_API_TOKEN' },
      deploysLookbackDays: 400,
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
    siteIds: readonly string[];
    resources: readonly ('sites' | 'deploys' | 'deploy_events')[];
    deploysLookbackDays: number;
  }> = {},
): NetlifyConnector {
  return new NetlifyConnector(
    { ...overrides },
    { apiToken: 'nfp_test' as unknown as { $secret: string } },
  );
}

function siteFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'site_1',
    name: 'web',
    url: 'https://web.netlify.app',
    admin_url: 'https://app.netlify.com/sites/web',
    account_id: 'acct_1',
    account_name: 'rawdash',
    build_settings: {
      repo_url: 'https://github.com/rawdash/web',
      repo_branch: 'main',
    },
    created_at: '2024-05-01T00:00:00.000Z',
    updated_at: '2024-05-02T00:00:00.000Z',
    published_deploy: { id: 'dpl_1', state: 'ready' },
    ...overrides,
  };
}

function deployFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'dpl_1',
    site_id: 'site_1',
    name: 'web',
    url: 'https://web.netlify.app',
    deploy_url: 'https://dpl-1--web.netlify.app',
    state: 'ready',
    branch: 'main',
    context: 'production',
    commit_ref: 'deadbeef',
    commit_url: 'https://github.com/rawdash/web/commit/deadbeef',
    title: 'feat: ship it',
    committer: 'alice',
    created_at: '2024-05-01T00:00:00.000Z',
    updated_at: '2024-05-01T00:01:00.000Z',
    published_at: '2024-05-01T00:02:00.000Z',
    deploy_time: 90,
    error_message: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// NetlifyConnector.sync
// ---------------------------------------------------------------------------

describe('NetlifyConnector.sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns done:true when every endpoint returns empty', async () => {
    installRouter(() => ({ body: [] }));
    const result = await makeConnector({ siteIds: ['site_1'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );
    expect(result.done).toBe(true);
  });

  it('clears entity types and event names on full sync first page', async () => {
    installRouter(() => ({ body: [] }));
    const storage = makeStorage();
    await makeConnector({ siteIds: ['site_1'] }).sync(
      { mode: 'full' },
      storage,
    );

    const clearedTypes = storage.entities.mock.calls
      .filter((c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0)
      .map((c) => (c[1] as { types: string[] }).types[0]);
    expect(clearedTypes).toEqual(
      expect.arrayContaining(['netlify_site', 'netlify_deploy']),
    );

    const clearedEvents = storage.events.mock.calls
      .filter((c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0)
      .map((c) => (c[1] as { names: string[] }).names[0]);
    expect(clearedEvents).toContain('netlify_deploy_event');
  });

  it('does not clear storage in latest (incremental) mode', async () => {
    installRouter(() => ({ body: [] }));
    const storage = makeStorage();
    await makeConnector({ siteIds: ['site_1'] }).sync(
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

  it('writes site entities', async () => {
    const connector = makeConnector({ resources: ['sites'] });
    installRouter((u) => {
      if (u.includes('/api/v1/sites') && !u.includes('/deploys')) {
        return {
          body: [
            siteFixture({ id: 'site_a', name: 'a' }),
            siteFixture({ id: 'site_b', name: 'b' }),
          ],
        };
      }
      return { body: [] };
    });
    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const sites = storage.entity.mock.calls
      .map((c) => c[0] as { type: string; id: string })
      .filter((e) => e.type === 'netlify_site')
      .map((e) => e.id);
    expect(sites).toEqual(['site_a', 'site_b']);
  });

  it('writes deploy entities and deploy_events with deploy duration', async () => {
    const connector = makeConnector({
      siteIds: ['site_1'],
      resources: ['deploys', 'deploy_events'],
    });
    installRouter((u) => {
      if (u.includes('/deploys')) {
        return { body: [deployFixture()] };
      }
      return { body: [] };
    });
    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const deploys = storage.entity.mock.calls
      .map(
        (c) =>
          c[0] as {
            type: string;
            id: string;
            attributes: Record<string, unknown>;
          },
      )
      .filter((e) => e.type === 'netlify_deploy');
    expect(deploys).toHaveLength(1);
    expect(deploys[0]!.id).toBe('dpl_1');
    expect(deploys[0]!.attributes.deployTimeMs).toBe(90000);
    expect(deploys[0]!.attributes.gitRef).toBe('deadbeef');
    expect(deploys[0]!.attributes.state).toBe('ready');
    expect(deploys[0]!.attributes.siteId).toBe('site_1');

    const events = storage.event.mock.calls
      .map((c) => c[0] as { name: string; attributes: Record<string, unknown> })
      .filter((e) => e.name === 'netlify_deploy_event');
    expect(events).toHaveLength(1);
    expect(events[0]!.attributes.deployId).toBe('dpl_1');
    expect(events[0]!.attributes.state).toBe('ready');
  });

  it('writes events for in-flight deploys (published_at null)', async () => {
    const connector = makeConnector({
      siteIds: ['site_1'],
      resources: ['deploy_events'],
    });
    installRouter((u) => {
      if (u.includes('/deploys')) {
        return {
          body: [
            deployFixture({
              id: 'dpl_2',
              state: 'building',
              published_at: null,
              deploy_time: null,
            }),
          ],
        };
      }
      return { body: [] };
    });
    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const events = storage.event.mock.calls
      .map((c) => c[0] as { name: string; attributes: Record<string, unknown> })
      .filter((e) => e.name === 'netlify_deploy_event');
    expect(events).toHaveLength(1);
    expect(events[0]!.attributes.publishedAt).toBeNull();
    expect(events[0]!.attributes.deployTimeMs).toBeNull();
  });

  it('falls back to branch when commit_ref is null', async () => {
    const connector = makeConnector({
      siteIds: ['site_1'],
      resources: ['deploys'],
    });
    installRouter((u) =>
      u.includes('/deploys')
        ? { body: [deployFixture({ commit_ref: null, branch: 'feature-x' })] }
        : { body: [] },
    );
    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const deploys = storage.entity.mock.calls
      .map((c) => c[0] as { type: string; attributes: Record<string, unknown> })
      .filter((e) => e.type === 'netlify_deploy');
    expect(deploys[0]!.attributes.gitRef).toBe('feature-x');
  });

  it('passes Authorization header on every request', async () => {
    const connector = new NetlifyConnector(
      { siteIds: ['site_1'], resources: ['deploys'] },
      { apiToken: 'nfp_secret' as unknown as { $secret: string } },
    );
    const { spy } = installRouter(() => ({ body: [] }));
    await connector.sync({ mode: 'full' }, makeStorage());

    expect(spy.mock.calls.length).toBeGreaterThan(0);
    for (const call of spy.mock.calls) {
      const headers = call[1].headers as Record<string, string>;
      expect(headers.authorization).toBe('Bearer nfp_secret');
    }
  });

  it('only fetches phases enabled in settings.resources', async () => {
    const connector = makeConnector({ resources: ['sites'] });
    const { calls } = installRouter(() => ({ body: [] }));
    await connector.sync({ mode: 'full' }, makeStorage());

    const paths = calls.map((c) => new URL(c).pathname);
    expect(paths.some((p) => p === '/api/v1/sites')).toBe(true);
    expect(
      paths.some(
        (p) => p.startsWith('/api/v1/sites/') && p.endsWith('/deploys'),
      ),
    ).toBe(false);
  });

  it('iterates configured siteIds for the deploys phase', async () => {
    const connector = makeConnector({
      siteIds: ['site_a', 'site_b'],
      resources: ['deploys'],
    });
    const { calls } = installRouter(() => ({ body: [] }));
    await connector.sync({ mode: 'full' }, makeStorage());

    const deploysPaths = calls
      .map((c) => new URL(c).pathname)
      .filter((p) => p.endsWith('/deploys'));
    expect(deploysPaths).toEqual([
      '/api/v1/sites/site_a/deploys',
      '/api/v1/sites/site_b/deploys',
    ]);
  });

  it('follows the Link header for sites pagination', async () => {
    const connector = makeConnector({ resources: ['sites'] });
    const nextUrl = 'https://api.netlify.com/api/v1/sites?page=2';
    let firstCall = true;
    const { calls } = installRouter((u) => {
      if (u.includes('/sites') && !u.includes('/deploys')) {
        if (firstCall) {
          firstCall = false;
          return {
            body: [siteFixture({ id: 'site_a' })],
            headers: { link: `<${nextUrl}>; rel="next"` },
          };
        }
        return { body: [siteFixture({ id: 'site_b' })] };
      }
      return { body: [] };
    });

    await connector.sync({ mode: 'full' }, makeStorage());

    const sitesCalls = calls.filter(
      (c) => c.includes('/sites') && !c.includes('/deploys'),
    );
    expect(sitesCalls).toHaveLength(2);
    expect(sitesCalls[1]).toBe(nextUrl);
  });

  it('discovers site IDs from the sites endpoint when siteIds is not set', async () => {
    const connector = makeConnector({ resources: ['deploys'] });
    const { calls } = installRouter((u) => {
      if (u.includes('/api/v1/sites') && !u.includes('/deploys')) {
        return {
          body: [siteFixture({ id: 'site_x' }), siteFixture({ id: 'site_y' })],
        };
      }
      return { body: [] };
    });

    await connector.sync({ mode: 'full' }, makeStorage());

    const deploysPaths = calls
      .map((c) => new URL(c).pathname)
      .filter((p) => p.endsWith('/deploys'));
    expect(deploysPaths).toEqual([
      '/api/v1/sites/site_x/deploys',
      '/api/v1/sites/site_y/deploys',
    ]);
  });

  it('re-discovers sites on a second sync run, picking up newly created sites', async () => {
    const connector = makeConnector({ resources: ['deploys'] });
    let siteListings = 0;
    const { calls } = installRouter((u) => {
      if (u.includes('/api/v1/sites') && !u.includes('/deploys')) {
        siteListings += 1;
        const sites = [siteFixture({ id: 'site_x' })];
        if (siteListings > 1) {
          sites.push(siteFixture({ id: 'site_y' }));
        }
        return { body: sites };
      }
      return { body: [] };
    });

    await connector.sync({ mode: 'full' }, makeStorage());
    const firstRunDeploys = calls
      .map((c) => new URL(c).pathname)
      .filter((p) => p.endsWith('/deploys'));
    expect(firstRunDeploys).toEqual(['/api/v1/sites/site_x/deploys']);

    calls.length = 0;
    await connector.sync({ mode: 'full' }, makeStorage());
    const secondRunDeploys = calls
      .map((c) => new URL(c).pathname)
      .filter((p) => p.endsWith('/deploys'));
    expect(secondRunDeploys).toEqual([
      '/api/v1/sites/site_x/deploys',
      '/api/v1/sites/site_y/deploys',
    ]);
  });

  it('deduplicates configured siteIds for the deploys phase', async () => {
    const connector = makeConnector({
      siteIds: ['site_a', 'site_a', 'site_b'],
      resources: ['deploys'],
    });
    const { calls } = installRouter(() => ({ body: [] }));

    await connector.sync({ mode: 'full' }, makeStorage());

    const deploysPaths = calls
      .map((c) => new URL(c).pathname)
      .filter((p) => p.endsWith('/deploys'));
    expect(deploysPaths).toEqual([
      '/api/v1/sites/site_a/deploys',
      '/api/v1/sites/site_b/deploys',
    ]);
  });

  it('rejects malicious pagination URLs from a saved cursor', async () => {
    const connector = makeConnector({ resources: ['sites'] });
    const { calls } = installRouter(() => ({ body: [] }));

    await connector.sync(
      {
        mode: 'full',
        cursor: { phase: 'sites', page: 'https://evil.example.com/exfil' },
      },
      makeStorage(),
    );

    expect(calls.some((c) => c.includes('evil.example.com'))).toBe(false);
    expect(calls.some((c) => c.includes('api.netlify.com'))).toBe(true);
  });

  it('stops paginating deploys once a full page is entirely past `since`', async () => {
    const connector = makeConnector({
      siteIds: ['site_1'],
      resources: ['deploys'],
    });
    const since = '2024-05-15T00:00:00.000Z';
    const page1 = [
      deployFixture({
        id: 'd1',
        created_at: '2024-05-20T00:00:00.000Z',
        published_at: '2024-05-20T00:01:00.000Z',
      }),
      deployFixture({
        id: 'd2',
        created_at: '2024-05-18T00:00:00.000Z',
        published_at: '2024-05-18T00:01:00.000Z',
      }),
    ];
    const page2 = [
      deployFixture({
        id: 'd3',
        created_at: '2024-05-10T00:00:00.000Z',
        published_at: '2024-05-10T00:01:00.000Z',
      }),
      deployFixture({
        id: 'd4',
        created_at: '2024-05-08T00:00:00.000Z',
        published_at: '2024-05-08T00:01:00.000Z',
      }),
    ];
    const page2Url =
      'https://api.netlify.com/api/v1/sites/site_1/deploys?page=2';
    const page3Url =
      'https://api.netlify.com/api/v1/sites/site_1/deploys?page=3';

    const { calls } = installRouter((u) => {
      if (u === page2Url) {
        return {
          body: page2,
          headers: { link: `<${page3Url}>; rel="next"` },
        };
      }
      if (u.includes('/deploys')) {
        return {
          body: page1,
          headers: { link: `<${page2Url}>; rel="next"` },
        };
      }
      return { body: [] };
    });

    await connector.sync(
      { mode: 'latest', since, resources: new Set(['deploy']) },
      makeStorage(),
    );

    const deploysCalls = calls.filter((c) => c.includes('/deploys'));
    expect(deploysCalls.some((u) => u === page3Url)).toBe(false);
    expect(deploysCalls).toHaveLength(2);
  });

  it('applies the deploysLookbackDays cutoff on full backfill', async () => {
    const connector = makeConnector({
      siteIds: ['site_1'],
      resources: ['deploys'],
      deploysLookbackDays: 1,
    });
    const old = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    installRouter((u) => {
      if (u.includes('/deploys')) {
        return {
          body: [
            deployFixture({
              id: 'recent',
              created_at: recent,
              published_at: recent,
            }),
            deployFixture({ id: 'old', created_at: old, published_at: old }),
          ],
        };
      }
      return { body: [] };
    });
    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const writtenIds = storage.entity.mock.calls
      .map((c) => c[0] as { type: string; id: string })
      .filter((e) => e.type === 'netlify_deploy')
      .map((e) => e.id);
    expect(writtenIds).toEqual(['recent']);
  });

  it('resumes from a saved cursor at the right phase', async () => {
    const connector = makeConnector({ siteIds: ['site_1'] });
    const { calls } = installRouter(() => ({ body: [] }));

    await connector.sync(
      { mode: 'full', cursor: { phase: 'deploys', page: null } },
      makeStorage(),
    );

    expect(
      calls.some((c) => c.includes('/api/v1/sites') && !c.includes('/deploys')),
    ).toBe(false);
    expect(calls.some((c) => c.includes('/deploys'))).toBe(true);
  });
});

describe('NetlifyConnector.create', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns a connector instance bound to the parsed config', () => {
    vi.stubEnv('NETLIFY_TEST_TOKEN', 'nfp_fixture');
    const connector = NetlifyConnector.create({
      apiToken: { $secret: 'NETLIFY_TEST_TOKEN' },
    });
    expect(connector).toBeInstanceOf(NetlifyConnector);
    expect(connector.id).toBe('netlify');
  });
});
