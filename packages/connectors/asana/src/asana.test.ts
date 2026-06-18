import { afterEach, describe, expect, it, vi } from 'vitest';

import { AsanaConnector, configFields } from './asana';

describe('configFields', () => {
  it('parses a valid config', () => {
    const result = configFields.safeParse({
      apiToken: { $secret: 'ASANA_API_TOKEN' },
      workspaceGid: '1201234567890',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a config missing apiToken', () => {
    const result = configFields.safeParse({
      workspaceGid: '1201234567890',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an apiToken passed as a plain string', () => {
    const result = configFields.safeParse({
      apiToken: 'plain-token',
      workspaceGid: '1201234567890',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-numeric workspaceGid', () => {
    const result = configFields.safeParse({
      apiToken: { $secret: 'ASANA_API_TOKEN' },
      workspaceGid: 'not-a-gid',
    });
    expect(result.success).toBe(false);
  });

  it('accepts optional projectGids and resources', () => {
    const result = configFields.safeParse({
      apiToken: { $secret: 'ASANA_API_TOKEN' },
      workspaceGid: '1201234567890',
      projectGids: ['111'],
      resources: ['tasks'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.projectGids).toEqual(['111']);
      expect(result.data.resources).toEqual(['tasks']);
    }
  });

  it('rejects empty projectGids array', () => {
    const result = configFields.safeParse({
      apiToken: { $secret: 'ASANA_API_TOKEN' },
      workspaceGid: '1201234567890',
      projectGids: [],
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
  apiToken: 'asana_secret' as unknown as { $secret: string },
};

interface RouteResponses {
  projects?: unknown;
  users?: unknown;
  tasks?: unknown;
  stories?: unknown;
}

const EMPTY: Required<RouteResponses> = {
  projects: { data: [], next_page: null },
  users: { data: [], next_page: null },
  tasks: { data: [], next_page: null },
  stories: { data: [], next_page: null },
};

function mockFetch(responses: RouteResponses = {}) {
  const merged = { ...EMPTY, ...responses };
  const spy = vi.fn().mockImplementation((url: string | URL) => {
    const u = typeof url === 'string' ? url : url.toString();
    let body: unknown = {};
    if (/\/tasks\/[^/]+\/stories/.test(u)) {
      body = merged.stories;
    } else if (u.includes('/tasks')) {
      body = merged.tasks;
    } else if (u.includes('/projects')) {
      body = merged.projects;
    } else if (u.includes('/users')) {
      body = merged.users;
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

function makeConnector(settings: Record<string, unknown> = {}) {
  return new AsanaConnector(
    { workspaceGid: '900', ...settings } as never,
    CREDS,
  );
}

describe('AsanaConnector.sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('writes projects, users, tasks, and task events', async () => {
    mockFetch({
      projects: {
        data: [
          {
            gid: '1',
            name: 'Launch',
            archived: false,
            created_at: '2024-01-01T00:00:00.000Z',
            modified_at: '2024-02-01T00:00:00.000Z',
            owner: { gid: 'u1' },
            team: { name: 'Growth' },
          },
        ],
        next_page: null,
      },
      users: {
        data: [{ gid: 'u1', name: 'Ada', email: 'ada@acme.test' }],
        next_page: null,
      },
      tasks: {
        data: [
          {
            gid: 't1',
            name: 'Ship it',
            completed: false,
            created_at: '2024-01-02T00:00:00.000Z',
            modified_at: '2024-01-03T00:00:00.000Z',
            due_on: '2024-02-15',
            assignee: { gid: 'u1' },
          },
        ],
        next_page: null,
      },
      stories: {
        data: [
          {
            gid: 's1',
            type: 'system',
            resource_subtype: 'marked_complete',
            created_at: '2024-01-04T00:00:00.000Z',
            created_by: { gid: 'u1' },
            text: 'completed this task',
          },
          {
            gid: 's2',
            type: 'comment',
            resource_subtype: 'comment_added',
            created_at: '2024-01-05T00:00:00.000Z',
            created_by: { gid: 'u1' },
            text: 'looks good',
          },
        ],
        next_page: null,
      },
    });

    const storage = makeStorage();
    const result = await makeConnector().sync(
      { mode: 'full' },
      storage as never,
    );

    expect(result.done).toBe(true);

    const entityTypes = storage.entity.mock.calls.map(
      (c) => (c[0] as { type: string }).type,
    );
    expect(entityTypes).toContain('asana_project');
    expect(entityTypes).toContain('asana_user');
    expect(entityTypes).toContain('asana_task');

    const task = storage.entity.mock.calls
      .map((c) => c[0] as { type: string; attributes: Record<string, unknown> })
      .find((e) => e.type === 'asana_task');
    expect(task?.attributes['projectGid']).toBe('1');
    expect(task?.attributes['assigneeId']).toBe('u1');
    expect(task?.attributes['completed']).toBe(false);

    expect(storage.event).toHaveBeenCalledTimes(1);
    const event = storage.event.mock.calls[0]![0] as {
      name: string;
      attributes: Record<string, unknown>;
    };
    expect(event.name).toBe('asana_task_event');
    expect(event.attributes['resourceSubtype']).toBe('marked_complete');
  });

  it('skips entity writes but still fetches stories when only task_events is enabled', async () => {
    mockFetch({
      tasks: {
        data: [
          {
            gid: 't1',
            name: 'Ship it',
            created_at: '2024-01-02T00:00:00.000Z',
          },
        ],
        next_page: null,
      },
      stories: {
        data: [
          {
            gid: 's1',
            type: 'system',
            resource_subtype: 'assigned',
            created_at: '2024-01-04T00:00:00.000Z',
            created_by: { gid: 'u1' },
            text: 'assigned to Ada',
          },
        ],
        next_page: null,
      },
    });

    const storage = makeStorage();
    await makeConnector({
      projectGids: ['1'],
      resources: ['task_events'],
    }).sync({ mode: 'full' }, storage as never);

    const taskEntities = storage.entity.mock.calls.filter(
      (c) => (c[0] as { type: string }).type === 'asana_task',
    );
    expect(taskEntities).toHaveLength(0);
    expect(storage.event).toHaveBeenCalledTimes(1);
  });

  it('clears entities at the start of a full sync', async () => {
    mockFetch();
    const storage = makeStorage();
    await makeConnector({ resources: ['projects'] }).sync(
      { mode: 'full' },
      storage as never,
    );
    expect(storage.entities).toHaveBeenCalledWith([], {
      types: ['asana_project'],
    });
  });
});
