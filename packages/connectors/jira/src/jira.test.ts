import { afterEach, describe, expect, it, vi } from 'vitest';

import { JiraConnector, configFields } from './jira';

describe('configFields', () => {
  it('parses a valid config', () => {
    const result = configFields.safeParse({
      email: 'bot@acme.test',
      apiToken: { $secret: 'JIRA_API_TOKEN' },
      host: 'acme.atlassian.net',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a config missing apiToken', () => {
    const result = configFields.safeParse({
      email: 'bot@acme.test',
      host: 'acme.atlassian.net',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an apiToken passed as a plain string', () => {
    const result = configFields.safeParse({
      email: 'bot@acme.test',
      apiToken: 'plain-token',
      host: 'acme.atlassian.net',
    });
    expect(result.success).toBe(false);
  });

  it('accepts optional projectKeys and resources', () => {
    const result = configFields.safeParse({
      email: 'bot@acme.test',
      apiToken: { $secret: 'JIRA_API_TOKEN' },
      host: 'acme.atlassian.net',
      projectKeys: ['ENG'],
      resources: ['issues'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.projectKeys).toEqual(['ENG']);
      expect(result.data.resources).toEqual(['issues']);
    }
  });

  it('rejects empty projectKeys array', () => {
    const result = configFields.safeParse({
      email: 'bot@acme.test',
      apiToken: { $secret: 'JIRA_API_TOKEN' },
      host: 'acme.atlassian.net',
      projectKeys: [],
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

const CREDS = {
  email: 'bot@acme.test' as unknown as { $secret: string },
  apiToken: 'jira_secret' as unknown as { $secret: string },
};

interface RouteResponses {
  projects?: unknown;
  users?: unknown;
  boards?: unknown;
  sprints?: unknown;
  issues?: unknown;
}

const EMPTY: Required<RouteResponses> = {
  projects: { values: [], isLast: true, startAt: 0, maxResults: 50, total: 0 },
  users: [],
  boards: { values: [], isLast: true, startAt: 0, maxResults: 50 },
  sprints: { values: [], isLast: true, startAt: 0, maxResults: 50 },
  issues: { issues: [], isLast: true, nextPageToken: null },
};

function mockFetch(responses: RouteResponses = {}) {
  const merged = { ...EMPTY, ...responses };
  const spy = vi.fn().mockImplementation((url: string | URL) => {
    const u = typeof url === 'string' ? url : url.toString();
    let body: unknown = {};
    if (u.includes('/sprint')) {
      body = merged.sprints;
    } else if (u.includes('/rest/agile/1.0/board')) {
      body = merged.boards;
    } else if (u.includes('/project/search')) {
      body = merged.projects;
    } else if (u.includes('/users/search')) {
      body = merged.users;
    } else if (u.includes('/search/jql')) {
      body = merged.issues;
    }
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

function urlsFor(spy: ReturnType<typeof vi.fn>): string[] {
  return spy.mock.calls.map((c) => String(c[0]));
}

function makeConnector(settings: Record<string, unknown> = {}): JiraConnector {
  return new JiraConnector({ host: 'acme.atlassian.net', ...settings }, CREDS);
}

describe('JiraConnector.sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns done:true when all phases return empty pages', async () => {
    mockFetch();
    const result = await makeConnector().sync({ mode: 'full' }, makeStorage());
    expect(result.done).toBe(true);
  });

  it('clears entity types and event names on full sync first page', async () => {
    mockFetch();
    const storage = makeStorage();
    await makeConnector().sync({ mode: 'full' }, storage);

    const clearedTypes = storage.entities.mock.calls
      .filter((c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0)
      .map((c) => (c[1] as { types: string[] }).types[0]);
    expect(clearedTypes).toEqual(
      expect.arrayContaining([
        'jira_project',
        'jira_user',
        'jira_sprint',
        'jira_issue',
      ]),
    );

    const clearedEvents = storage.events.mock.calls
      .filter((c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0)
      .map((c) => (c[1] as { names: string[] }).names[0]);
    expect(clearedEvents).toContain('jira_issue_status_change');
  });

  it('does not clear storage in latest (incremental) mode', async () => {
    mockFetch();
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

  it('writes project entities with lead attributes', async () => {
    mockFetch({
      projects: {
        values: [
          {
            id: '10000',
            key: 'ENG',
            name: 'Engineering',
            projectTypeKey: 'software',
            lead: { accountId: 'acc-1', displayName: 'Dana' },
          },
        ],
        isLast: true,
        startAt: 0,
        maxResults: 50,
        total: 1,
      },
    });
    const storage = makeStorage();
    await makeConnector({ resources: ['projects'] }).sync(
      { mode: 'full' },
      storage,
    );

    const writes = storage.entity.mock.calls
      .map(
        (c) =>
          c[0] as {
            type: string;
            id: string;
            attributes: Record<string, unknown>;
          },
      )
      .filter((e) => e.type === 'jira_project');
    expect(writes).toHaveLength(1);
    expect(writes[0]!.id).toBe('10000');
    expect(writes[0]!.attributes.leadAccountId).toBe('acc-1');
    expect(writes[0]!.attributes.key).toBe('ENG');
  });

  it('writes user entities', async () => {
    mockFetch({
      users: [
        {
          accountId: 'acc-1',
          displayName: 'Dana',
          emailAddress: 'dana@acme.test',
          accountType: 'atlassian',
          active: true,
        },
      ],
    });
    const storage = makeStorage();
    await makeConnector({ resources: ['users'] }).sync(
      { mode: 'full' },
      storage,
    );

    const writes = storage.entity.mock.calls
      .map((c) => c[0] as { type: string; id: string })
      .filter((e) => e.type === 'jira_user');
    expect(writes).toHaveLength(1);
    expect(writes[0]!.id).toBe('acc-1');
  });

  it('writes issue entities and status-change events from the changelog', async () => {
    const issue = {
      id: 'i-1',
      key: 'ENG-7',
      fields: {
        summary: 'Fix sync',
        status: {
          name: 'In Progress',
          statusCategory: { key: 'indeterminate' },
        },
        priority: { name: 'High' },
        issuetype: { name: 'Bug' },
        assignee: { accountId: 'acc-1' },
        reporter: { accountId: 'acc-2' },
        project: { id: '10000', key: 'ENG' },
        created: '2024-05-01T00:00:00.000Z',
        updated: '2024-05-02T00:00:00.000Z',
        resolutiondate: null,
        customfield_10016: 5,
        customfield_10020: [{ id: 12, name: 'Sprint 12' }],
      },
      changelog: {
        histories: [
          {
            id: 'h-1',
            created: '2024-05-01T10:00:00.000Z',
            author: { accountId: 'acc-1' },
            items: [
              { field: 'status', fromString: 'To Do', toString: 'In Progress' },
              { field: 'assignee', fromString: null, toString: 'Dana' },
            ],
          },
        ],
      },
    };
    mockFetch({
      issues: { issues: [issue], isLast: true, nextPageToken: null },
    });

    const storage = makeStorage();
    await makeConnector({ resources: ['issues', 'issue_events'] }).sync(
      { mode: 'full' },
      storage,
    );

    const issueWrites = storage.entity.mock.calls
      .map(
        (c) =>
          c[0] as {
            type: string;
            id: string;
            attributes: Record<string, unknown>;
          },
      )
      .filter((e) => e.type === 'jira_issue');
    expect(issueWrites).toHaveLength(1);
    expect(issueWrites[0]!.id).toBe('i-1');
    expect(issueWrites[0]!.attributes.storyPoints).toBe(5);
    expect(issueWrites[0]!.attributes.sprintId).toBe('12');
    expect(issueWrites[0]!.attributes.statusCategory).toBe('indeterminate');

    const statusEvents = storage.event.mock.calls
      .map((c) => c[0] as { name: string; attributes: Record<string, unknown> })
      .filter((e) => e.name === 'jira_issue_status_change');
    expect(statusEvents).toHaveLength(1);
    expect(statusEvents[0]!.attributes.fromStatus).toBe('To Do');
    expect(statusEvents[0]!.attributes.toStatus).toBe('In Progress');
  });

  it('skips changelog events with created <= since in latest mode', async () => {
    const since = '2024-05-01T00:00:00.000Z';
    const issue = {
      id: 'i-1',
      key: 'ENG-7',
      fields: {
        summary: 'Fix sync',
        status: { name: 'Done', statusCategory: { key: 'done' } },
        project: { id: '10000', key: 'ENG' },
        created: '2024-04-01T00:00:00.000Z',
        updated: '2024-05-02T00:00:00.000Z',
        resolutiondate: '2024-05-02T00:00:00.000Z',
      },
      changelog: {
        histories: [
          {
            id: 'h-old',
            created: '2024-04-15T00:00:00.000Z',
            author: null,
            items: [
              { field: 'status', fromString: 'Backlog', toString: 'To Do' },
            ],
          },
          {
            id: 'h-new',
            created: '2024-05-02T00:00:00.000Z',
            author: null,
            items: [{ field: 'status', fromString: 'To Do', toString: 'Done' }],
          },
        ],
      },
    };
    mockFetch({
      issues: { issues: [issue], isLast: true, nextPageToken: null },
    });

    const storage = makeStorage();
    await makeConnector({ resources: ['issues', 'issue_events'] }).sync(
      { mode: 'latest', since },
      storage,
    );

    const statusEvents = storage.event.mock.calls
      .map((c) => c[0] as { name: string; attributes: Record<string, unknown> })
      .filter((e) => e.name === 'jira_issue_status_change');
    expect(statusEvents).toHaveLength(1);
    expect(statusEvents[0]!.attributes.historyId).toBe('h-new');
  });

  it('builds incremental JQL with an updated bound and project scope', async () => {
    const spy = mockFetch();
    await makeConnector({
      resources: ['issues'],
      projectKeys: ['ENG', 'OPS'],
    }).sync(
      { mode: 'latest', since: '2024-05-01T12:34:56.000Z' },
      makeStorage(),
    );

    const issuesUrl = urlsFor(spy).find((u) => u.includes('/search/jql'));
    expect(issuesUrl).toBeDefined();
    const jql = new URL(issuesUrl!).searchParams.get('jql')!;
    expect(jql).toContain('project in ("ENG","OPS")');
    expect(jql).toContain('updated >= "2024-05-01 12:34"');
    expect(jql).toContain('ORDER BY updated ASC');
  });

  it('only fetches phases listed in settings.resources', async () => {
    const spy = mockFetch();
    await makeConnector({ resources: ['projects'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const urls = urlsFor(spy);
    expect(urls.some((u) => u.includes('/project/search'))).toBe(true);
    expect(urls.some((u) => u.includes('/users/search'))).toBe(false);
    expect(urls.some((u) => u.includes('/search/jql'))).toBe(false);
  });

  it('sends Basic auth derived from email and token', async () => {
    const spy = mockFetch();
    await makeConnector({ resources: ['projects'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const headers = spy.mock.calls[0]![1].headers as Record<string, string>;
    const expected = `Basic ${btoa('bot@acme.test:jira_secret')}`;
    expect(headers.Authorization ?? headers.authorization).toBe(expected);
  });

  it('only fetches sprints for scrum boards', async () => {
    const spy = mockFetch({
      boards: {
        values: [
          { id: 1, name: 'Scrum', type: 'scrum' },
          { id: 2, name: 'Kanban', type: 'kanban' },
        ],
        isLast: true,
        startAt: 0,
        maxResults: 50,
      },
      sprints: {
        values: [
          {
            id: 99,
            name: 'Sprint 99',
            state: 'active',
            startDate: '2024-05-01T00:00:00.000Z',
            endDate: '2024-05-14T00:00:00.000Z',
          },
        ],
        isLast: true,
        startAt: 0,
        maxResults: 50,
      },
    });

    const storage = makeStorage();
    await makeConnector({ resources: ['sprints'] }).sync(
      { mode: 'full' },
      storage,
    );

    const urls = urlsFor(spy);
    expect(urls.some((u) => u.includes('/board/1/sprint'))).toBe(true);
    expect(urls.some((u) => u.includes('/board/2/sprint'))).toBe(false);

    const sprintWrites = storage.entity.mock.calls
      .map(
        (c) =>
          c[0] as {
            type: string;
            id: string;
            attributes: Record<string, unknown>;
          },
      )
      .filter((e) => e.type === 'jira_sprint');
    expect(sprintWrites).toHaveLength(1);
    expect(sprintWrites[0]!.id).toBe('99');
    expect(sprintWrites[0]!.attributes.boardId).toBe(1);
  });

  it('resumes issues pagination from a saved nextPageToken cursor', async () => {
    const spy = mockFetch();
    await makeConnector({ resources: ['issues'] }).sync(
      { mode: 'full', cursor: { phase: 'issues', page: 'TOKEN-123' } },
      makeStorage(),
    );

    const issuesUrl = urlsFor(spy).find((u) => u.includes('/search/jql'));
    expect(issuesUrl).toBeDefined();
    expect(new URL(issuesUrl!).searchParams.get('nextPageToken')).toBe(
      'TOKEN-123',
    );
  });
});

describe('JiraConnector filter pushdown', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function issuesJql(spy: ReturnType<typeof vi.fn>): string {
    const url = urlsFor(spy).find((u) => u.includes('/search/jql'));
    expect(url).toBeDefined();
    return new URL(url!).searchParams.get('jql') ?? '';
  }

  async function syncWith(
    fetchSpecs: Record<string, { filter: unknown[] }[]>,
  ): Promise<ReturnType<typeof vi.fn>> {
    const spy = mockFetch();
    await makeConnector().sync(
      {
        mode: 'full',
        resources: new Set(['issues']),
        fetchSpecs: fetchSpecs as never,
      },
      makeStorage(),
    );
    return spy;
  }

  it('pushes a declared status filter into the JQL', async () => {
    const spy = await syncWith({
      jira_issue: [
        { filter: [{ field: 'statusName', op: 'eq', value: 'In Progress' }] },
      ],
    });
    expect(issuesJql(spy)).toContain('status = "In Progress"');
  });

  it('pushes priority and issue type filters into the JQL', async () => {
    const spy = await syncWith({
      jira_issue: [
        {
          filter: [
            { field: 'priority', op: 'eq', value: 'High' },
            { field: 'issueType', op: 'eq', value: 'Bug' },
          ],
        },
      ],
    });
    const jql = issuesJql(spy);
    expect(jql).toContain('priority = "High"');
    expect(jql).toContain('issuetype = "Bug"');
  });

  it('does not push when multiple specs target the resource', async () => {
    const spy = await syncWith({
      jira_issue: [
        { filter: [{ field: 'statusName', op: 'eq', value: 'Done' }] },
        { filter: [{ field: 'statusName', op: 'eq', value: 'To Do' }] },
      ],
    });
    expect(issuesJql(spy)).not.toContain('status =');
  });
});

describe('JiraConnector sprint state pushdown', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockScrumBoard(): ReturnType<typeof vi.fn> {
    return mockFetch({
      boards: {
        values: [{ id: 1, name: 'Scrum', type: 'scrum' }],
        isLast: true,
        startAt: 0,
        maxResults: 50,
      },
    });
  }

  async function syncSprintsWith(
    spy: ReturnType<typeof vi.fn>,
    fetchSpecs: Record<string, { filter: unknown[] }[]>,
  ): Promise<void> {
    await makeConnector({ resources: ['sprints'] }).sync(
      {
        mode: 'full',
        resources: new Set(['sprints']),
        fetchSpecs: fetchSpecs as never,
      },
      makeStorage(),
    );
  }

  function sprintUrl(spy: ReturnType<typeof vi.fn>): string {
    const url = urlsFor(spy).find((u) => u.includes('/board/1/sprint'));
    expect(url).toBeDefined();
    return url!;
  }

  it('pushes a declared state filter into the board sprint request', async () => {
    const spy = mockScrumBoard();
    await syncSprintsWith(spy, {
      jira_sprint: [
        { filter: [{ field: 'state', op: 'eq', value: 'active' }] },
      ],
    });
    expect(new URL(sprintUrl(spy)).searchParams.get('state')).toBe('active');
  });

  it('does not push state when multiple specs target the resource', async () => {
    const spy = mockScrumBoard();
    await syncSprintsWith(spy, {
      jira_sprint: [
        { filter: [{ field: 'state', op: 'eq', value: 'active' }] },
        { filter: [{ field: 'state', op: 'eq', value: 'closed' }] },
      ],
    });
    expect(new URL(sprintUrl(spy)).searchParams.has('state')).toBe(false);
  });
});

describe('JiraConnector.create', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the connector instance directly', () => {
    vi.stubEnv('JIRA_TEST_TOKEN', 'jira_fixture');
    const connector = JiraConnector.create({
      email: 'bot@acme.test',
      apiToken: { $secret: 'JIRA_TEST_TOKEN' },
      host: 'acme.atlassian.net',
    });
    expect(connector).toBeInstanceOf(JiraConnector);
    expect(connector.id).toBe('jira');
  });
});
