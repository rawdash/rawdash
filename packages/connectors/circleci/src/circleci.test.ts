import { afterEach, describe, expect, it, vi } from 'vitest';

import { CircleCIConnector, configFields } from './circleci';

// ---------------------------------------------------------------------------
// configFields
// ---------------------------------------------------------------------------

describe('configFields', () => {
  it('parses a valid config with required fields', () => {
    const result = configFields.safeParse({
      apiToken: { $secret: 'CIRCLECI_API_TOKEN' },
      projectSlugs: ['gh/my-org/my-repo'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a config missing apiToken', () => {
    const result = configFields.safeParse({
      projectSlugs: ['gh/my-org/my-repo'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an apiToken passed as a plain string', () => {
    const result = configFields.safeParse({
      apiToken: 'ccitoken',
      projectSlugs: ['gh/my-org/my-repo'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty projectSlugs array', () => {
    const result = configFields.safeParse({
      apiToken: { $secret: 'CIRCLECI_API_TOKEN' },
      projectSlugs: [],
    });
    expect(result.success).toBe(false);
  });

  it('accepts optional branch, resources, and lookback', () => {
    const result = configFields.safeParse({
      apiToken: { $secret: 'CIRCLECI_API_TOKEN' },
      projectSlugs: ['gh/my-org/repo-a', 'gh/my-org/repo-b'],
      branch: 'main',
      resources: ['pipelines', 'workflows', 'pipeline_events'],
      pipelinesLookbackDays: 14,
    });
    expect(result.success).toBe(true);
  });

  it('rejects duplicate projectSlugs', () => {
    const result = configFields.safeParse({
      apiToken: { $secret: 'CIRCLECI_API_TOKEN' },
      projectSlugs: ['gh/my-org/my-repo', 'gh/my-org/my-repo'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects pipelinesLookbackDays above 365', () => {
    const result = configFields.safeParse({
      apiToken: { $secret: 'CIRCLECI_API_TOKEN' },
      projectSlugs: ['gh/my-org/my-repo'],
      pipelinesLookbackDays: 400,
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

type SettingsOverrides = Partial<{
  projectSlugs: readonly string[];
  branch: string;
  resources: readonly (
    | 'pipelines'
    | 'workflows'
    | 'jobs'
    | 'pipeline_events'
  )[];
  pipelinesLookbackDays: number;
}>;

function makeConnector(overrides: SettingsOverrides = {}): CircleCIConnector {
  return new CircleCIConnector(
    {
      projectSlugs: ['gh/my-org/my-repo'],
      ...overrides,
    },
    { apiToken: 'ccitest' as unknown as { $secret: string } },
  );
}

function emptyPipelinesResponse(): MockResponseSpec {
  return { body: { items: [], next_page_token: null } };
}

function emptyWorkflowsResponse(): MockResponseSpec {
  return { body: { items: [], next_page_token: null } };
}

function emptyJobsResponse(): MockResponseSpec {
  return { body: { items: [], next_page_token: null } };
}

const nowIso = '2024-05-01T00:00:00.000Z';
const recentIso = new Date(Date.now() - 60_000).toISOString();

function pipelineFixture(
  id: string,
  overrides: Partial<{
    project_slug: string;
    state: string;
    created_at: string;
    updated_at: string;
    branch: string | null;
    revision: string | null;
  }> = {},
): {
  id: string;
  number: number;
  project_slug: string;
  state: string;
  created_at: string;
  updated_at: string;
  vcs: { branch: string | null; revision: string | null };
} {
  return {
    id,
    number: 1,
    project_slug: overrides.project_slug ?? 'gh/my-org/my-repo',
    state: overrides.state ?? 'created',
    created_at: overrides.created_at ?? recentIso,
    updated_at: overrides.updated_at ?? recentIso,
    vcs: {
      branch: overrides.branch ?? 'main',
      revision: overrides.revision ?? 'deadbeef',
    },
  };
}

function workflowFixture(
  id: string,
  pipelineId: string,
  overrides: Partial<{
    name: string;
    status: string;
    created_at: string;
    stopped_at: string | null;
  }> = {},
): {
  id: string;
  name: string;
  pipeline_id: string;
  project_slug: string;
  status: string;
  created_at: string;
  stopped_at: string | null;
} {
  return {
    id,
    name: overrides.name ?? 'build-and-test',
    pipeline_id: pipelineId,
    project_slug: 'gh/my-org/my-repo',
    status: overrides.status ?? 'success',
    created_at: overrides.created_at ?? recentIso,
    stopped_at: overrides.stopped_at ?? recentIso,
  };
}

// ---------------------------------------------------------------------------
// CircleCIConnector — sync
// ---------------------------------------------------------------------------

describe('CircleCIConnector.sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('returns done:true when every endpoint returns empty', async () => {
    installRouter((u) =>
      u.includes('/pipeline/')
        ? emptyWorkflowsResponse()
        : u.includes('/workflow/')
          ? emptyJobsResponse()
          : emptyPipelinesResponse(),
    );
    const result = await makeConnector().sync({ mode: 'full' }, makeStorage());
    expect(result.done).toBe(true);
  });

  it('clears entity types and event names on full sync first page', async () => {
    installRouter(() => emptyPipelinesResponse());
    const storage = makeStorage();
    await makeConnector({
      resources: ['pipelines', 'workflows', 'jobs', 'pipeline_events'],
    }).sync({ mode: 'full' }, storage);

    const clearedTypes = storage.entities.mock.calls
      .filter((c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0)
      .map((c) => (c[1] as { types: string[] }).types[0]);
    expect(clearedTypes).toEqual(
      expect.arrayContaining([
        'circleci_pipeline',
        'circleci_workflow',
        'circleci_job',
      ]),
    );

    const clearedEvents = storage.events.mock.calls
      .filter((c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0)
      .map((c) => (c[1] as { names: string[] }).names[0]);
    expect(clearedEvents).toContain('circleci_pipeline_event');
  });

  it('does not clear storage in latest (incremental) mode', async () => {
    installRouter(() => emptyPipelinesResponse());
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

  it('writes pipeline entities, workflow entities, and pipeline_events', async () => {
    const pipeline = pipelineFixture('pid-1');
    const workflow = workflowFixture('wid-1', 'pid-1', {
      status: 'success',
      created_at: '2024-05-01T00:00:00.000Z',
      stopped_at: '2024-05-01T00:01:30.000Z',
    });
    installRouter((u) => {
      if (u.includes('/workflow/')) {
        return emptyJobsResponse();
      }
      if (u.includes('/pipeline/pid-1/workflow')) {
        return { body: { items: [workflow], next_page_token: null } };
      }
      return { body: { items: [pipeline], next_page_token: null } };
    });
    const storage = makeStorage();
    await makeConnector({
      resources: ['pipelines', 'workflows', 'pipeline_events'],
    }).sync({ mode: 'full' }, storage);

    const pipelines = storage.entity.mock.calls
      .map((c) => c[0] as { type: string; id: string })
      .filter((e) => e.type === 'circleci_pipeline');
    expect(pipelines).toHaveLength(1);
    expect(pipelines[0]!.id).toBe('pid-1');

    const workflows = storage.entity.mock.calls
      .map(
        (c) =>
          c[0] as {
            type: string;
            id: string;
            attributes: Record<string, unknown>;
          },
      )
      .filter((e) => e.type === 'circleci_workflow');
    expect(workflows).toHaveLength(1);
    expect(workflows[0]!.id).toBe('wid-1');
    expect(workflows[0]!.attributes.durationMs).toBe(90_000);

    const events = storage.event.mock.calls
      .map((c) => c[0] as { name: string; attributes: Record<string, unknown> })
      .filter((e) => e.name === 'circleci_pipeline_event');
    expect(events).toHaveLength(1);
    expect(events[0]!.attributes.workflowId).toBe('wid-1');
  });

  it('skips workflows fetch when only pipelines is enabled', async () => {
    const pipeline = pipelineFixture('pid-1');
    const { calls } = installRouter(() => ({
      body: { items: [pipeline], next_page_token: null },
    }));
    await makeConnector({ resources: ['pipelines'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    expect(calls.some((c) => c.includes('/pipeline/pid-1/workflow'))).toBe(
      false,
    );
    expect(calls.some((c) => c.includes('/project/'))).toBe(true);
  });

  it('writes job entities only when jobs resource is enabled', async () => {
    const pipeline = pipelineFixture('pid-1');
    const workflow = workflowFixture('wid-1', 'pid-1');
    const job = {
      id: 'jid-1',
      name: 'test',
      status: 'success',
      type: 'build',
      job_number: 42,
      started_at: '2024-05-01T00:00:00.000Z',
      stopped_at: '2024-05-01T00:00:45.000Z',
      project_slug: 'gh/my-org/my-repo',
    };
    installRouter((u) => {
      if (u.includes('/workflow/wid-1/job')) {
        return { body: { items: [job], next_page_token: null } };
      }
      if (u.includes('/pipeline/pid-1/workflow')) {
        return { body: { items: [workflow], next_page_token: null } };
      }
      return { body: { items: [pipeline], next_page_token: null } };
    });
    const storage = makeStorage();
    await makeConnector({
      resources: ['pipelines', 'workflows', 'jobs'],
    }).sync({ mode: 'full' }, storage);

    const jobs = storage.entity.mock.calls
      .map(
        (c) =>
          c[0] as {
            type: string;
            id: string;
            attributes: Record<string, unknown>;
          },
      )
      .filter((e) => e.type === 'circleci_job');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.id).toBe('jid-1');
    expect(jobs[0]!.attributes.durationMs).toBe(45_000);
  });

  it('leaves jobs disabled by default when resources is omitted', async () => {
    const pipeline = pipelineFixture('pid-1');
    const workflow = workflowFixture('wid-1', 'pid-1');
    const { calls } = installRouter((u) => {
      if (u.includes('/pipeline/pid-1/workflow')) {
        return { body: { items: [workflow], next_page_token: null } };
      }
      return { body: { items: [pipeline], next_page_token: null } };
    });
    const storage = makeStorage();
    vi.stubEnv('CIRCLECI_API_TOKEN', 'ccitest');
    await CircleCIConnector.create({
      apiToken: { $secret: 'CIRCLECI_API_TOKEN' },
      projectSlugs: ['gh/my-org/my-repo'],
    }).sync({ mode: 'full' }, storage);

    expect(calls.some((c) => c.includes('/job'))).toBe(false);
    const writtenTypes = storage.entity.mock.calls.map(
      (c) => (c[0] as { type: string }).type,
    );
    expect(writtenTypes).toContain('circleci_pipeline');
    expect(writtenTypes).toContain('circleci_workflow');
    expect(writtenTypes).not.toContain('circleci_job');
    expect(storage.event.mock.calls.length).toBeGreaterThan(0);
  });

  it('passes Circle-Token header on every request', async () => {
    const { spy } = installRouter(() => emptyPipelinesResponse());
    await makeConnector().sync({ mode: 'full' }, makeStorage());
    expect(spy.mock.calls.length).toBeGreaterThan(0);
    for (const call of spy.mock.calls) {
      const headers = call[1].headers as Record<string, string>;
      expect(headers['circle-token']).toBe('ccitest');
    }
  });

  it('adds branch query param when configured', async () => {
    const { calls } = installRouter(() => emptyPipelinesResponse());
    await makeConnector({ branch: 'release' }).sync(
      { mode: 'full' },
      makeStorage(),
    );
    const pipelinesCall = calls.find((c) => c.includes('/pipeline'));
    expect(pipelinesCall).toBeDefined();
    expect(new URL(pipelinesCall!).searchParams.get('branch')).toBe('release');
  });

  it('iterates across multiple project slugs', async () => {
    const { calls } = installRouter(() => emptyPipelinesResponse());
    await makeConnector({
      projectSlugs: ['gh/org/a', 'gh/org/b'],
    }).sync({ mode: 'full' }, makeStorage());
    const projectPaths = calls
      .filter((c) => c.includes('/project/'))
      .map((c) => new URL(c).pathname);
    expect(projectPaths.some((p) => p.includes('gh/org/a'))).toBe(true);
    expect(projectPaths.some((p) => p.includes('gh/org/b'))).toBe(true);
  });

  it('follows the next_page_token within a slug before moving on', async () => {
    let firstPipelineCall = true;
    const { calls } = installRouter((u) => {
      if (u.includes('/pipeline/') && u.includes('/workflow')) {
        return emptyWorkflowsResponse();
      }
      if (u.includes('/project/')) {
        if (firstPipelineCall) {
          firstPipelineCall = false;
          return {
            body: {
              items: [pipelineFixture('pid-1')],
              next_page_token: 'TOK2',
            },
          };
        }
        return emptyPipelinesResponse();
      }
      return emptyPipelinesResponse();
    });
    const result = await makeConnector({
      resources: ['pipelines'],
    }).sync({ mode: 'full' }, makeStorage());
    expect(result.done).toBe(true);
    const pipelineCalls = calls.filter((c) => c.includes('/project/'));
    expect(pipelineCalls).toHaveLength(2);
    expect(new URL(pipelineCalls[1]!).searchParams.get('page-token')).toBe(
      'TOK2',
    );
  });

  it('short-circuits pagination once a page is entirely older than cutoff', async () => {
    const oldIso = new Date(
      Date.now() - 365 * 24 * 60 * 60 * 1000,
    ).toISOString();
    let pages = 0;
    installRouter((u) => {
      if (u.includes('/pipeline/') && u.includes('/workflow')) {
        return emptyWorkflowsResponse();
      }
      if (u.includes('/project/')) {
        pages += 1;
        return {
          body: {
            items: [
              pipelineFixture(`pid-${pages}`, {
                created_at: oldIso,
                updated_at: oldIso,
              }),
            ],
            next_page_token: pages < 5 ? `TOK${pages}` : null,
          },
        };
      }
      return emptyPipelinesResponse();
    });
    await makeConnector({
      resources: ['pipelines'],
      pipelinesLookbackDays: 30,
    }).sync({ mode: 'full' }, makeStorage());
    // After the first page (entirely older than cutoff), pagination stops for that slug.
    expect(pages).toBe(1);
  });

  it('rejects a saved cursor whose slug is not configured', async () => {
    const { calls } = installRouter(() => emptyPipelinesResponse());
    await makeConnector({
      projectSlugs: ['gh/my-org/my-repo'],
    }).sync(
      {
        mode: 'full',
        cursor: {
          phase: 'pipelines',
          page: JSON.stringify({ slug: 'gh/evil/x', token: 'attacker' }),
        },
      },
      makeStorage(),
    );
    expect(calls.some((c) => c.includes('gh/evil/x'))).toBe(false);
    expect(calls.some((c) => c.includes('gh/my-org/my-repo'))).toBe(true);
  });

  it('resumes from a saved cursor at the right slug and token', async () => {
    let firstCall = true;
    const { calls } = installRouter((u) => {
      if (u.includes('/pipeline/') && u.includes('/workflow')) {
        return emptyWorkflowsResponse();
      }
      if (firstCall && u.includes('gh/org/b')) {
        firstCall = false;
        return {
          body: {
            items: [pipelineFixture('pid-b1', { project_slug: 'gh/org/b' })],
            next_page_token: null,
          },
        };
      }
      return emptyPipelinesResponse();
    });
    await makeConnector({
      projectSlugs: ['gh/org/a', 'gh/org/b'],
      resources: ['pipelines'],
    }).sync(
      {
        mode: 'full',
        cursor: {
          phase: 'pipelines',
          page: JSON.stringify({ slug: 'gh/org/b', token: 'TKN' }),
        },
      },
      makeStorage(),
    );
    expect(calls.some((c) => c.includes('gh/org/a'))).toBe(false);
    const bCall = calls.find((c) => c.includes('gh/org/b'));
    expect(bCall).toBeDefined();
    expect(new URL(bCall!).searchParams.get('page-token')).toBe('TKN');
  });

  it('skips pipelines with unparseable timestamps', async () => {
    installRouter((u) => {
      if (u.includes('/pipeline/') && u.includes('/workflow')) {
        return emptyWorkflowsResponse();
      }
      if (u.includes('/project/')) {
        return {
          body: {
            items: [
              {
                id: 'pid-bad',
                number: 1,
                project_slug: 'gh/my-org/my-repo',
                state: 'created',
                created_at: 'not-a-date',
                updated_at: nowIso,
              },
              pipelineFixture('pid-ok'),
            ],
            next_page_token: null,
          },
        };
      }
      return emptyPipelinesResponse();
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const storage = makeStorage();
      await makeConnector({ resources: ['pipelines'] }).sync(
        { mode: 'full' },
        storage,
      );
      const written = storage.entity.mock.calls
        .map((c) => c[0] as { type: string; id: string })
        .filter((e) => e.type === 'circleci_pipeline')
        .map((e) => e.id);
      expect(written).toEqual(['pid-ok']);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('CircleCIConnector.create', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns a connector instance bound to the parsed config', () => {
    vi.stubEnv('CIRCLECI_TEST_TOKEN', 'circleci_fixture');
    const connector = CircleCIConnector.create({
      apiToken: { $secret: 'CIRCLECI_TEST_TOKEN' },
      projectSlugs: ['gh/my-org/my-repo'],
    });
    expect(connector).toBeInstanceOf(CircleCIConnector);
    expect(connector.id).toBe('circleci');
  });
});
