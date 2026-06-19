import { afterEach, describe, expect, it, vi } from 'vitest';

import { ClickUpConnector, configFields } from './clickup';

describe('configFields', () => {
  it('parses a valid config with apiToken and teamId', () => {
    const result = configFields.safeParse({
      apiToken: { $secret: 'CLICKUP_API_TOKEN' },
      teamId: '9000000000',
    });
    expect(result.success).toBe(true);
  });

  it('parses a config with a resources allowlist', () => {
    const result = configFields.safeParse({
      apiToken: { $secret: 'CLICKUP_API_TOKEN' },
      teamId: '9000000000',
      resources: ['tasks', 'task_events'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown resource', () => {
    expect(
      configFields.safeParse({
        apiToken: { $secret: 'CLICKUP_API_TOKEN' },
        teamId: '9000000000',
        resources: ['milestones'],
      }).success,
    ).toBe(false);
  });

  it('rejects a plain string apiToken instead of secret object', () => {
    expect(
      configFields.safeParse({ apiToken: 'literal', teamId: '1' }).success,
    ).toBe(false);
  });

  it('rejects a config missing teamId', () => {
    expect(
      configFields.safeParse({ apiToken: { $secret: 'CLICKUP_API_TOKEN' } })
        .success,
    ).toBe(false);
  });
});

interface MockCall {
  url: string;
  method: string;
  headers: Record<string, string>;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body ?? null), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function makeFetch(route: (url: string) => unknown | undefined) {
  return vi.fn().mockImplementation((url: string | URL) => {
    const u = typeof url === 'string' ? url : url.toString();
    const explicit = route(u);
    if (explicit !== undefined) {
      return Promise.resolve(jsonResponse(explicit));
    }
    return Promise.resolve(jsonResponse({}));
  });
}

function recordCalls(spy: ReturnType<typeof vi.fn>): MockCall[] {
  return spy.mock.calls.map((c: unknown[]) => {
    const init = (c[1] ?? {}) as RequestInit;
    return {
      url: String(c[0]),
      method: (init.method ?? 'GET').toUpperCase(),
      headers: (init.headers ?? {}) as Record<string, string>,
    };
  });
}

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

const TOKEN = 'pk_test' as unknown as { $secret: string };

function connector(resources?: string[]) {
  return new ClickUpConnector(
    { teamId: '900', resources: resources as never },
    { apiToken: TOKEN },
  );
}

describe('ClickUpConnector.sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns done:true when every phase is empty', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetch(() => undefined),
    );
    const result = await connector().sync({ mode: 'full' }, makeStorage());
    expect(result.done).toBe(true);
  });

  it('sends the API token in the Authorization header verbatim', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector(['spaces']).sync({ mode: 'full' }, makeStorage());

    const headers = recordCalls(fetchSpy)[0]!.headers;
    expect(headers['authorization']).toBe('pk_test');
    expect(headers['accept']).toBe('application/json');
  });

  it('writes task entities with status, list, and lifecycle timestamps', async () => {
    const fetchSpy = makeFetch((url) => {
      if (url.includes('/task?') || url.includes('/task&')) {
        return {
          tasks: [
            {
              id: 'abc123',
              name: 'Ship the thing',
              status: { status: 'in progress', type: 'custom' },
              priority: { priority: 'high' },
              date_created: '1700000000000',
              date_updated: '1700000500000',
              date_closed: null,
              assignees: [{ id: 1 }, { id: 2 }],
              tags: [{ name: 'backend' }],
              list: { id: 'list1', name: 'Sprint 1' },
              space: { id: 'space1' },
            },
          ],
          last_page: true,
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['tasks']).sync({ mode: 'full' }, storage);

    const entity = storage.entity.mock.calls[0]![0] as {
      type: string;
      id: string;
      attributes: Record<string, unknown>;
      updated_at: number;
    };
    expect(entity.type).toBe('clickup_task');
    expect(entity.id).toBe('abc123');
    expect(entity.attributes.status).toBe('in progress');
    expect(entity.attributes.statusType).toBe('custom');
    expect(entity.attributes.priority).toBe('high');
    expect(entity.attributes.listId).toBe('list1');
    expect(entity.attributes.assignees).toEqual(['1', '2']);
    expect(entity.attributes.assigneeCount).toBe(2);
    expect(entity.attributes.tags).toEqual(['backend']);
    expect(entity.attributes.createdAt).toBe(1700000000000);
    expect(entity.attributes.closedAt).toBeNull();
    expect(entity.updated_at).toBe(1700000500000);
  });

  it('derives created and closed lifecycle events from task timestamps', async () => {
    const fetchSpy = makeFetch((url) => {
      if (url.includes('/task?') || url.includes('/task&')) {
        return {
          tasks: [
            {
              id: 't1',
              name: 'Closed task',
              status: { status: 'done', type: 'closed' },
              date_created: '1700000000000',
              date_closed: '1700009000000',
              list: { id: 'list1' },
              space: { id: 'space1' },
            },
          ],
          last_page: true,
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['task_events']).sync({ mode: 'full' }, storage);

    const events = storage.event.mock.calls.map(
      (c) =>
        c[0] as {
          name: string;
          start_ts: number;
          attributes: { kind: string };
        },
    );
    expect(events.map((e) => e.attributes.kind).sort()).toEqual([
      'closed',
      'created',
    ]);
    const created = events.find((e) => e.attributes.kind === 'created')!;
    expect(created.start_ts).toBe(1700000000000);
    const closed = events.find((e) => e.attributes.kind === 'closed')!;
    expect(closed.start_ts).toBe(1700009000000);
  });

  it('always clears the task_events scope, even on incremental syncs', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetch(() => undefined),
    );
    const storage = makeStorage();
    await connector(['task_events']).sync(
      { mode: 'latest', since: new Date(Date.now() - 60_000).toISOString() },
      storage,
    );
    const cleared = storage.events.mock.calls.map(
      (c) => (c[1] as { names: string[] }).names[0],
    );
    expect(cleared).toContain('clickup_task_event');
  });

  it('clears entity scopes only at the start of a full sync', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetch(() => undefined),
    );

    const fullStorage = makeStorage();
    await connector(['spaces']).sync({ mode: 'full' }, fullStorage);
    const fullClears = fullStorage.entities.mock.calls
      .filter((c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0)
      .map((c) => (c[1] as { types: string[] }).types[0]);
    expect(fullClears).toContain('clickup_space');

    const latestStorage = makeStorage();
    await connector(['spaces']).sync(
      { mode: 'latest', since: new Date(Date.now() - 60_000).toISOString() },
      latestStorage,
    );
    const latestClears = latestStorage.entities.mock.calls.filter(
      (c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0,
    );
    expect(latestClears).toHaveLength(0);
  });

  it('passes options.since as date_updated_gt (ms) on the tasks phase only', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    const since = '2026-01-01T00:00:00.000Z';
    const sinceMs = Date.parse(since);
    await connector(['tasks', 'task_events']).sync(
      { mode: 'latest', since },
      makeStorage(),
    );

    const urls = recordCalls(fetchSpy).map((c) => c.url);
    const taskUrls = urls.filter((u) => u.includes('/task'));
    expect(taskUrls.some((u) => u.includes(`date_updated_gt=${sinceMs}`))).toBe(
      true,
    );
    expect(taskUrls.some((u) => !u.includes('date_updated_gt'))).toBe(true);
  });

  it('walks task pages until last_page is true', async () => {
    let calls = 0;
    const fetchSpy = vi.fn().mockImplementation((url: string | URL) => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.includes('/task')) {
        calls += 1;
        const last = calls >= 2;
        return Promise.resolve(
          jsonResponse({
            tasks: [
              { id: `task-${calls}`, name: `t${calls}`, list: { id: 'l' } },
            ],
            last_page: last,
          }),
        );
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['tasks']).sync({ mode: 'full' }, storage);

    expect(calls).toBe(2);
    expect(storage.entity.mock.calls).toHaveLength(2);
  });

  it('fetches lists from both folderless and folder endpoints', async () => {
    const fetchSpy = makeFetch((url) => {
      if (url.includes('/team/900/space')) {
        return { spaces: [{ id: 'space1', name: 'Space One' }] };
      }
      if (url.includes('/space/space1/folder')) {
        return { folders: [{ id: 'folder1', name: 'Folder One' }] };
      }
      if (url.includes('/space/space1/list')) {
        return { lists: [{ id: 'list-folderless', name: 'Backlog' }] };
      }
      if (url.includes('/folder/folder1/list')) {
        return { lists: [{ id: 'list-foldered', name: 'Sprint' }] };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['lists']).sync({ mode: 'full' }, storage);

    const lists = storage.entity.mock.calls.map(
      (c) => c[0] as { id: string; attributes: { folderId: string | null } },
    );
    const byId = new Map(lists.map((l) => [l.id, l]));
    expect(byId.get('list-folderless')!.attributes.folderId).toBeNull();
    expect(byId.get('list-foldered')!.attributes.folderId).toBe('folder1');
  });
});
