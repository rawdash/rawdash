import { afterEach, describe, expect, it, vi } from 'vitest';

import { GreenhouseConnector, configFields } from './greenhouse';

// ---------------------------------------------------------------------------
// configFields
// ---------------------------------------------------------------------------

describe('configFields', () => {
  it('parses a valid config with only apiKey', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'GREENHOUSE_API_KEY' },
    });
    expect(result.success).toBe(true);
  });

  it('parses a config with apiKey and a resources allowlist', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'GREENHOUSE_API_KEY' },
      resources: ['jobs', 'applications'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown resource', () => {
    expect(
      configFields.safeParse({
        apiKey: { $secret: 'GREENHOUSE_API_KEY' },
        resources: ['interviews'],
      }).success,
    ).toBe(false);
  });

  it('rejects a plain string apiKey instead of secret object', () => {
    expect(configFields.safeParse({ apiKey: 'literal' }).success).toBe(false);
  });

  it('rejects a config missing apiKey', () => {
    expect(configFields.safeParse({}).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Fetch + storage mocks
// ---------------------------------------------------------------------------

interface MockCall {
  url: string;
  method: string;
  headers: Record<string, string>;
}

function jsonResponse(
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body ?? null), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function makeFetch(
  route: (
    url: string,
  ) => { body: unknown; headers?: Record<string, string> } | undefined,
) {
  return vi.fn().mockImplementation((url: string | URL) => {
    const u = typeof url === 'string' ? url : url.toString();
    const explicit = route(u);
    if (explicit !== undefined) {
      return Promise.resolve(jsonResponse(explicit.body, explicit.headers));
    }
    return Promise.resolve(jsonResponse([]));
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

const TOKEN = 'API_KEY' as unknown as { $secret: string };

function connector(overrides: { resources?: string[] } = {}) {
  return new GreenhouseConnector(
    overrides.resources ? { resources: overrides.resources as never } : {},
    { apiKey: TOKEN },
  );
}

// ---------------------------------------------------------------------------
// sync — auth, since, scope clearing, event derivation
// ---------------------------------------------------------------------------

describe('GreenhouseConnector.sync', () => {
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

  it('sends Basic auth with the API key as username and an empty password', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector({ resources: ['jobs'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const headers = recordCalls(fetchSpy)[0]!.headers;
    const expected = `Basic ${btoa('API_KEY:')}`;
    expect(headers['authorization']).toBe(expected);
    expect(headers['accept']).toBe('application/json');
  });

  it('passes options.since as updated_after on every paginated phase', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    const since = '2026-01-01T00:00:00.000Z';
    await connector({
      resources: ['jobs', 'candidates', 'applications', 'offers'],
    }).sync({ mode: 'full', since }, makeStorage());

    const urls = recordCalls(fetchSpy).map((c) => c.url);
    // Each paginated entity phase forwards `since` as updated_after.
    for (const path of [
      '/v1/jobs',
      '/v1/candidates',
      '/v1/applications',
      '/v1/offers',
    ]) {
      const match = urls.find((u) => u.includes(path));
      expect(match, `expected a call to ${path}`).toBeDefined();
      expect(match).toContain(`updated_after=${encodeURIComponent(since)}`);
    }
  });

  it('clears entity scopes only at the start of a full sync', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetch(() => undefined),
    );

    const fullStorage = makeStorage();
    await connector({ resources: ['jobs'] }).sync(
      { mode: 'full' },
      fullStorage,
    );
    const fullClears = fullStorage.entities.mock.calls
      .filter((c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0)
      .map((c) => (c[1] as { types: string[] }).types[0]);
    expect(fullClears).toContain('greenhouse_job');

    const latestStorage = makeStorage();
    await connector({ resources: ['jobs'] }).sync(
      { mode: 'latest', since: new Date(Date.now() - 60_000).toISOString() },
      latestStorage,
    );
    const latestClears = latestStorage.entities.mock.calls.filter(
      (c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0,
    );
    expect(latestClears).toHaveLength(0);
  });

  it('always clears the application_events scope on every sync (full or incremental)', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetch(() => undefined),
    );

    const storage = makeStorage();
    await connector({ resources: ['application_events'] }).sync(
      { mode: 'latest', since: new Date(Date.now() - 60_000).toISOString() },
      storage,
    );
    const clearedEvents = storage.events.mock.calls.map(
      (c) => (c[1] as { names: string[] }).names[0],
    );
    expect(clearedEvents).toContain('greenhouse_application_event');
  });

  it('writes a job entity with departments / offices flattened to name lists', async () => {
    const fetchSpy = makeFetch((url) => {
      if (url.includes('/v1/jobs')) {
        return {
          body: [
            {
              id: 42,
              name: 'Senior Engineer',
              status: 'open',
              requisition_id: 'REQ-100',
              departments: [
                { id: 1, name: 'Engineering' },
                { id: 2, name: 'Platform' },
              ],
              offices: [{ id: 10, name: 'Remote' }],
              opened_at: '2026-01-15T00:00:00Z',
              closed_at: null,
              created_at: '2026-01-10T00:00:00Z',
              updated_at: '2026-02-01T00:00:00Z',
            },
          ],
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector({ resources: ['jobs'] }).sync({ mode: 'full' }, storage);

    const entity = storage.entity.mock.calls[0]![0] as {
      type: string;
      id: string;
      attributes: {
        name: string;
        status: string;
        departments: string[];
        offices: string[];
        openedAt: number;
        requisitionId: string;
      };
    };
    expect(entity.type).toBe('greenhouse_job');
    expect(entity.id).toBe('42');
    expect(entity.attributes.name).toBe('Senior Engineer');
    expect(entity.attributes.status).toBe('open');
    expect(entity.attributes.departments).toEqual(['Engineering', 'Platform']);
    expect(entity.attributes.offices).toEqual(['Remote']);
    expect(entity.attributes.openedAt).toBe(Date.parse('2026-01-15T00:00:00Z'));
    expect(entity.attributes.requisitionId).toBe('REQ-100');
  });

  it('derives hiredAt from last_activity_at when status is "hired"', async () => {
    const lastActivity = '2026-04-01T12:00:00Z';
    const fetchSpy = makeFetch((url) => {
      if (url.includes('/v1/applications')) {
        return {
          body: [
            {
              id: 1,
              candidate_id: 100,
              status: 'hired',
              current_stage: { id: 9, name: 'Offer' },
              applied_at: '2026-02-01T00:00:00Z',
              rejected_at: null,
              last_activity_at: lastActivity,
              source: { id: 5, public_name: 'LinkedIn' },
              jobs: [{ id: 42, name: 'Senior Engineer' }],
            },
          ],
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector({ resources: ['applications'] }).sync(
      { mode: 'full' },
      storage,
    );

    const entity = storage.entity.mock.calls[0]![0] as {
      attributes: {
        hiredAt: number | null;
        jobId: string;
        jobName: string;
        source: string;
      };
    };
    expect(entity.attributes.hiredAt).toBe(Date.parse(lastActivity));
    expect(entity.attributes.jobId).toBe('42');
    expect(entity.attributes.jobName).toBe('Senior Engineer');
    expect(entity.attributes.source).toBe('LinkedIn');
  });

  it('emits applied / hired / rejected events from each application timestamps', async () => {
    const fetchSpy = makeFetch((url) => {
      if (url.includes('/v1/applications')) {
        return {
          body: [
            {
              id: 1,
              candidate_id: 100,
              status: 'hired',
              applied_at: '2026-02-01T00:00:00Z',
              last_activity_at: '2026-04-01T00:00:00Z',
              jobs: [{ id: 42, name: 'Eng' }],
            },
            {
              id: 2,
              candidate_id: 101,
              status: 'rejected',
              applied_at: '2026-02-10T00:00:00Z',
              rejected_at: '2026-03-01T00:00:00Z',
              jobs: [{ id: 42, name: 'Eng' }],
            },
            {
              id: 3,
              candidate_id: 102,
              status: 'active',
              applied_at: '2026-03-15T00:00:00Z',
              jobs: [{ id: 42, name: 'Eng' }],
            },
          ],
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector({ resources: ['application_events'] }).sync(
      { mode: 'full' },
      storage,
    );

    const events = storage.event.mock.calls.map(
      (c) =>
        c[0] as {
          name: string;
          start_ts: number;
          attributes: {
            applicationId: string;
            transition: string;
          };
        },
    );
    const transitions = events.map(
      (e) => `${e.attributes.applicationId}:${e.attributes.transition}`,
    );
    // Every emitted event has the connector's event name.
    for (const e of events) {
      expect(e.name).toBe('greenhouse_application_event');
    }
    // Application 1 (hired): applied + hired (no rejected_at).
    expect(transitions).toContain('1:applied');
    expect(transitions).toContain('1:hired');
    expect(transitions).not.toContain('1:rejected');
    // Application 2 (rejected): applied + rejected, no hired.
    expect(transitions).toContain('2:applied');
    expect(transitions).toContain('2:rejected');
    expect(transitions).not.toContain('2:hired');
    // Application 3 (active): applied only.
    expect(transitions).toContain('3:applied');
    expect(transitions).not.toContain('3:hired');
    expect(transitions).not.toContain('3:rejected');
  });

  it('follows the Link header next URL across pages', async () => {
    const page2 = 'https://harvest.greenhouse.io/v1/jobs?page=2&per_page=100';
    let calls = 0;
    const fetchSpy = makeFetch((url) => {
      if (url.includes('/v1/jobs')) {
        calls += 1;
        if (calls === 1) {
          return {
            body: [
              {
                id: 1,
                name: 'A',
                created_at: '2026-01-01T00:00:00Z',
                updated_at: '2026-01-01T00:00:00Z',
              },
            ],
            headers: { link: `<${page2}>; rel="next"` },
          };
        }
        return {
          body: [
            {
              id: 2,
              name: 'B',
              created_at: '2026-01-02T00:00:00Z',
              updated_at: '2026-01-02T00:00:00Z',
            },
          ],
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector({ resources: ['jobs'] }).sync({ mode: 'full' }, storage);

    const urls = recordCalls(fetchSpy).map((c) => c.url);
    expect(urls.filter((u) => u.includes('/v1/jobs'))).toHaveLength(2);
    expect(urls[1]).toBe(page2);
    const writtenIds = storage.entity.mock.calls.map(
      (c) => (c[0] as { id: string }).id,
    );
    expect(writtenIds).toEqual(['1', '2']);
  });

  it('only fetches the resources listed in settings.resources', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector({ resources: ['jobs'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const urls = recordCalls(fetchSpy).map((c) => c.url);
    expect(urls.some((u) => u.includes('/v1/jobs'))).toBe(true);
    expect(urls.some((u) => u.includes('/v1/candidates'))).toBe(false);
    expect(urls.some((u) => u.includes('/v1/applications'))).toBe(false);
    expect(urls.some((u) => u.includes('/v1/offers'))).toBe(false);
  });

  it('rejects cross-host Link headers (URL sanitization)', async () => {
    const evil = 'https://evil.example.com/v1/jobs?token=GIVE_ME';
    let calls = 0;
    const fetchSpy = makeFetch((url) => {
      if (url.includes('harvest.greenhouse.io')) {
        calls += 1;
        if (calls === 1) {
          return {
            body: [
              {
                id: 1,
                name: 'A',
                created_at: '2026-01-01T00:00:00Z',
                updated_at: '2026-01-01T00:00:00Z',
              },
            ],
            headers: { link: `<${evil}>; rel="next"` },
          };
        }
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    await connector({ resources: ['jobs'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const urls = recordCalls(fetchSpy).map((c) => c.url);
    expect(urls.some((u) => u.includes('evil.example.com'))).toBe(false);
  });
});

describe('GreenhouseConnector.create', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the connector instance directly', () => {
    vi.stubEnv('GREENHOUSE_API_KEY', 'test_token_fixture');
    const c = GreenhouseConnector.create({
      apiKey: { $secret: 'GREENHOUSE_API_KEY' },
    });
    expect(c).toBeInstanceOf(GreenhouseConnector);
    expect(c.id).toBe('greenhouse');
  });
});
