import { afterEach, describe, expect, it, vi } from 'vitest';

import { StatusGatorConnector, configFields } from './statusgator';

describe('configFields', () => {
  it('parses a valid config with required fields only', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'STATUSGATOR_API_KEY' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a config missing apiKey', () => {
    const result = configFields.safeParse({ boardId: '123' });
    expect(result.success).toBe(false);
  });

  it('rejects an apiKey passed as a plain string', () => {
    const result = configFields.safeParse({ apiKey: 'plain-key' });
    expect(result.success).toBe(false);
  });

  it('accepts optional boardId, services, historyLookbackDays, resources', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'STATUSGATOR_API_KEY' },
      boardId: '123',
      services: ['GitHub', 'Stripe'],
      historyLookbackDays: 30,
      resources: ['services', 'status_changes'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty services array', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'STATUSGATOR_API_KEY' },
      services: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty resources array', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'STATUSGATOR_API_KEY' },
      resources: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects historyLookbackDays above 365', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'STATUSGATOR_API_KEY' },
      historyLookbackDays: 500,
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
    boardId: string;
    services: readonly string[];
    historyLookbackDays: number;
    resources: readonly ('services' | 'status_changes')[];
  }> = {},
): StatusGatorConnector {
  return new StatusGatorConnector(
    {
      boardId: overrides.boardId ?? 'board-1',
      services: overrides.services,
      historyLookbackDays: overrides.historyLookbackDays,
      resources: overrides.resources,
    },
    { apiKey: 'api-test' as unknown as { $secret: string } },
  );
}

function emptyMonitorsBody() {
  return { body: { success: true, data: [], pagination: { next_page: null } } };
}

function emptyHistoryBody() {
  return { body: { success: true, data: [] } };
}

function routeDefault(url: string): MockResponseSpec {
  if (url.includes('/monitors')) {
    return emptyMonitorsBody();
  }
  if (url.includes('/history')) {
    return emptyHistoryBody();
  }
  if (url.includes('/boards')) {
    return {
      body: {
        success: true,
        data: [{ id: 'board-1', name: 'Main' }],
        pagination: { next_page: null },
      },
    };
  }
  throw new Error(`Unexpected request URL in test router: ${url}`);
}

describe('StatusGatorConnector.sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns done:true when every endpoint returns empty', async () => {
    installRouter(routeDefault);
    const result = await makeConnector().sync({ mode: 'full' }, makeStorage());
    expect(result.done).toBe(true);
  });

  it('targets the configured board', async () => {
    const { calls } = installRouter(routeDefault);
    await makeConnector({ boardId: 'board-42' }).sync(
      { mode: 'full' },
      makeStorage(),
    );
    expect(calls.some((u) => u.includes('/boards/board-42/monitors'))).toBe(
      true,
    );
    expect(calls.every((u) => !u.includes('/boards/board-1'))).toBe(true);
  });

  it('clears entity types and event names on full sync first page', async () => {
    installRouter(routeDefault);
    const storage = makeStorage();
    await makeConnector().sync({ mode: 'full' }, storage);

    const clearedTypes = storage.entities.mock.calls
      .filter((c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0)
      .map((c) => (c[1] as { types: string[] }).types[0]);
    expect(clearedTypes).toContain('statusgator_service');

    const clearedEvents = storage.events.mock.calls
      .filter((c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0)
      .map((c) => (c[1] as { names: string[] }).names[0]);
    expect(clearedEvents).toContain('statusgator_status_change');
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

  it('writes service entities from monitors', async () => {
    const connector = makeConnector({ resources: ['services'] });
    const checkedAt = new Date(Date.now() - 60_000).toISOString();
    installRouter((u) => {
      if (u.includes('/monitors')) {
        return {
          body: {
            success: true,
            data: [
              {
                id: 'm1',
                display_name: 'GitHub',
                filtered_status: 'up',
                service: {
                  id: 's1',
                  name: 'GitHub',
                  slug: 'github',
                  home_page_url: 'https://github.com',
                  status_page_url: 'https://www.githubstatus.com',
                },
                checked_at: checkedAt,
              },
              {
                id: 'm2',
                display_name: 'Stripe',
                filtered_status: 'down',
              },
            ],
            pagination: { next_page: null },
          },
        };
      }
      return routeDefault(u);
    });
    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const services = storage.entity.mock.calls
      .map(
        (c) =>
          c[0] as {
            type: string;
            id: string;
            attributes: Record<string, unknown>;
          },
      )
      .filter((e) => e.type === 'statusgator_service');
    expect(services.map((s) => s.id)).toEqual(['m1', 'm2']);
    expect(services[0]!.attributes.currentStatus).toBe('up');
    expect(services[0]!.attributes.serviceSlug).toBe('github');
    expect(services[0]!.attributes.statusPageUrl).toBe(
      'https://www.githubstatus.com',
    );
    expect(services[0]!.attributes.boardId).toBe('board-1');
    expect(services[1]!.attributes.currentStatus).toBe('down');
    expect(services[1]!.attributes.serviceSlug).toBeNull();
  });

  it('derives from/to transitions from board history in chronological order', async () => {
    const connector = makeConnector({ resources: ['status_changes'] });
    const t1 = new Date(Date.now() - 3 * 60_000).toISOString();
    const t2 = new Date(Date.now() - 2 * 60_000).toISOString();
    const t3 = new Date(Date.now() - 1 * 60_000).toISOString();
    installRouter((u) => {
      if (u.includes('/history')) {
        return {
          body: {
            success: true,
            data: [
              {
                monitor_id: 'm1',
                name: 'GitHub',
                status: 'up',
                started_at: t3,
              },
              {
                monitor_id: 'm1',
                name: 'GitHub',
                status: 'down',
                started_at: t2,
              },
              {
                monitor_id: 'm1',
                name: 'GitHub',
                status: 'warn',
                started_at: t1,
              },
            ],
          },
        };
      }
      return routeDefault(u);
    });
    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const changes = storage.event.mock.calls
      .map(
        (c) =>
          c[0] as {
            name: string;
            start_ts: number;
            attributes: Record<string, unknown>;
          },
      )
      .filter((e) => e.name === 'statusgator_status_change')
      .sort((a, b) => a.start_ts - b.start_ts);
    expect(changes).toHaveLength(3);
    expect(changes.map((c) => c.attributes.to)).toEqual(['warn', 'down', 'up']);
    expect(changes.map((c) => c.attributes.from)).toEqual([
      null,
      'warn',
      'down',
    ]);
    expect(changes[0]!.attributes.serviceId).toBe('m1');
  });

  it('applies the services allow-list to monitors', async () => {
    const connector = makeConnector({
      resources: ['services'],
      services: ['stripe'],
    });
    installRouter((u) => {
      if (u.includes('/monitors')) {
        return {
          body: {
            success: true,
            data: [
              { id: 'm1', display_name: 'GitHub', filtered_status: 'up' },
              {
                id: 'm2',
                display_name: 'Stripe',
                filtered_status: 'up',
                service: { id: 's2', name: 'Stripe', slug: 'stripe' },
              },
            ],
            pagination: { next_page: null },
          },
        };
      }
      return routeDefault(u);
    });
    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const ids = storage.entity.mock.calls
      .map((c) => c[0] as { type: string; id: string })
      .filter((e) => e.type === 'statusgator_service')
      .map((e) => e.id);
    expect(ids).toEqual(['m2']);
  });

  it('discovers all boards when no boardId is configured', async () => {
    const connector = new StatusGatorConnector(
      { resources: ['services'] },
      { apiKey: 'api-test' as unknown as { $secret: string } },
    );
    const { calls } = installRouter((u) => {
      if (u.endsWith('/boards') || u.includes('/boards?')) {
        return {
          body: {
            success: true,
            data: [
              { id: 'b1', name: 'Prod' },
              { id: 'b2', name: 'Staging' },
            ],
            pagination: { next_page: null },
          },
        };
      }
      if (u.includes('/monitors')) {
        return emptyMonitorsBody();
      }
      return routeDefault(u);
    });
    await connector.sync({ mode: 'full' }, makeStorage());

    expect(calls.some((u) => u.includes('/boards/b1/monitors'))).toBe(true);
    expect(calls.some((u) => u.includes('/boards/b2/monitors'))).toBe(true);
  });
});
