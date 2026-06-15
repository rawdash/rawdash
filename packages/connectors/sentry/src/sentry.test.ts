import { afterEach, describe, expect, it, vi } from 'vitest';

import { SentryConnector, configFields } from './sentry';

describe('configFields', () => {
  it('parses a valid config with required fields only', () => {
    const result = configFields.safeParse({
      authToken: { $secret: 'SENTRY_AUTH_TOKEN' },
      organization: 'acme',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a config missing authToken', () => {
    const result = configFields.safeParse({ organization: 'acme' });
    expect(result.success).toBe(false);
  });

  it('rejects a config missing organization', () => {
    const result = configFields.safeParse({
      authToken: { $secret: 'SENTRY_AUTH_TOKEN' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an authToken passed as a plain string', () => {
    const result = configFields.safeParse({
      authToken: 'sntrys_plain',
      organization: 'acme',
    });
    expect(result.success).toBe(false);
  });

  it('accepts optional projects and resources', () => {
    const result = configFields.safeParse({
      authToken: { $secret: 'SENTRY_AUTH_TOKEN' },
      organization: 'acme',
      projects: ['web', 'api'],
      resources: ['issues', 'releases'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.projects).toEqual(['web', 'api']);
      expect(result.data.resources).toEqual(['issues', 'releases']);
    }
  });

  it('rejects empty projects array', () => {
    const result = configFields.safeParse({
      authToken: { $secret: 'SENTRY_AUTH_TOKEN' },
      organization: 'acme',
      projects: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects eventsPerIssueCap above 100', () => {
    const result = configFields.safeParse({
      authToken: { $secret: 'SENTRY_AUTH_TOKEN' },
      organization: 'acme',
      eventsPerIssueCap: 500,
    });
    expect(result.success).toBe(false);
  });

  it('accepts eventsPerIssueCap at the boundary of 100', () => {
    const result = configFields.safeParse({
      authToken: { $secret: 'SENTRY_AUTH_TOKEN' },
      organization: 'acme',
      eventsPerIssueCap: 100,
    });
    expect(result.success).toBe(true);
  });

  it('rejects statsLookbackHours above 168', () => {
    const result = configFields.safeParse({
      authToken: { $secret: 'SENTRY_AUTH_TOKEN' },
      organization: 'acme',
      statsLookbackHours: 200,
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
    organization: string;
    projects: readonly string[];
    resources: readonly (
      | 'issues'
      | 'issue_events'
      | 'releases'
      | 'errors_per_hour'
    )[];
    eventsPerIssueCap: number;
    statsLookbackHours: number;
  }> = {},
): SentryConnector {
  return new SentryConnector(
    { organization: 'acme', ...overrides },
    { authToken: 'sntrys_test' as unknown as { $secret: string } },
  );
}

describe('SentryConnector.sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns done:true when every endpoint returns empty', async () => {
    installRouter((u) => {
      if (u.includes('/stats_v2/')) {
        return { body: { intervals: [], groups: [] } };
      }
      return { body: [] };
    });
    const result = await makeConnector().sync({ mode: 'full' }, makeStorage());
    expect(result.done).toBe(true);
  });

  it('clears entity types and event names on full sync first page', async () => {
    installRouter((u) => {
      if (u.includes('/stats_v2/')) {
        return { body: { intervals: [], groups: [] } };
      }
      return { body: [] };
    });
    const storage = makeStorage();
    await makeConnector().sync({ mode: 'full' }, storage);

    const clearedTypes = storage.entities.mock.calls
      .filter((c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0)
      .map((c) => (c[1] as { types: string[] }).types[0]);
    expect(clearedTypes).toEqual(
      expect.arrayContaining(['sentry_issue', 'sentry_release']),
    );

    const clearedEvents = storage.events.mock.calls
      .filter((c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0)
      .map((c) => (c[1] as { names: string[] }).names[0]);
    expect(clearedEvents).toContain('sentry_issue_event');
  });

  it('does not clear storage in latest (incremental) mode', async () => {
    installRouter((u) => {
      if (u.includes('/stats_v2/')) {
        return { body: { intervals: [], groups: [] } };
      }
      return { body: [] };
    });
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

  it('writes issue entities and per-issue events', async () => {
    const connector = makeConnector({
      resources: ['issues', 'issue_events'],
      eventsPerIssueCap: 2,
    });
    const issue = {
      id: 'i-1',
      shortId: 'ACME-1',
      title: 'Boom',
      level: 'error',
      status: 'unresolved',
      firstSeen: '2024-05-01T00:00:00.000Z',
      lastSeen: '2024-05-02T00:00:00.000Z',
      count: '42',
      userCount: 10,
      project: { slug: 'web' },
    };
    installRouter((u) => {
      if (u.includes('/issues/i-1/events/')) {
        return {
          body: [
            {
              eventID: 'ev-1',
              dateCreated: '2024-05-02T01:00:00.000Z',
              platform: 'javascript',
              environment: 'production',
              message: 'TypeError',
            },
          ],
        };
      }
      if (u.includes('/issues/')) {
        return { body: [issue] };
      }
      return { body: { intervals: [], groups: [] } };
    });
    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const issueWrites = storage.entity.mock.calls
      .map((c) => c[0] as { type: string; id: string })
      .filter((e) => e.type === 'sentry_issue');
    expect(issueWrites).toHaveLength(1);
    expect(issueWrites[0]!.id).toBe('i-1');

    const eventWrites = storage.event.mock.calls
      .map((c) => c[0] as { name: string; attributes: Record<string, unknown> })
      .filter((e) => e.name === 'sentry_issue_event');
    expect(eventWrites).toHaveLength(1);
    expect(eventWrites[0]!.attributes.eventId).toBe('ev-1');
    expect(eventWrites[0]!.attributes.issueId).toBe('i-1');
  });

  it('coerces issue.count from string to number', async () => {
    const connector = makeConnector({ resources: ['issues'] });
    installRouter((u) => {
      if (u.includes('/issues/')) {
        return {
          body: [
            {
              id: 'i-1',
              shortId: 'ACME-1',
              title: 't',
              level: 'error',
              status: 'unresolved',
              firstSeen: '2024-05-01T00:00:00.000Z',
              lastSeen: '2024-05-02T00:00:00.000Z',
              count: '123',
              userCount: 4,
              project: { slug: 'web' },
            },
          ],
        };
      }
      return { body: [] };
    });
    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const entity = storage.entity.mock.calls
      .map((c) => c[0] as { type: string; attributes: Record<string, unknown> })
      .find((e) => e.type === 'sentry_issue');
    expect(entity).toBeDefined();
    expect(entity!.attributes.count).toBe(123);
  });

  it('skips events that lack both id and eventID', async () => {
    const connector = makeConnector({ resources: ['issues', 'issue_events'] });
    installRouter((u) => {
      if (u.includes('/issues/i-1/events/')) {
        return {
          body: [
            { dateCreated: '2024-05-02T01:00:00.000Z' },
            {
              id: 'ev-2',
              dateCreated: '2024-05-02T02:00:00.000Z',
            },
          ],
        };
      }
      if (u.includes('/issues/')) {
        return {
          body: [
            {
              id: 'i-1',
              shortId: 'ACME-1',
              title: 't',
              level: 'error',
              status: 'unresolved',
              firstSeen: '2024-05-01T00:00:00.000Z',
              lastSeen: '2024-05-02T00:00:00.000Z',
              count: 1,
              userCount: 1,
              project: { slug: 'web' },
            },
          ],
        };
      }
      return { body: [] };
    });
    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const eventWrites = storage.event.mock.calls
      .map((c) => c[0] as { name: string; attributes: Record<string, unknown> })
      .filter((e) => e.name === 'sentry_issue_event');
    expect(eventWrites).toHaveLength(1);
    expect(eventWrites[0]!.attributes.eventId).toBe('ev-2');
  });

  it('skips issues with unparseable firstSeen/lastSeen instead of persisting NaN', async () => {
    const connector = makeConnector({ resources: ['issues'] });
    installRouter((u) => {
      if (u.includes('/issues/')) {
        return {
          body: [
            {
              id: 'i-bad-first',
              shortId: 'ACME-BAD-FIRST',
              title: 't',
              level: 'error',
              status: 'unresolved',
              firstSeen: 'not-a-date',
              lastSeen: '2024-05-02T00:00:00.000Z',
              count: 1,
              userCount: 1,
              project: { slug: 'web' },
            },
            {
              id: 'i-bad-last',
              shortId: 'ACME-BAD-LAST',
              title: 't',
              level: 'error',
              status: 'unresolved',
              firstSeen: '2024-05-01T00:00:00.000Z',
              lastSeen: 'not-a-date',
              count: 1,
              userCount: 1,
              project: { slug: 'web' },
            },
            {
              id: 'i-ok',
              shortId: 'ACME-OK',
              title: 't',
              level: 'error',
              status: 'unresolved',
              firstSeen: '2024-05-01T00:00:00.000Z',
              lastSeen: '2024-05-02T00:00:00.000Z',
              count: 1,
              userCount: 1,
              project: { slug: 'web' },
            },
          ],
        };
      }
      return { body: [] };
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const storage = makeStorage();
      await connector.sync({ mode: 'full' }, storage);

      const written = storage.entity.mock.calls
        .map((c) => c[0] as { type: string; id: string })
        .filter((e) => e.type === 'sentry_issue')
        .map((e) => e.id);
      expect(written).toEqual(['i-ok']);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('skips releases without a parseable dateCreated', async () => {
    const connector = makeConnector({ resources: ['releases'] });
    installRouter((u) => {
      if (u.includes('/releases/')) {
        return {
          body: [
            {
              version: 'bad',
              dateCreated: 'not-a-date',
              dateReleased: null,
              lastEvent: null,
              projects: [{ slug: 'web' }],
            },
            {
              version: 'good',
              dateCreated: '2024-05-01T00:00:00.000Z',
              dateReleased: null,
              lastEvent: null,
              projects: [{ slug: 'web' }],
            },
          ],
        };
      }
      return { body: [] };
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const storage = makeStorage();
      await connector.sync({ mode: 'full' }, storage);

      const written = storage.entity.mock.calls
        .map((c) => c[0] as { type: string; id: string })
        .filter((e) => e.type === 'sentry_release')
        .map((e) => e.id);
      expect(written).toEqual(['good']);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('writes release entities', async () => {
    const connector = makeConnector({ resources: ['releases'] });
    installRouter((u) => {
      if (u.includes('/releases/')) {
        return {
          body: [
            {
              version: '1.2.3',
              dateCreated: '2024-05-01T00:00:00.000Z',
              dateReleased: '2024-05-02T00:00:00.000Z',
              lastEvent: '2024-05-03T00:00:00.000Z',
              projects: [{ slug: 'web' }, { slug: 'api' }],
            },
          ],
        };
      }
      return { body: [] };
    });
    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const releases = storage.entity.mock.calls
      .map(
        (c) =>
          c[0] as {
            type: string;
            id: string;
            attributes: Record<string, unknown>;
          },
      )
      .filter((e) => e.type === 'sentry_release');
    expect(releases).toHaveLength(1);
    expect(releases[0]!.id).toBe('1.2.3');
    expect(releases[0]!.attributes.projects).toEqual(['web', 'api']);
  });

  it('keys the incremental release window on dateCreated, not dateReleased', async () => {
    const connector = makeConnector({ resources: ['releases'] });
    const since = '2024-05-10T00:00:00.000Z';
    installRouter((u) => {
      if (u.includes('/releases/') && !u.includes('cursor=page2')) {
        return {
          body: [
            {
              version: 'r-in-window-released-long-ago',
              dateCreated: '2024-05-12T00:00:00.000Z',
              dateReleased: '2024-01-01T00:00:00.000Z',
              lastEvent: '2024-01-02T00:00:00.000Z',
              projects: [{ slug: 'web' }],
            },
          ],
          headers: {
            link: '<https://sentry.io/api/0/organizations/acme/releases/?cursor=page2>; rel="next"; results="true"; cursor="page2"',
          },
        };
      }
      if (u.includes('cursor=page2')) {
        return {
          body: [
            {
              version: 'r-on-next-page',
              dateCreated: '2024-05-11T00:00:00.000Z',
              dateReleased: null,
              lastEvent: null,
              projects: [{ slug: 'web' }],
            },
          ],
        };
      }
      return { body: [] };
    });
    const storage = makeStorage();
    await connector.sync({ mode: 'latest', since }, storage);

    const written = storage.entity.mock.calls
      .map((c) => c[0] as { type: string; id: string })
      .filter((e) => e.type === 'sentry_release')
      .map((e) => e.id);
    expect(written).toEqual([
      'r-in-window-released-long-ago',
      'r-on-next-page',
    ]);
  });

  it('requests stats_v2 only for accepted error outcomes', async () => {
    const connector = makeConnector({ resources: ['errors_per_hour'] });
    const { calls } = installRouter((u) => {
      if (u.includes('/stats_v2/')) {
        return { body: { intervals: [], groups: [] } };
      }
      return { body: [] };
    });
    await connector.sync({ mode: 'full' }, makeStorage());

    const statsCall = calls.find((c) => c.includes('/stats_v2/'));
    expect(statsCall).toBeDefined();
    expect(new URL(statsCall!).searchParams.get('outcome')).toBe('accepted');
  });

  it('does not send groupBy=project on the stats_v2 query', async () => {
    const connector = makeConnector({ resources: ['errors_per_hour'] });
    const { calls } = installRouter((u) => {
      if (u.includes('/stats_v2/')) {
        return { body: { intervals: [], groups: [] } };
      }
      return { body: [] };
    });
    await connector.sync({ mode: 'full' }, makeStorage());

    const statsCall = calls.find((c) => c.includes('/stats_v2/'));
    expect(statsCall).toBeDefined();
    const params = new URL(statsCall!).searchParams;
    expect(params.getAll('groupBy')).toEqual([]);
    expect(params.get('interval')).toBe('1h');
  });

  it('writes org-wide hourly error metrics from an ungrouped stats_v2 response', async () => {
    const connector = makeConnector({ resources: ['errors_per_hour'] });
    installRouter((u) => {
      if (u.includes('/stats_v2/')) {
        return {
          body: {
            intervals: [
              '2024-05-01T00:00:00.000Z',
              '2024-05-01T01:00:00.000Z',
              '2024-05-01T02:00:00.000Z',
            ],
            groups: [
              {
                by: {},
                series: { 'sum(quantity)': [10, 0, 5] },
              },
            ],
          },
        };
      }
      return { body: [] };
    });
    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    expect(storage.metrics).toHaveBeenCalledTimes(1);
    const [samples, scope] = storage.metrics.mock.calls[0]!;
    expect(scope).toEqual({ names: ['sentry_errors_per_hour'] });
    const typed = samples as Array<{
      name: string;
      ts: number;
      value: number;
    }>;
    expect(typed).toHaveLength(3);
    expect(typed.every((s) => s.name === 'sentry_errors_per_hour')).toBe(true);
    expect(typed.map((s) => s.value)).toEqual([10, 0, 5]);
    expect(typed.map((s) => s.ts)).toEqual([
      Date.parse('2024-05-01T00:00:00.000Z'),
      Date.parse('2024-05-01T01:00:00.000Z'),
      Date.parse('2024-05-01T02:00:00.000Z'),
    ]);
  });

  it('sums series across groups when stats_v2 still returns multiple groups', async () => {
    const connector = makeConnector({ resources: ['errors_per_hour'] });
    installRouter((u) => {
      if (u.includes('/stats_v2/')) {
        return {
          body: {
            intervals: [
              '2024-05-01T00:00:00.000Z',
              '2024-05-01T01:00:00.000Z',
              '2024-05-01T02:00:00.000Z',
            ],
            groups: [
              {
                by: { project: 'web' },
                series: { 'sum(quantity)': [10, 0, 5] },
              },
              {
                by: { project: 'api' },
                series: { 'sum(quantity)': [2, 3, 4] },
              },
            ],
          },
        };
      }
      return { body: [] };
    });
    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const [samples] = storage.metrics.mock.calls[0]!;
    const typed = samples as Array<{ value: number }>;
    expect(typed).toHaveLength(3);
    expect(typed.map((s) => s.value)).toEqual([12, 3, 9]);
  });

  it('emits explicit zeros for an interval with no series value (genuine 0-error windows)', async () => {
    const connector = makeConnector({ resources: ['errors_per_hour'] });
    installRouter((u) => {
      if (u.includes('/stats_v2/')) {
        return {
          body: {
            intervals: ['2024-05-01T00:00:00.000Z', '2024-05-01T01:00:00.000Z'],
            groups: [{ by: {}, series: { 'sum(quantity)': [0, 0] } }],
          },
        };
      }
      return { body: [] };
    });
    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    expect(storage.metrics).toHaveBeenCalledTimes(1);
    const [samples] = storage.metrics.mock.calls[0]!;
    const typed = samples as Array<{ value: number }>;
    expect(typed).toHaveLength(2);
    expect(typed.every((s) => s.value === 0)).toBe(true);
  });

  it('emits zeros across intervals when a group carries no series at all', async () => {
    const connector = makeConnector({ resources: ['errors_per_hour'] });
    installRouter((u) => {
      if (u.includes('/stats_v2/')) {
        return {
          body: {
            intervals: ['2024-05-01T00:00:00.000Z', '2024-05-01T01:00:00.000Z'],
            groups: [{ by: {} }],
          },
        };
      }
      return { body: [] };
    });
    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    const [samples] = storage.metrics.mock.calls[0]!;
    const typed = samples as Array<{ value: number }>;
    expect(typed).toHaveLength(2);
    expect(typed.every((s) => s.value === 0)).toBe(true);
  });

  it('emits samples when intervals is absent but series data is present', async () => {
    const connector = makeConnector({ resources: ['errors_per_hour'] });
    installRouter((u) => {
      if (u.includes('/stats_v2/')) {
        return {
          body: {
            start: '2024-05-01T00:00:00.000Z',
            end: '2024-05-01T03:00:00.000Z',
            groups: [
              {
                by: {},
                series: { 'sum(quantity)': [10, 20, 30] },
              },
            ],
          },
        };
      }
      return { body: [] };
    });
    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    expect(storage.metrics).toHaveBeenCalledTimes(1);
    const [samples] = storage.metrics.mock.calls[0]!;
    const typed = samples as Array<{
      name: string;
      ts: number;
      value: number;
    }>;
    expect(typed).toHaveLength(3);
    expect(typed.map((s) => s.value)).toEqual([10, 20, 30]);
    expect(typed.every((s) => s.name === 'sentry_errors_per_hour')).toBe(true);
    expect(typed[0]!.ts).toBe(Date.parse('2024-05-01T00:00:00.000Z'));
    expect(typed[1]!.ts).toBe(Date.parse('2024-05-01T01:00:00.000Z'));
  });

  it('emits explicit zeros when intervals absent and series is all zeros', async () => {
    const connector = makeConnector({ resources: ['errors_per_hour'] });
    installRouter((u) => {
      if (u.includes('/stats_v2/')) {
        return {
          body: {
            start: '2024-05-01T00:00:00.000Z',
            end: '2024-05-01T02:00:00.000Z',
            groups: [
              {
                by: {},
                series: { 'sum(quantity)': [0, 0] },
              },
            ],
          },
        };
      }
      return { body: [] };
    });
    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    expect(storage.metrics).toHaveBeenCalledTimes(1);
    const [samples] = storage.metrics.mock.calls[0]!;
    const typed = samples as Array<{ value: number }>;
    expect(typed).toHaveLength(2);
    expect(typed.every((s) => s.value === 0)).toBe(true);
  });

  it('emits nothing when a grouped response carries totals only (no series, no intervals)', async () => {
    const connector = makeConnector({ resources: ['errors_per_hour'] });
    installRouter((u) => {
      if (u.includes('/stats_v2/')) {
        return {
          body: {
            groups: [
              { by: { project: 'web' }, totals: { 'sum(quantity)': 1234 } },
              { by: { project: 'api' }, totals: { 'sum(quantity)': 56 } },
            ],
          },
        };
      }
      return { body: [] };
    });
    const storage = makeStorage();
    await connector.sync({ mode: 'full' }, storage);

    expect(storage.metrics).toHaveBeenCalledTimes(1);
    const [samples] = storage.metrics.mock.calls[0]!;
    expect(samples as unknown[]).toHaveLength(0);
  });

  it('requests stats_v2 across all projects (project=-1) when none are configured', async () => {
    const connector = makeConnector({ resources: ['errors_per_hour'] });
    const { calls } = installRouter((u) => {
      if (u.includes('/stats_v2/')) {
        return { body: { intervals: [], groups: [] } };
      }
      return { body: [] };
    });
    await connector.sync({ mode: 'full' }, makeStorage());

    const statsCall = calls.find((c) => c.includes('/stats_v2/'));
    expect(statsCall).toBeDefined();
    expect(new URL(statsCall!).searchParams.getAll('project')).toEqual(['-1']);
  });

  it('scopes stats_v2 to configured projects instead of project=-1', async () => {
    const connector = makeConnector({
      resources: ['errors_per_hour'],
      projects: ['web', 'api'],
    });
    const { calls } = installRouter((u) => {
      if (u.includes('/stats_v2/')) {
        return { body: { intervals: [], groups: [] } };
      }
      return { body: [] };
    });
    await connector.sync({ mode: 'full' }, makeStorage());

    const statsCall = calls.find((c) => c.includes('/stats_v2/'));
    expect(statsCall).toBeDefined();
    expect(new URL(statsCall!).searchParams.getAll('project')).toEqual([
      'web',
      'api',
    ]);
  });

  it('applies lastSeen filter in latest mode for issues', async () => {
    const connector = makeConnector({ resources: ['issues'] });
    const { calls } = installRouter(() => ({ body: [] }));
    const since = '2024-05-01T00:00:00.000Z';
    await connector.sync({ mode: 'latest', since }, makeStorage());

    const issuesCall = calls.find((c) =>
      c.includes('/organizations/acme/issues/'),
    );
    expect(issuesCall).toBeDefined();
    expect(decodeURIComponent(issuesCall!)).toContain(
      `query=lastSeen:>${since}`,
    );
  });

  it('passes Authorization header on every request', async () => {
    const connector = new SentryConnector(
      { organization: 'acme', resources: ['issues'] },
      { authToken: 'sntrys_secret' as unknown as { $secret: string } },
    );
    const { spy } = installRouter(() => ({ body: [] }));
    await connector.sync({ mode: 'full' }, makeStorage());

    expect(spy.mock.calls.length).toBeGreaterThan(0);
    for (const call of spy.mock.calls) {
      const headers = call[1].headers as Record<string, string>;
      expect(headers.authorization).toBe('Bearer sntrys_secret');
    }
  });

  it('adds project query params when projects are configured', async () => {
    const connector = makeConnector({
      resources: ['issues'],
      projects: ['web', 'api'],
    });
    const { calls } = installRouter(() => ({ body: [] }));
    await connector.sync({ mode: 'full' }, makeStorage());

    const issuesCall = calls.find((c) =>
      c.includes('/organizations/acme/issues/'),
    );
    expect(issuesCall).toBeDefined();
    const params = new URL(issuesCall!).searchParams.getAll('project');
    expect(params).toEqual(['web', 'api']);
  });

  it('only fetches phases enabled in settings.resources', async () => {
    const connector = makeConnector({ resources: ['releases'] });
    const { calls } = installRouter(() => ({ body: [] }));
    await connector.sync({ mode: 'full' }, makeStorage());

    const paths = calls.map((c) => new URL(c).pathname);
    expect(paths.some((p) => p.endsWith('/releases/'))).toBe(true);
    expect(paths.some((p) => p.endsWith('/issues/'))).toBe(false);
    expect(paths.some((p) => p.includes('/stats_v2/'))).toBe(false);
  });

  it('follows the Link "next" header when results="true"', async () => {
    const connector = makeConnector({ resources: ['issues'] });
    let firstCall = true;
    installRouter((u) => {
      if (u.includes('/organizations/acme/issues/')) {
        if (firstCall) {
          firstCall = false;
          return {
            body: [
              {
                id: 'i-1',
                shortId: 'ACME-1',
                title: 't',
                level: 'error',
                status: 'unresolved',
                firstSeen: '2024-05-01T00:00:00.000Z',
                lastSeen: '2024-05-02T00:00:00.000Z',
                count: 1,
                userCount: 1,
                project: { slug: 'web' },
              },
            ],
            headers: {
              link: '<https://sentry.io/api/0/organizations/acme/issues/?cursor=abc>; rel="next"; results="true"; cursor="abc"',
            },
          };
        }
        return { body: [] };
      }
      return { body: [] };
    });
    const storage = makeStorage();
    const result = await connector.sync({ mode: 'full' }, storage);
    expect(result.done).toBe(true);
    expect(firstCall).toBe(false);
  });

  it('stops paginating when Link rel="next" has results="false"', async () => {
    const connector = makeConnector({ resources: ['issues'] });
    const { calls } = installRouter(() => ({
      body: [],
      headers: {
        link: '<https://sentry.io/api/0/organizations/acme/issues/?cursor=xyz>; rel="next"; results="false"; cursor="xyz"',
      },
    }));
    await connector.sync({ mode: 'full' }, makeStorage());
    const issuesCalls = calls.filter((c) =>
      c.includes('/organizations/acme/issues/'),
    );
    expect(issuesCalls).toHaveLength(1);
  });

  it('rejects malicious pagination URLs from a saved cursor', async () => {
    const connector = makeConnector({ resources: ['issues'] });
    const { calls } = installRouter(() => ({ body: [] }));

    await connector.sync(
      {
        mode: 'full',
        cursor: { phase: 'issues', page: 'https://evil.example.com/exfil' },
      },
      makeStorage(),
    );

    expect(calls.some((c) => c.includes('evil.example.com'))).toBe(false);
    expect(calls.some((c) => c.includes('sentry.io'))).toBe(true);
  });

  it('resumes from a saved cursor at the right phase', async () => {
    const connector = makeConnector();
    const { calls } = installRouter((u) => {
      if (u.includes('/stats_v2/')) {
        return { body: { intervals: [], groups: [] } };
      }
      return { body: [] };
    });

    await connector.sync(
      { mode: 'full', cursor: { phase: 'releases', page: null } },
      makeStorage(),
    );

    expect(calls.some((c) => c.includes('/issues/'))).toBe(false);
    expect(calls.some((c) => c.includes('/releases/'))).toBe(true);
    expect(calls.some((c) => c.includes('/stats_v2/'))).toBe(true);
  });
});

describe('SentryConnector filter pushdown', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function issuesQuery(calls: string[]): string | null {
    const issuesCall = calls.find((u) =>
      u.includes('/organizations/acme/issues/'),
    );
    expect(issuesCall).toBeDefined();
    return new URL(issuesCall!).searchParams.get('query');
  }

  it('pushes a declared status filter to the issues query', async () => {
    const { calls } = installRouter(() => ({ body: [] }));
    await makeConnector({ resources: ['issues'] }).sync(
      {
        mode: 'full',
        fetchSpecs: {
          sentry_issue: [
            { filter: [{ field: 'status', op: 'eq', value: 'unresolved' }] },
          ],
        },
      },
      makeStorage(),
    );
    expect(issuesQuery(calls)).toContain('is:unresolved');
  });

  it('pushes a declared level filter to the issues query', async () => {
    const { calls } = installRouter(() => ({ body: [] }));
    await makeConnector({ resources: ['issues'] }).sync(
      {
        mode: 'full',
        fetchSpecs: {
          sentry_issue: [
            { filter: [{ field: 'level', op: 'eq', value: 'error' }] },
          ],
        },
      },
      makeStorage(),
    );
    expect(issuesQuery(calls)).toContain('level:error');
  });

  it('does not push a filter when multiple specs target the resource', async () => {
    const { calls } = installRouter(() => ({ body: [] }));
    await makeConnector({ resources: ['issues'] }).sync(
      {
        mode: 'full',
        fetchSpecs: {
          sentry_issue: [
            { filter: [{ field: 'status', op: 'eq', value: 'unresolved' }] },
            { filter: [{ field: 'status', op: 'eq', value: 'resolved' }] },
          ],
        },
      },
      makeStorage(),
    );
    const query = issuesQuery(calls);
    expect(query == null || !query.includes('is:')).toBe(true);
  });
});

describe('SentryConnector.create', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns a connector instance bound to the parsed config', () => {
    vi.stubEnv('SENTRY_TEST_KEY', 'sntrys_fixture');
    const connector = SentryConnector.create({
      authToken: { $secret: 'SENTRY_TEST_KEY' },
      organization: 'acme',
    });
    expect(connector).toBeInstanceOf(SentryConnector);
    expect(connector.id).toBe('sentry');
  });
});
