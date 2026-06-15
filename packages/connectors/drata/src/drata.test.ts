import { afterEach, describe, expect, it, vi } from 'vitest';

import { DrataConnector, configFields } from './drata';

describe('configFields', () => {
  it('parses a valid config', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'DRATA_API_KEY' },
    });
    expect(result.success).toBe(true);
  });

  it('parses a config with resources and findings lookback', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'DRATA_API_KEY' },
      resources: ['controls', 'findings'],
      findingsLookbackDays: 30,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a plain-string apiKey', () => {
    const result = configFields.safeParse({
      apiKey: 'plain',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown resource name', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'DRATA_API_KEY' },
      resources: ['controls', 'evidence'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty resources array', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'DRATA_API_KEY' },
      resources: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-positive findingsLookbackDays', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'DRATA_API_KEY' },
      findingsLookbackDays: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a missing apiKey', () => {
    const result = configFields.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects a baseUrl with a trailing slash', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'DRATA_API_KEY' },
      baseUrl: 'https://public-api.drata.com/',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a baseUrl override', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'DRATA_API_KEY' },
      baseUrl: 'https://public-api.eu.drata.com',
    });
    expect(result.success).toBe(true);
  });
});

interface MockCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'application/json' }),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

function emptyPage(): { data: unknown[]; pagination: null } {
  return { data: [], pagination: null };
}

function makeFetch(route: (url: string, method: string) => unknown) {
  return vi.fn().mockImplementation((url: string | URL, init?: RequestInit) => {
    const u = typeof url === 'string' ? url : url.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    const explicit = route(u, method);
    if (explicit !== undefined) {
      return Promise.resolve(jsonResponse(explicit));
    }
    if (
      u.includes('/v1/controls') ||
      u.includes('/v1/tests') ||
      u.includes('/v1/personnel') ||
      u.includes('/v1/findings')
    ) {
      return Promise.resolve(jsonResponse(emptyPage()));
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
      body:
        typeof init.body === 'string'
          ? init.body
          : init.body === undefined
            ? undefined
            : String(init.body),
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

const API_KEY = 'DRATA_API_KEY' as unknown as { $secret: string };

function connector(
  resources?: string[],
  overrides: { baseUrl?: string; findingsLookbackDays?: number } = {},
) {
  return new DrataConnector(
    {
      baseUrl: overrides.baseUrl,
      findingsLookbackDays: overrides.findingsLookbackDays,
      ...(resources ? { resources: resources as never } : {}),
    },
    {
      apiKey: API_KEY,
    },
  );
}

describe('DrataConnector.sync', () => {
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

  it('sends the API key as a bearer authorization header on API calls', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector(['controls']).sync({ mode: 'full' }, makeStorage());

    const apiCall = recordCalls(fetchSpy).find((c) =>
      c.url.includes('/v1/controls'),
    );
    expect(apiCall).toBeDefined();
    const authHeader =
      apiCall!.headers['Authorization'] ?? apiCall!.headers['authorization'];
    expect(authHeader).toBe('Bearer DRATA_API_KEY');
  });

  it('writes a control entity per row with primary framework and status', async () => {
    const fetchSpy = makeFetch((u) => {
      if (u.includes('/v1/controls')) {
        return {
          data: [
            {
              id: 'ctrl_1',
              name: 'Access Reviews',
              status: 'PASSING',
              frameworks: [{ name: 'SOC 2' }, { name: 'ISO 27001' }],
              lastEvaluatedAt: '2026-05-01T00:00:00.000Z',
              updatedAt: '2026-05-01T00:00:00.000Z',
              createdAt: '2026-01-01T00:00:00.000Z',
            },
          ],
          pagination: { hasMore: false },
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['controls']).sync({ mode: 'full' }, storage);

    expect(storage.entity).toHaveBeenCalledTimes(1);
    const entity = storage.entity.mock.calls[0]![0] as {
      type: string;
      id: string;
      attributes: {
        name: string;
        status: string;
        framework: string;
        frameworks: string;
        lastEvaluated: number | null;
      };
      updated_at: number;
    };
    expect(entity.type).toBe('drata_control');
    expect(entity.id).toBe('ctrl_1');
    expect(entity.attributes.status).toBe('PASSING');
    expect(entity.attributes.framework).toBe('SOC 2');
    expect(entity.attributes.frameworks).toBe('SOC 2,ISO 27001');
    expect(entity.attributes.lastEvaluated).toBe(
      Date.parse('2026-05-01T00:00:00.000Z'),
    );
    expect(entity.updated_at).toBe(Date.parse('2026-05-01T00:00:00.000Z'));
  });

  it('writes a test entity with controlId derived from controlIds or controls[]', async () => {
    const fetchSpy = makeFetch((u) => {
      if (u.includes('/v1/tests')) {
        return {
          data: [
            {
              id: 'test_a',
              name: 'MFA enforced',
              status: 'OK',
              controlIds: ['ctrl_1', 'ctrl_2'],
              evidenceCount: 12,
              lastTestedAt: '2026-05-02T00:00:00.000Z',
              updatedAt: '2026-05-02T00:00:00.000Z',
            },
            {
              id: 'test_b',
              name: 'Backups verified',
              status: 'NEEDS_ATTENTION',
              controls: [{ id: 'ctrl_9' }],
              lastTestedAt: '2026-05-02T00:00:00.000Z',
            },
          ],
          pagination: { hasMore: false },
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['tests']).sync({ mode: 'full' }, storage);

    expect(storage.entity).toHaveBeenCalledTimes(2);
    const first = storage.entity.mock.calls[0]![0] as {
      attributes: { controlId: string; controlCount: number; status: string };
    };
    expect(first.attributes.controlId).toBe('ctrl_1');
    expect(first.attributes.controlCount).toBe(2);
    expect(first.attributes.status).toBe('OK');
    const second = storage.entity.mock.calls[1]![0] as {
      attributes: { controlId: string; controlCount: number };
    };
    expect(second.attributes.controlId).toBe('ctrl_9');
    expect(second.attributes.controlCount).toBe(1);
  });

  it('writes a personnel entity per row with derived name and training status', async () => {
    const fetchSpy = makeFetch((u) => {
      if (u.includes('/v1/personnel')) {
        return {
          data: [
            {
              id: 'p_1',
              email: 'alice@example.com',
              firstName: 'Alice',
              lastName: 'Anderson',
              role: 'Engineer',
              employmentStatus: 'ACTIVE',
              trainingStatus: 'COMPLETED',
              trainingCompletedAt: '2026-03-01T00:00:00.000Z',
              startDate: '2024-09-01T00:00:00.000Z',
              updatedAt: '2026-03-01T00:00:00.000Z',
            },
          ],
          pagination: { hasMore: false },
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['personnel']).sync({ mode: 'full' }, storage);

    expect(storage.entity).toHaveBeenCalledTimes(1);
    const entity = storage.entity.mock.calls[0]![0] as {
      type: string;
      id: string;
      attributes: {
        email: string;
        name: string;
        role: string;
        employmentStatus: string;
        trainingStatus: string;
        trainingCompleted: number | null;
        startDate: number | null;
      };
    };
    expect(entity.type).toBe('drata_personnel');
    expect(entity.attributes.email).toBe('alice@example.com');
    expect(entity.attributes.name).toBe('Alice Anderson');
    expect(entity.attributes.role).toBe('Engineer');
    expect(entity.attributes.employmentStatus).toBe('ACTIVE');
    expect(entity.attributes.trainingStatus).toBe('COMPLETED');
    expect(entity.attributes.trainingCompleted).toBe(
      Date.parse('2026-03-01T00:00:00.000Z'),
    );
  });

  it('writes one finding event per row, dropping rows older than since', async () => {
    const fetchSpy = makeFetch((u) => {
      if (u.includes('/v1/findings')) {
        return {
          data: [
            {
              id: 'fnd_old',
              testId: 'test_a',
              controlId: 'ctrl_1',
              severity: 'LOW',
              status: 'OPEN',
              createdAt: '2026-01-01T00:00:00.000Z',
            },
            {
              id: 'fnd_new',
              testId: 'test_a',
              controlId: 'ctrl_1',
              severity: 'HIGH',
              status: 'RESOLVED',
              createdAt: '2026-04-01T00:00:00.000Z',
              resolvedAt: '2026-04-02T00:00:00.000Z',
            },
          ],
          pagination: { hasMore: false },
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['findings']).sync(
      { mode: 'latest', since: '2026-03-01T00:00:00.000Z' },
      storage,
    );

    expect(storage.event).toHaveBeenCalledTimes(1);
    const written = storage.event.mock.calls[0]![0] as {
      name: string;
      start_ts: number;
      end_ts: number | null;
      attributes: {
        findingId: string;
        severity: string;
        status: string;
        resolvedAt: number | null;
      };
    };
    expect(written.name).toBe('drata_test_finding');
    expect(written.attributes.findingId).toBe('fnd_new');
    expect(written.attributes.severity).toBe('HIGH');
    expect(written.attributes.status).toBe('RESOLVED');
    expect(written.start_ts).toBe(Date.parse('2026-04-01T00:00:00.000Z'));
    expect(written.end_ts).toBe(Date.parse('2026-04-02T00:00:00.000Z'));
    expect(written.attributes.resolvedAt).toBe(
      Date.parse('2026-04-02T00:00:00.000Z'),
    );
  });

  it('paginates via pagination.nextCursor / hasMore', async () => {
    let calls = 0;
    const fetchSpy = vi.fn().mockImplementation((url: string | URL) => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.includes('/v1/controls')) {
        calls += 1;
        if (calls === 1) {
          return Promise.resolve(
            jsonResponse({
              data: [
                {
                  id: 'ctrl_1',
                  name: 'C1',
                  status: 'PASSING',
                  updatedAt: '2026-05-01T00:00:00.000Z',
                },
              ],
              pagination: { hasMore: true, nextCursor: 'cursor_2' },
            }),
          );
        }
        return Promise.resolve(
          jsonResponse({
            data: [
              {
                id: 'ctrl_2',
                name: 'C2',
                status: 'FAILING',
                updatedAt: '2026-05-01T00:00:00.000Z',
              },
            ],
            pagination: { hasMore: false },
          }),
        );
      }
      return Promise.resolve(jsonResponse(emptyPage()));
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['controls']).sync({ mode: 'full' }, storage);

    expect(calls).toBe(2);
    expect(storage.entity).toHaveBeenCalledTimes(2);
    const controlsCalls = recordCalls(fetchSpy).filter((c) =>
      c.url.includes('/v1/controls'),
    );
    expect(new URL(controlsCalls[0]!.url).searchParams.get('cursor')).toBe(
      null,
    );
    expect(new URL(controlsCalls[1]!.url).searchParams.get('cursor')).toBe(
      'cursor_2',
    );
  });

  it('only fetches the resources listed in settings.resources', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector(['controls']).sync({ mode: 'full' }, makeStorage());

    const calls = recordCalls(fetchSpy);
    expect(calls.some((c) => c.url.includes('/v1/controls'))).toBe(true);
    expect(calls.some((c) => c.url.includes('/v1/tests'))).toBe(false);
    expect(calls.some((c) => c.url.includes('/v1/personnel'))).toBe(false);
    expect(calls.some((c) => c.url.includes('/v1/findings'))).toBe(false);
  });

  it('clears entity scope on both full and incremental syncs for entity phases', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetch(() => undefined),
    );

    const full = makeStorage();
    await connector(['controls']).sync({ mode: 'full' }, full);
    expect(full.entities).toHaveBeenCalledTimes(1);

    const incr = makeStorage();
    await connector(['controls']).sync(
      { mode: 'latest', since: '2026-01-01T00:00:00.000Z' },
      incr,
    );
    expect(incr.entities).toHaveBeenCalledTimes(1);
  });

  it('clears events scope only on full sync, not on incremental', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetch(() => undefined),
    );

    const full = makeStorage();
    await connector(['findings']).sync({ mode: 'full' }, full);
    expect(full.events).toHaveBeenCalledTimes(1);

    const incr = makeStorage();
    await connector(['findings']).sync(
      { mode: 'latest', since: '2026-01-01T00:00:00.000Z' },
      incr,
    );
    expect(incr.events).not.toHaveBeenCalled();
  });

  it('uses lookback window when no since is set for findings', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector(['findings'], { findingsLookbackDays: 7 }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const findingsCall = recordCalls(fetchSpy).find((c) =>
      c.url.includes('/v1/findings'),
    );
    expect(findingsCall).toBeDefined();
    const after = new URL(findingsCall!.url).searchParams.get('createdAfter');
    expect(after).toBeDefined();
    const afterMs = Date.parse(after!);
    const expectedMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
    expect(Math.abs(afterMs - expectedMs)).toBeLessThan(60 * 1000);
  });

  it('uses since for findings when provided', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector(['findings']).sync(
      { mode: 'latest', since: '2026-04-01T00:00:00.000Z' },
      makeStorage(),
    );

    const findingsCall = recordCalls(fetchSpy).find((c) =>
      c.url.includes('/v1/findings'),
    );
    expect(findingsCall).toBeDefined();
    expect(new URL(findingsCall!.url).searchParams.get('createdAfter')).toBe(
      '2026-04-01T00:00:00.000Z',
    );
  });

  it('resumes from a saved cursor, skipping earlier phases', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector().sync(
      { mode: 'full', cursor: { phase: 'personnel', page: null } },
      makeStorage(),
    );

    const calls = recordCalls(fetchSpy);
    expect(calls.some((c) => c.url.includes('/v1/controls'))).toBe(false);
    expect(calls.some((c) => c.url.includes('/v1/tests'))).toBe(false);
    expect(calls.some((c) => c.url.includes('/v1/personnel'))).toBe(true);
  });

  it('honors a custom baseUrl', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector(['controls'], {
      baseUrl: 'https://public-api.eu.drata.com',
    }).sync({ mode: 'full' }, makeStorage());

    const apiCall = recordCalls(fetchSpy).find((c) =>
      c.url.includes('/v1/controls'),
    );
    expect(apiCall).toBeDefined();
    expect(
      apiCall!.url.startsWith('https://public-api.eu.drata.com/v1/controls'),
    ).toBe(true);
  });
});

describe('DrataConnector.create', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns a configured instance from JSON input', () => {
    vi.stubEnv('DRATA_API_KEY', 'apik_test');
    const c = DrataConnector.create({
      apiKey: { $secret: 'DRATA_API_KEY' },
    });
    expect(c).toBeInstanceOf(DrataConnector);
    expect(c.id).toBe('drata');
  });
});
