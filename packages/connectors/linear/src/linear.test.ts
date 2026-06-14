import { afterEach, describe, expect, it, vi } from 'vitest';

import { LinearConnector, configFields } from './linear';

describe('configFields', () => {
  it('parses a valid config with only apiKey', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'LINEAR_API_KEY' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a config missing apiKey', () => {
    const result = configFields.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects an apiKey passed as a plain string', () => {
    const result = configFields.safeParse({ apiKey: 'lin_api_plain' });
    expect(result.success).toBe(false);
  });

  it('accepts optional teamIds and resources', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'LINEAR_API_KEY' },
      teamIds: ['team-1'],
      resources: ['issues'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.teamIds).toEqual(['team-1']);
      expect(result.data.resources).toEqual(['issues']);
    }
  });

  it('rejects empty teamIds array', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'LINEAR_API_KEY' },
      teamIds: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects historyPerIssue above 50', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'LINEAR_API_KEY' },
      historyPerIssue: 200,
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

function emptyConn() {
  return { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } };
}

interface GraphQLCall {
  query: string;
  variables: Record<string, unknown>;
}

function mockGraphql(
  responseFor: (call: GraphQLCall) => Record<string, unknown>,
): {
  spy: ReturnType<typeof vi.fn>;
  calls: GraphQLCall[];
} {
  const calls: GraphQLCall[] = [];
  const spy = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
    const parsed = JSON.parse(init.body as string) as GraphQLCall;
    calls.push(parsed);
    const data = responseFor(parsed);
    const body = JSON.stringify({ data });
    return Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      text: () => Promise.resolve(body),
    } as Response);
  });
  return { spy, calls };
}

function operationName(query: string): string {
  const match = query.match(/query\s+(\w+)/);
  return match ? match[1]! : '';
}

describe('LinearConnector.sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns done:true when all phases return empty pages', async () => {
    const connector = new LinearConnector(
      {},
      { apiKey: 'lin_api_test' as unknown as { $secret: string } },
    );

    const { spy } = mockGraphql(() => ({
      teams: emptyConn(),
      users: emptyConn(),
      cycles: emptyConn(),
      issues: emptyConn(),
    }));
    vi.stubGlobal('fetch', spy);

    const result = await connector.sync({ mode: 'full' }, makeStorage());
    expect(result.done).toBe(true);
  });

  it('uses large default page sizes, capping issues by query complexity', async () => {
    const connector = new LinearConnector(
      {},
      { apiKey: 'lin_api_test' as unknown as { $secret: string } },
    );

    const { spy, calls } = mockGraphql(() => ({
      teams: emptyConn(),
      users: emptyConn(),
      cycles: emptyConn(),
      issues: emptyConn(),
    }));
    vi.stubGlobal('fetch', spy);

    await connector.sync({ mode: 'full' }, makeStorage());

    const teams = calls.find((c) => operationName(c.query) === 'Teams')!;
    const issues = calls.find((c) => operationName(c.query) === 'Issues')!;
    expect(teams.variables.first).toBe(250);
    expect(issues.variables.first).toBe(150);
    expect(issues.variables.historyFirst).toBe(8);
  });

  it('honors options.pageSize, clamped and complexity-capped', async () => {
    const connector = new LinearConnector(
      {},
      { apiKey: 'lin_api_test' as unknown as { $secret: string } },
    );

    const { spy, calls } = mockGraphql(() => ({
      teams: emptyConn(),
      users: emptyConn(),
      cycles: emptyConn(),
      issues: emptyConn(),
    }));
    vi.stubGlobal('fetch', spy);

    await connector.sync({ mode: 'full', pageSize: 1000 }, makeStorage());

    const teams = calls.find((c) => operationName(c.query) === 'Teams')!;
    const issues = calls.find((c) => operationName(c.query) === 'Issues')!;
    expect(teams.variables.first).toBe(250);
    expect(issues.variables.first).toBe(187);
  });

  it('clears entity types and event names on full sync first page', async () => {
    const connector = new LinearConnector(
      {},
      { apiKey: 'lin_api_test' as unknown as { $secret: string } },
    );

    const { spy } = mockGraphql(() => ({
      teams: emptyConn(),
      users: emptyConn(),
      cycles: emptyConn(),
      issues: emptyConn(),
    }));
    vi.stubGlobal('fetch', spy);

    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const clearedTypes = storage.entities.mock.calls
      .filter((c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0)
      .map((c) => (c[1] as { types: string[] }).types[0]);

    expect(clearedTypes).toEqual(
      expect.arrayContaining([
        'linear_team',
        'linear_user',
        'linear_cycle',
        'linear_issue',
      ]),
    );

    const clearedEvents = storage.events.mock.calls
      .filter((c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0)
      .map((c) => (c[1] as { names: string[] }).names[0]);
    expect(clearedEvents).toContain('linear_issue_state_change');
  });

  it('does not clear storage in latest (incremental) mode', async () => {
    const connector = new LinearConnector(
      {},
      { apiKey: 'lin_api_test' as unknown as { $secret: string } },
    );

    const { spy } = mockGraphql(() => ({
      teams: emptyConn(),
      users: emptyConn(),
      cycles: emptyConn(),
      issues: emptyConn(),
    }));
    vi.stubGlobal('fetch', spy);

    const storage = makeStorage();
    await connector.sync(
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

  it('writes team entities from the teams query response', async () => {
    const connector = new LinearConnector(
      { resources: ['teams'] },
      { apiKey: 'lin_api_test' as unknown as { $secret: string } },
    );

    const { spy } = mockGraphql(() => ({
      teams: {
        nodes: [
          {
            id: 'team-1',
            name: 'Core',
            key: 'CORE',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-06-01T00:00:00.000Z',
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    }));
    vi.stubGlobal('fetch', spy);

    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const teamWrites = storage.entity.mock.calls
      .map((c) => c[0] as { type: string; id: string })
      .filter((e) => e.type === 'linear_team');
    expect(teamWrites).toHaveLength(1);
    expect(teamWrites[0]!.id).toBe('team-1');
  });

  it('writes issue entities and state-transition events', async () => {
    const connector = new LinearConnector(
      { resources: ['issues'] },
      { apiKey: 'lin_api_test' as unknown as { $secret: string } },
    );

    const issue = {
      id: 'issue-1',
      identifier: 'CORE-7',
      title: 'Fix sync',
      priority: 2,
      estimate: 3,
      state: { id: 's-in-progress', name: 'In Progress', type: 'started' },
      assignee: { id: 'user-1' },
      team: { id: 'team-1' },
      project: null,
      cycle: null,
      labels: { nodes: [{ id: 'l-1', name: 'bug' }] },
      createdAt: '2024-05-01T00:00:00.000Z',
      updatedAt: '2024-05-02T00:00:00.000Z',
      completedAt: null,
      canceledAt: null,
      startedAt: '2024-05-01T12:00:00.000Z',
      history: {
        nodes: [
          {
            id: 'h-1',
            createdAt: '2024-05-01T10:00:00.000Z',
            actor: { id: 'user-1' },
            fromState: { id: 's-todo', name: 'Todo' },
            toState: { id: 's-in-progress', name: 'In Progress' },
            fromAssignee: null,
            toAssignee: null,
          },
          {
            id: 'h-2',
            createdAt: '2024-05-01T11:00:00.000Z',
            actor: { id: 'user-1' },
            fromState: null,
            toState: { id: 's-in-progress', name: 'In Progress' },
            fromAssignee: null,
            toAssignee: { id: 'user-2' },
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    };

    const { spy } = mockGraphql(() => ({
      issues: {
        nodes: [issue],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    }));
    vi.stubGlobal('fetch', spy);

    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const issueWrites = storage.entity.mock.calls
      .map((c) => c[0] as { type: string; id: string })
      .filter((e) => e.type === 'linear_issue');
    expect(issueWrites).toHaveLength(1);
    expect(issueWrites[0]!.id).toBe('issue-1');

    const eventWrites = storage.event.mock.calls.map(
      (c) => c[0] as { name: string; attributes: Record<string, unknown> },
    );
    const stateEvents = eventWrites.filter(
      (e) => e.name === 'linear_issue_state_change',
    );
    expect(stateEvents).toHaveLength(1);
    expect(stateEvents[0]!.attributes.fromStateId).toBe('s-todo');
    expect(stateEvents[0]!.attributes.toStateId).toBe('s-in-progress');
  });

  it('captures the most recent transitions when history exceeds historyPerIssue', async () => {
    const connector = new LinearConnector(
      { resources: ['issues'] },
      { apiKey: 'lin_api_test' as unknown as { $secret: string } },
    );

    const total = 12;
    const fullHistory = Array.from({ length: total }, (_, k) => ({
      id: `h-${String(k).padStart(2, '0')}`,
      createdAt: new Date(Date.UTC(2024, 0, 1 + k)).toISOString(),
      actor: { id: 'user-1' },
      fromState: { id: `s-${k}`, name: `State ${k}` },
      toState: { id: `s-${k + 1}`, name: `State ${k + 1}` },
      fromAssignee: null,
      toAssignee: null,
    }));

    const issue = {
      id: 'issue-1',
      identifier: 'CORE-7',
      title: 'Long-lived issue',
      priority: 2,
      estimate: null,
      state: { id: 's-12', name: 'State 12', type: 'started' },
      assignee: { id: 'user-1' },
      team: { id: 'team-1' },
      project: null,
      cycle: null,
      labels: { nodes: [] },
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-13T00:00:00.000Z',
      completedAt: null,
      canceledAt: null,
      startedAt: null,
    };

    const { spy } = mockGraphql((call) => {
      const n = call.variables.historyFirst as number;
      const nodes = /history\(last:/.test(call.query)
        ? fullHistory.slice(-n)
        : /history\(first:/.test(call.query)
          ? fullHistory.slice(0, n)
          : fullHistory;
      return {
        issues: {
          nodes: [
            {
              ...issue,
              history: {
                nodes,
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      };
    });
    vi.stubGlobal('fetch', spy);

    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const historyIds = storage.event.mock.calls
      .map((c) => c[0] as { name: string; attributes: Record<string, unknown> })
      .filter((e) => e.name === 'linear_issue_state_change')
      .map((e) => e.attributes.historyId as string);

    expect(historyIds).toContain('h-11');
    expect(historyIds).not.toContain('h-00');
  });

  it('skips history events with createdAt <= since in latest mode', async () => {
    const connector = new LinearConnector(
      { resources: ['issues'] },
      { apiKey: 'lin_api_test' as unknown as { $secret: string } },
    );

    const since = '2024-05-01T00:00:00.000Z';
    const issue = {
      id: 'issue-1',
      identifier: 'CORE-7',
      title: 'Fix sync',
      priority: 2,
      estimate: null,
      state: { id: 's-in-progress', name: 'In Progress', type: 'started' },
      assignee: null,
      team: { id: 'team-1' },
      project: null,
      cycle: null,
      labels: { nodes: [] },
      createdAt: '2024-04-01T00:00:00.000Z',
      updatedAt: '2024-05-02T00:00:00.000Z',
      completedAt: null,
      canceledAt: null,
      startedAt: null,
      history: {
        nodes: [
          {
            id: 'h-old',
            createdAt: '2024-04-15T00:00:00.000Z',
            actor: null,
            fromState: { id: 's-backlog', name: 'Backlog' },
            toState: { id: 's-todo', name: 'Todo' },
            fromAssignee: null,
            toAssignee: null,
          },
          {
            id: 'h-boundary',
            createdAt: since,
            actor: null,
            fromState: { id: 's-todo', name: 'Todo' },
            toState: { id: 's-ready', name: 'Ready' },
            fromAssignee: null,
            toAssignee: null,
          },
          {
            id: 'h-new',
            createdAt: '2024-05-02T00:00:00.000Z',
            actor: null,
            fromState: { id: 's-todo', name: 'Todo' },
            toState: { id: 's-in-progress', name: 'In Progress' },
            fromAssignee: null,
            toAssignee: null,
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    };

    const { spy } = mockGraphql(() => ({
      issues: {
        nodes: [issue],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    }));
    vi.stubGlobal('fetch', spy);

    const storage = makeStorage();
    await connector.sync({ mode: 'latest', since }, storage);

    const stateEvents = storage.event.mock.calls
      .map((c) => c[0] as { name: string; attributes: Record<string, unknown> })
      .filter((e) => e.name === 'linear_issue_state_change');
    expect(stateEvents).toHaveLength(1);
    expect(stateEvents[0]!.attributes.historyId).toBe('h-new');
  });

  it('throws an actionable error when GraphQL response is missing data', async () => {
    const connector = new LinearConnector(
      { resources: ['teams'] },
      { apiKey: 'lin_api_test' as unknown as { $secret: string } },
    );

    const spy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      text: () => Promise.resolve(JSON.stringify({})),
    } as Response);
    vi.stubGlobal('fetch', spy);

    const result = await connector.sync({ mode: 'full' }, makeStorage());
    expect(result.done).toBe(false);
    expect(result.transientError).toBeInstanceOf(Error);
    expect((result.transientError as Error).message).toContain('missing data');
  });

  it('passes Authorization header on every GraphQL request', async () => {
    const connector = new LinearConnector(
      {},
      { apiKey: 'lin_api_secret' as unknown as { $secret: string } },
    );

    const { spy } = mockGraphql(() => ({
      teams: emptyConn(),
      users: emptyConn(),
      cycles: emptyConn(),
      issues: emptyConn(),
    }));
    vi.stubGlobal('fetch', spy);

    await connector.sync({ mode: 'full' }, makeStorage());

    expect(spy.mock.calls.length).toBeGreaterThan(0);
    const headers = spy.mock.calls[0]![1].headers as Record<string, string>;
    expect(headers.authorization).toBe('lin_api_secret');
  });

  it('applies updatedAt filter in latest mode', async () => {
    const connector = new LinearConnector(
      { resources: ['issues'] },
      { apiKey: 'lin_api_test' as unknown as { $secret: string } },
    );

    const { spy, calls } = mockGraphql(() => ({ issues: emptyConn() }));
    vi.stubGlobal('fetch', spy);

    const since = '2024-05-01T00:00:00.000Z';
    await connector.sync({ mode: 'latest', since }, makeStorage());

    const issuesCall = calls.find((c) => operationName(c.query) === 'Issues');
    expect(issuesCall).toBeDefined();
    const filter = issuesCall!.variables.filter as Record<string, unknown>;
    expect((filter.updatedAt as { gt: string }).gt).toBe(since);
  });

  it('applies team filter for issues when teamIds is set', async () => {
    const connector = new LinearConnector(
      { resources: ['issues'], teamIds: ['team-1'] },
      { apiKey: 'lin_api_test' as unknown as { $secret: string } },
    );

    const { spy, calls } = mockGraphql(() => ({ issues: emptyConn() }));
    vi.stubGlobal('fetch', spy);

    await connector.sync({ mode: 'full' }, makeStorage());

    const issuesCall = calls.find((c) => operationName(c.query) === 'Issues');
    expect(issuesCall).toBeDefined();
    const filter = issuesCall!.variables.filter as Record<string, unknown>;
    expect((filter.team as { id: { in: string[] } }).id.in).toEqual(['team-1']);
  });

  it('only fetches phases listed in settings.resources', async () => {
    const connector = new LinearConnector(
      { resources: ['teams'] },
      { apiKey: 'lin_api_test' as unknown as { $secret: string } },
    );

    const { spy, calls } = mockGraphql(() => ({ teams: emptyConn() }));
    vi.stubGlobal('fetch', spy);

    await connector.sync({ mode: 'full' }, makeStorage());

    const operations = calls.map((c) => operationName(c.query));
    expect(operations).toContain('Teams');
    expect(operations).not.toContain('Users');
    expect(operations).not.toContain('Cycles');
    expect(operations).not.toContain('Issues');
  });

  it('resumes from a saved cursor', async () => {
    const connector = new LinearConnector(
      {},
      { apiKey: 'lin_api_test' as unknown as { $secret: string } },
    );

    const { spy, calls } = mockGraphql(() => ({
      cycles: emptyConn(),
      issues: emptyConn(),
    }));
    vi.stubGlobal('fetch', spy);

    await connector.sync(
      { mode: 'full', cursor: { phase: 'cycles', page: 'cycle-cursor' } },
      makeStorage(),
    );

    const operations = calls.map((c) => operationName(c.query));
    expect(operations).not.toContain('Teams');
    expect(operations).not.toContain('Users');
    expect(operations).toContain('Cycles');
    expect(operations).toContain('Issues');

    const firstCycles = calls.find((c) => operationName(c.query) === 'Cycles')!;
    expect(firstCycles.variables.after).toBe('cycle-cursor');
  });

  it('paginates through multiple pages within a phase', async () => {
    const connector = new LinearConnector(
      { resources: ['users'] },
      { apiKey: 'lin_api_test' as unknown as { $secret: string } },
    );

    let userPageCount = 0;
    const { spy } = mockGraphql(() => {
      userPageCount += 1;
      const hasNext = userPageCount < 2;
      return {
        users: {
          nodes: [
            {
              id: `u-${userPageCount}`,
              name: 'User',
              email: null,
              displayName: 'user',
              active: true,
              createdAt: '2024-01-01T00:00:00.000Z',
              updatedAt: '2024-01-01T00:00:00.000Z',
            },
          ],
          pageInfo: { hasNextPage: hasNext, endCursor: hasNext ? 'p2' : null },
        },
      };
    });
    vi.stubGlobal('fetch', spy);

    const storage = makeStorage();
    const result = await connector.sync({ mode: 'full' }, storage);

    expect(result.done).toBe(true);
    expect(userPageCount).toBe(2);
    const userWrites = storage.entity.mock.calls
      .map((c) => c[0] as { type: string })
      .filter((e) => e.type === 'linear_user');
    expect(userWrites).toHaveLength(2);
  });

  it('throws when the GraphQL response contains errors', async () => {
    const connector = new LinearConnector(
      { resources: ['teams'] },
      { apiKey: 'lin_api_test' as unknown as { $secret: string } },
    );

    const spy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      text: () =>
        Promise.resolve(JSON.stringify({ errors: [{ message: 'boom' }] })),
    } as Response);
    vi.stubGlobal('fetch', spy);

    const result = await connector.sync({ mode: 'full' }, makeStorage());
    expect(result.done).toBe(false);
    expect(result.transientError).toBeDefined();
  });
});

describe('LinearConnector filter pushdown', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function issuesFilter(
    fetchSpecs: Record<string, { filter: unknown[] }[]>,
  ): Promise<Record<string, unknown> | undefined> {
    const connector = new LinearConnector(
      {},
      { apiKey: 'lin_api_test' as unknown as { $secret: string } },
    );
    const { spy, calls } = mockGraphql(() => ({
      teams: emptyConn(),
      users: emptyConn(),
      cycles: emptyConn(),
      issues: emptyConn(),
    }));
    vi.stubGlobal('fetch', spy);
    await connector.sync(
      {
        mode: 'full',
        resources: new Set(['issues']),
        fetchSpecs: fetchSpecs as never,
      },
      makeStorage(),
    );
    const issues = calls.find((c) => operationName(c.query) === 'Issues')!;
    return issues.variables.filter as Record<string, unknown> | undefined;
  }

  it('pushes a declared state type filter into the issue filter', async () => {
    const filter = await issuesFilter({
      linear_issue: [
        { filter: [{ field: 'stateType', op: 'eq', value: 'started' }] },
      ],
    });
    expect(filter?.state).toEqual({ type: { eq: 'started' } });
  });

  it('pushes a declared priority filter into the issue filter', async () => {
    const filter = await issuesFilter({
      linear_issue: [{ filter: [{ field: 'priority', op: 'eq', value: 2 }] }],
    });
    expect(filter?.priority).toEqual({ eq: 2 });
  });

  it('does not push when multiple specs target the resource', async () => {
    const filter = await issuesFilter({
      linear_issue: [
        { filter: [{ field: 'stateType', op: 'eq', value: 'started' }] },
        { filter: [{ field: 'stateType', op: 'eq', value: 'completed' }] },
      ],
    });
    expect(filter?.state).toBeUndefined();
  });
});

describe('LinearConnector.create', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the connector instance directly', () => {
    vi.stubEnv('LINEAR_TEST_KEY', 'lin_api_fixture');
    const connector = LinearConnector.create({
      apiKey: { $secret: 'LINEAR_TEST_KEY' },
    });
    expect(connector).toBeInstanceOf(LinearConnector);
    expect(connector.id).toBe('linear');
  });
});
