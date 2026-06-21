import { afterEach, describe, expect, it, vi } from 'vitest';

import { MondayConnector, configFields } from './monday';

describe('configFields', () => {
  it('parses a valid config with only apiToken', () => {
    const result = configFields.safeParse({
      apiToken: { $secret: 'MONDAY_API_TOKEN' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a config missing apiToken', () => {
    const result = configFields.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects an apiToken passed as a plain string', () => {
    const result = configFields.safeParse({ apiToken: 'plain_token' });
    expect(result.success).toBe(false);
  });

  it('accepts optional boardIds and resources', () => {
    const result = configFields.safeParse({
      apiToken: { $secret: 'MONDAY_API_TOKEN' },
      boardIds: ['123'],
      resources: ['items'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.boardIds).toEqual(['123']);
      expect(result.data.resources).toEqual(['items']);
    }
  });

  it('rejects empty boardIds array', () => {
    const result = configFields.safeParse({
      apiToken: { $secret: 'MONDAY_API_TOKEN' },
      boardIds: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown resource', () => {
    const result = configFields.safeParse({
      apiToken: { $secret: 'MONDAY_API_TOKEN' },
      resources: ['nope'],
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
  return query.match(/query\s+(\w+)/)?.[1] ?? '';
}

function emptyBoardsPage() {
  return { boards: [] };
}

describe('MondayConnector.sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns done:true when all phases return empty pages', async () => {
    const connector = new MondayConnector(
      {},
      { apiToken: 'tok' as unknown as { $secret: string } },
    );
    const { spy } = mockGraphql(() => emptyBoardsPage());
    vi.stubGlobal('fetch', spy);

    const result = await connector.sync({ mode: 'full' }, makeStorage());
    expect(result.done).toBe(true);
  });

  it('uses default page sizes for boards and items', async () => {
    const connector = new MondayConnector(
      {},
      { apiToken: 'tok' as unknown as { $secret: string } },
    );
    const { spy, calls } = mockGraphql((call) => {
      const op = operationName(call.query);
      if (op === 'Boards') {
        return emptyBoardsPage();
      }
      if (op === 'BoardItemsByPage' || op === 'BoardLogsByPage') {
        return emptyBoardsPage();
      }
      return emptyBoardsPage();
    });
    vi.stubGlobal('fetch', spy);

    await connector.sync({ mode: 'full' }, makeStorage());

    const boards = calls.find((c) => operationName(c.query) === 'Boards')!;
    expect(boards.variables.limit).toBe(50);
    const items = calls.find(
      (c) => operationName(c.query) === 'BoardItemsByPage',
    )!;
    expect(items.variables.itemLimit).toBe(100);
  });

  it('clears entity types and event names on full sync first page', async () => {
    const connector = new MondayConnector(
      {},
      { apiToken: 'tok' as unknown as { $secret: string } },
    );
    const { spy } = mockGraphql(() => emptyBoardsPage());
    vi.stubGlobal('fetch', spy);

    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const clearedTypes = storage.entities.mock.calls
      .filter((c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0)
      .map((c) => (c[1] as { types: string[] }).types[0]);
    expect(clearedTypes).toEqual(
      expect.arrayContaining(['monday_board', 'monday_item']),
    );

    const clearedEvents = storage.events.mock.calls
      .filter((c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0)
      .map((c) => (c[1] as { names: string[] }).names[0]);
    expect(clearedEvents).toContain('monday_item_activity');
  });

  it('does not clear storage in latest (incremental) mode', async () => {
    const connector = new MondayConnector(
      {},
      { apiToken: 'tok' as unknown as { $secret: string } },
    );
    const { spy } = mockGraphql(() => emptyBoardsPage());
    vi.stubGlobal('fetch', spy);

    const storage = makeStorage();
    await connector.sync(
      { mode: 'latest', since: new Date(Date.now() - 60_000).toISOString() },
      storage,
    );

    const entityClears = storage.entities.mock.calls.filter(
      (c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0,
    );
    expect(entityClears).toHaveLength(0);
  });

  it('writes board entities from the boards query response', async () => {
    const connector = new MondayConnector(
      { resources: ['boards'] },
      { apiToken: 'tok' as unknown as { $secret: string } },
    );
    const { spy } = mockGraphql((call) => {
      if (operationName(call.query) === 'Boards' && call.variables.page === 1) {
        return {
          boards: [
            {
              id: '101',
              name: 'Roadmap',
              state: 'active',
              board_kind: 'public',
              description: null,
              workspace_id: '5',
              items_count: 12,
              updated_at: '2024-06-01T00:00:00Z',
            },
          ],
        };
      }
      return emptyBoardsPage();
    });
    vi.stubGlobal('fetch', spy);

    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const boardWrites = storage.entity.mock.calls
      .map((c) => c[0] as { type: string; id: string })
      .filter((e) => e.type === 'monday_board');
    expect(boardWrites).toHaveLength(1);
    expect(boardWrites[0]!.id).toBe('101');
  });

  it('walks each board for items and paginates via next_items_page', async () => {
    const connector = new MondayConnector(
      { resources: ['items'] },
      { apiToken: 'tok' as unknown as { $secret: string } },
    );

    function item(itemId: string, boardId: string) {
      return {
        id: itemId,
        name: `Item ${itemId}`,
        state: 'active',
        created_at: '2024-05-01T00:00:00Z',
        updated_at: '2024-05-02T00:00:00Z',
        group: { id: 'g1', title: 'Group' },
        board: { id: boardId },
        column_values: [
          { id: 'status', text: 'Done', value: '{}', type: 'status' },
        ],
      };
    }

    const { spy } = mockGraphql((call) => {
      const op = operationName(call.query);
      if (op === 'BoardItemsByPage') {
        if (call.variables.page === 1) {
          return {
            boards: [
              {
                id: 'b1',
                items_page: { cursor: 'cur1', items: [item('i1', 'b1')] },
              },
            ],
          };
        }
        return emptyBoardsPage();
      }
      if (op === 'NextItems') {
        return {
          next_items_page: { cursor: null, items: [item('i2', 'b1')] },
        };
      }
      return emptyBoardsPage();
    });
    vi.stubGlobal('fetch', spy);

    const storage = makeStorage();
    const result = await connector.sync({ mode: 'full' }, storage);
    expect(result.done).toBe(true);

    const itemWrites = storage.entity.mock.calls
      .map((c) => c[0] as { type: string; id: string })
      .filter((e) => e.type === 'monday_item');
    expect(itemWrites.map((e) => e.id)).toEqual(['i1', 'i2']);
  });

  it('skips items with updated_at <= since in latest mode', async () => {
    const connector = new MondayConnector(
      { resources: ['items'] },
      { apiToken: 'tok' as unknown as { $secret: string } },
    );
    const since = '2024-05-10T00:00:00Z';

    const { spy } = mockGraphql((call) => {
      const op = operationName(call.query);
      if (op === 'BoardItemsByPage' && call.variables.page === 1) {
        return {
          boards: [
            {
              id: 'b1',
              items_page: {
                cursor: null,
                items: [
                  {
                    id: 'old',
                    name: 'Old',
                    state: 'active',
                    created_at: '2024-04-01T00:00:00Z',
                    updated_at: '2024-05-01T00:00:00Z',
                    group: null,
                    board: { id: 'b1' },
                    column_values: [],
                  },
                  {
                    id: 'new',
                    name: 'New',
                    state: 'active',
                    created_at: '2024-04-01T00:00:00Z',
                    updated_at: '2024-05-20T00:00:00Z',
                    group: null,
                    board: { id: 'b1' },
                    column_values: [],
                  },
                ],
              },
            },
          ],
        };
      }
      return emptyBoardsPage();
    });
    vi.stubGlobal('fetch', spy);

    const storage = makeStorage();
    await connector.sync({ mode: 'latest', since }, storage);

    const itemWrites = storage.entity.mock.calls
      .map((c) => c[0] as { type: string; id: string })
      .filter((e) => e.type === 'monday_item');
    expect(itemWrites.map((e) => e.id)).toEqual(['new']);
  });

  it('writes item activity events from board activity logs', async () => {
    const connector = new MondayConnector(
      { resources: ['item_events'] },
      { apiToken: 'tok' as unknown as { $secret: string } },
    );

    const { spy } = mockGraphql((call) => {
      const op = operationName(call.query);
      if (op === 'BoardLogsByPage' && call.variables.page === 1) {
        return {
          boards: [
            {
              id: 'b1',
              activity_logs: [
                {
                  id: 'log-1',
                  event: 'update_column_value',
                  entity: 'pulse',
                  data: '{"pulse_id":555}',
                  user_id: '7',
                  account_id: '9',
                  created_at: '1714521600000',
                },
              ],
            },
          ],
        };
      }
      return emptyBoardsPage();
    });
    vi.stubGlobal('fetch', spy);

    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const events = storage.event.mock.calls.map(
      (c) => c[0] as { name: string; attributes: Record<string, unknown> },
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.name).toBe('monday_item_activity');
    expect(events[0]!.attributes.boardId).toBe('b1');
    expect(events[0]!.attributes.itemId).toBe('555');
  });

  it('passes the from filter to activity logs in latest mode', async () => {
    const connector = new MondayConnector(
      { resources: ['item_events'] },
      { apiToken: 'tok' as unknown as { $secret: string } },
    );
    const since = '2024-05-01T00:00:00Z';
    const { spy, calls } = mockGraphql(() => emptyBoardsPage());
    vi.stubGlobal('fetch', spy);

    await connector.sync({ mode: 'latest', since }, makeStorage());

    const logsCall = calls.find(
      (c) => operationName(c.query) === 'BoardLogsByPage',
    )!;
    expect(logsCall.variables.from).toBe(since);
  });

  it('scopes to configured board ids', async () => {
    const connector = new MondayConnector(
      { resources: ['boards'], boardIds: ['42'] },
      { apiToken: 'tok' as unknown as { $secret: string } },
    );
    const { spy, calls } = mockGraphql(() => emptyBoardsPage());
    vi.stubGlobal('fetch', spy);

    await connector.sync({ mode: 'full' }, makeStorage());

    const boardsCall = calls.find(
      (c) => operationName(c.query) === 'BoardsByIds',
    )!;
    expect(boardsCall.variables.ids).toEqual(['42']);
  });

  it('only fetches phases listed in settings.resources', async () => {
    const connector = new MondayConnector(
      { resources: ['boards'] },
      { apiToken: 'tok' as unknown as { $secret: string } },
    );
    const { spy, calls } = mockGraphql(() => emptyBoardsPage());
    vi.stubGlobal('fetch', spy);

    await connector.sync({ mode: 'full' }, makeStorage());

    const ops = calls.map((c) => operationName(c.query));
    expect(ops).toContain('Boards');
    expect(ops).not.toContain('BoardItemsByPage');
    expect(ops).not.toContain('BoardLogsByPage');
  });

  it('passes the Authorization header on every request', async () => {
    const connector = new MondayConnector(
      {},
      { apiToken: 'secret-token' as unknown as { $secret: string } },
    );
    const { spy } = mockGraphql(() => emptyBoardsPage());
    vi.stubGlobal('fetch', spy);

    await connector.sync({ mode: 'full' }, makeStorage());

    expect(spy.mock.calls.length).toBeGreaterThan(0);
    const headers = spy.mock.calls[0]![1].headers as Record<string, string>;
    expect(headers.authorization).toBe('secret-token');
  });

  it('throws when the GraphQL response contains errors', async () => {
    const connector = new MondayConnector(
      { resources: ['boards'] },
      { apiToken: 'tok' as unknown as { $secret: string } },
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

describe('MondayConnector.create', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the connector instance directly', () => {
    vi.stubEnv('MONDAY_TEST_TOKEN', 'tok_fixture');
    const connector = MondayConnector.create({
      apiToken: { $secret: 'MONDAY_TEST_TOKEN' },
    });
    expect(connector).toBeInstanceOf(MondayConnector);
    expect(connector.id).toBe('monday');
  });
});
