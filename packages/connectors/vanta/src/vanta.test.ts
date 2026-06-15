import { afterEach, describe, expect, it, vi } from 'vitest';

import { VantaConnector, configFields } from './vanta';

describe('configFields', () => {
  it('parses a valid config', () => {
    const result = configFields.safeParse({
      clientId: 'vci_AbCdEf',
      clientSecret: { $secret: 'VANTA_CLIENT_SECRET' },
    });
    expect(result.success).toBe(true);
  });

  it('parses a config with resources, scope, and findings lookback', () => {
    const result = configFields.safeParse({
      clientId: 'vci_AbCdEf',
      clientSecret: { $secret: 'VANTA_CLIENT_SECRET' },
      scope: 'vanta-api.all:read',
      resources: ['controls', 'findings'],
      findingsLookbackDays: 30,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a plain-string clientSecret', () => {
    const result = configFields.safeParse({
      clientId: 'vci_AbCdEf',
      clientSecret: 'plain',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown resource name', () => {
    const result = configFields.safeParse({
      clientId: 'vci_AbCdEf',
      clientSecret: { $secret: 'VANTA_CLIENT_SECRET' },
      resources: ['controls', 'evidence'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty resources array', () => {
    const result = configFields.safeParse({
      clientId: 'vci_AbCdEf',
      clientSecret: { $secret: 'VANTA_CLIENT_SECRET' },
      resources: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-positive findingsLookbackDays', () => {
    const result = configFields.safeParse({
      clientId: 'vci_AbCdEf',
      clientSecret: { $secret: 'VANTA_CLIENT_SECRET' },
      findingsLookbackDays: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a missing clientId', () => {
    const result = configFields.safeParse({
      clientSecret: { $secret: 'VANTA_CLIENT_SECRET' },
    });
    expect(result.success).toBe(false);
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

function emptyPage(): { results: { data: unknown[]; pageInfo: null } } {
  return { results: { data: [], pageInfo: null } };
}

function makeFetch(route: (url: string, method: string) => unknown) {
  return vi.fn().mockImplementation((url: string | URL, init?: RequestInit) => {
    const u = typeof url === 'string' ? url : url.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    const explicit = route(u, method);
    if (explicit !== undefined) {
      return Promise.resolve(jsonResponse(explicit));
    }
    if (u.includes('/oauth/token')) {
      return Promise.resolve(jsonResponse({ access_token: 'tok' }));
    }
    if (
      u.includes('/v1/controls') ||
      u.includes('/v1/tests') ||
      u.includes('/v1/test-findings')
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

const CLIENT_SECRET = 'VANTA_CLIENT_SECRET' as unknown as { $secret: string };

function connector(
  resources?: string[],
  overrides: { scope?: string; findingsLookbackDays?: number } = {},
) {
  return new VantaConnector(
    {
      scope: overrides.scope,
      findingsLookbackDays: overrides.findingsLookbackDays,
      ...(resources ? { resources: resources as never } : {}),
    },
    {
      clientId: 'vci_AbCdEf',
      clientSecret: CLIENT_SECRET,
    },
  );
}

describe('VantaConnector.sync', () => {
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

  it('mints an OAuth token once and reuses it across phases', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector().sync({ mode: 'full' }, makeStorage());

    const tokenCalls = recordCalls(fetchSpy).filter((c) =>
      c.url.includes('/oauth/token'),
    );
    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0]!.method).toBe('POST');
    const body = JSON.parse(String(tokenCalls[0]!.body));
    expect(body.grant_type).toBe('client_credentials');
    expect(body.client_id).toBe('vci_AbCdEf');
    expect(body.client_secret).toBe('VANTA_CLIENT_SECRET');
    expect(body.scope).toBe('vanta-api.all:read');
  });

  it('honors a custom scope', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector(undefined, { scope: 'vanta-api.controls:read' }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const tokenCall = recordCalls(fetchSpy).find((c) =>
      c.url.includes('/oauth/token'),
    )!;
    const body = JSON.parse(String(tokenCall.body));
    expect(body.scope).toBe('vanta-api.controls:read');
  });

  it('sends the access token as a bearer authorization header on API calls', async () => {
    const fetchSpy = makeFetch((u) => {
      if (u.includes('/oauth/token')) {
        return { access_token: 'real_access_token' };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    await connector(['controls']).sync({ mode: 'full' }, makeStorage());

    const apiCall = recordCalls(fetchSpy).find((c) =>
      c.url.includes('/v1/controls'),
    );
    expect(apiCall).toBeDefined();
    const authHeader =
      apiCall!.headers['Authorization'] ?? apiCall!.headers['authorization'];
    expect(authHeader).toBe('Bearer real_access_token');
  });

  it('writes a control entity per row with primary framework and status', async () => {
    const fetchSpy = makeFetch((u) => {
      if (u.includes('/v1/controls')) {
        return {
          results: {
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
            pageInfo: { hasNextPage: false },
          },
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
    expect(entity.type).toBe('vanta_control');
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
          results: {
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
            pageInfo: { hasNextPage: false },
          },
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

  it('writes one finding event per row, dropping rows older than since', async () => {
    const fetchSpy = makeFetch((u) => {
      if (u.includes('/v1/test-findings')) {
        return {
          results: {
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
            pageInfo: { hasNextPage: false },
          },
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
    expect(written.name).toBe('vanta_test_finding');
    expect(written.attributes.findingId).toBe('fnd_new');
    expect(written.attributes.severity).toBe('HIGH');
    expect(written.attributes.status).toBe('RESOLVED');
    expect(written.start_ts).toBe(Date.parse('2026-04-01T00:00:00.000Z'));
    expect(written.end_ts).toBe(Date.parse('2026-04-02T00:00:00.000Z'));
    expect(written.attributes.resolvedAt).toBe(
      Date.parse('2026-04-02T00:00:00.000Z'),
    );
  });

  it('paginates via pageInfo.endCursor / hasNextPage', async () => {
    let calls = 0;
    const fetchSpy = vi
      .fn()
      .mockImplementation((url: string | URL, init?: RequestInit) => {
        const u = typeof url === 'string' ? url : url.toString();
        if (u.includes('/oauth/token')) {
          return Promise.resolve(jsonResponse({ access_token: 'tok' }));
        }
        if (u.includes('/v1/controls')) {
          calls += 1;
          if (calls === 1) {
            return Promise.resolve(
              jsonResponse({
                results: {
                  data: [
                    {
                      id: 'ctrl_1',
                      name: 'C1',
                      status: 'PASSING',
                      updatedAt: '2026-05-01T00:00:00.000Z',
                    },
                  ],
                  pageInfo: { hasNextPage: true, endCursor: 'cursor_2' },
                },
              }),
            );
          }
          return Promise.resolve(
            jsonResponse({
              results: {
                data: [
                  {
                    id: 'ctrl_2',
                    name: 'C2',
                    status: 'FAILING',
                    updatedAt: '2026-05-01T00:00:00.000Z',
                  },
                ],
                pageInfo: { hasNextPage: false },
              },
            }),
          );
        }
        if (
          init === undefined ||
          (init.method ?? 'GET').toUpperCase() === 'GET'
        ) {
          return Promise.resolve(jsonResponse(emptyPage()));
        }
        return Promise.resolve(jsonResponse({}));
      });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['controls']).sync({ mode: 'full' }, storage);

    expect(calls).toBe(2);
    expect(storage.entity).toHaveBeenCalledTimes(2);
    const controlsCalls = recordCalls(fetchSpy).filter((c) =>
      c.url.includes('/v1/controls'),
    );
    expect(new URL(controlsCalls[0]!.url).searchParams.get('pageCursor')).toBe(
      null,
    );
    expect(new URL(controlsCalls[1]!.url).searchParams.get('pageCursor')).toBe(
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
    expect(calls.some((c) => c.url.includes('/v1/test-findings'))).toBe(false);
  });

  it('clears entity scope on full sync but not on incremental', async () => {
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
      c.url.includes('/v1/test-findings'),
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
      c.url.includes('/v1/test-findings'),
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
      { mode: 'full', cursor: { phase: 'tests', page: null } },
      makeStorage(),
    );

    const calls = recordCalls(fetchSpy);
    expect(calls.some((c) => c.url.includes('/v1/controls'))).toBe(false);
    expect(calls.some((c) => c.url.includes('/v1/tests'))).toBe(true);
  });

  it('caches the access token across multiple API calls within a phase', async () => {
    let calls = 0;
    const fetchSpy = vi.fn().mockImplementation((url: string | URL) => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.includes('/oauth/token')) {
        return Promise.resolve(jsonResponse({ access_token: 'tok' }));
      }
      if (u.includes('/v1/controls')) {
        calls += 1;
        if (calls === 1) {
          return Promise.resolve(
            jsonResponse({
              results: {
                data: [
                  {
                    id: 'ctrl_a',
                    name: 'A',
                    status: 'PASSING',
                    updatedAt: '2026-05-01T00:00:00.000Z',
                  },
                ],
                pageInfo: { hasNextPage: true, endCursor: 'p2' },
              },
            }),
          );
        }
        return Promise.resolve(jsonResponse(emptyPage()));
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchSpy);

    await connector(['controls']).sync({ mode: 'full' }, makeStorage());

    const tokenCalls = recordCalls(fetchSpy).filter((c) =>
      c.url.includes('/oauth/token'),
    );
    expect(tokenCalls.length).toBe(1);
    expect(calls).toBe(2);
  });
});

describe('VantaConnector.create', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns a configured instance from JSON input', () => {
    vi.stubEnv('VANTA_CLIENT_SECRET', 'cs_test');
    const c = VantaConnector.create({
      clientId: 'vci_AbCdEf',
      clientSecret: { $secret: 'VANTA_CLIENT_SECRET' },
    });
    expect(c).toBeInstanceOf(VantaConnector);
    expect(c.id).toBe('vanta');
  });
});
