import { afterEach, describe, expect, it, vi } from 'vitest';

import { ServiceNowConnector, configFields } from './servicenow';

describe('configFields', () => {
  it('parses a valid minimal config', () => {
    const result = configFields.safeParse({
      instanceUrl: 'acme.service-now.com',
      username: 'rawdash.integration',
      password: { $secret: 'SERVICENOW_PASSWORD' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts a full https instance URL', () => {
    const result = configFields.safeParse({
      instanceUrl: 'https://acme.service-now.com',
      username: 'rawdash.integration',
      password: { $secret: 'SERVICENOW_PASSWORD' },
    });
    expect(result.success).toBe(true);
  });

  it('parses a config with explicit resources', () => {
    const result = configFields.safeParse({
      instanceUrl: 'acme.service-now.com',
      username: 'rawdash.integration',
      password: { $secret: 'SERVICENOW_PASSWORD' },
      resources: ['incidents', 'problems'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an instance URL that contains a path', () => {
    expect(
      configFields.safeParse({
        instanceUrl: 'acme.service-now.com/api',
        username: 'rawdash.integration',
        password: { $secret: 'SERVICENOW_PASSWORD' },
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown resource', () => {
    expect(
      configFields.safeParse({
        instanceUrl: 'acme.service-now.com',
        username: 'rawdash.integration',
        password: { $secret: 'SERVICENOW_PASSWORD' },
        resources: ['incidents', 'tasks'],
      }).success,
    ).toBe(false);
  });

  it('rejects a plain string password instead of secret object', () => {
    expect(
      configFields.safeParse({
        instanceUrl: 'acme.service-now.com',
        username: 'rawdash.integration',
        password: 'abc',
      }).success,
    ).toBe(false);
  });

  it('rejects a config missing required fields', () => {
    expect(configFields.safeParse({}).success).toBe(false);
    expect(
      configFields.safeParse({
        instanceUrl: 'acme.service-now.com',
        password: { $secret: 'SERVICENOW_PASSWORD' },
      }).success,
    ).toBe(false);
  });
});

interface MockCall {
  url: string;
  method: string;
  headers: Record<string, string>;
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

function makeFetch(route: (url: string, method: string) => unknown) {
  return vi.fn().mockImplementation((url: string | URL, init?: RequestInit) => {
    const u = typeof url === 'string' ? url : url.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    const explicit = route(u, method);
    if (explicit !== undefined) {
      return Promise.resolve(jsonResponse(explicit));
    }
    return Promise.resolve(jsonResponse({ result: [] }));
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

function expectedBasicAuth(raw: string): string {
  if (typeof btoa === 'function') {
    return `Basic ${btoa(raw)}`;
  }
  const bufferCtor = (
    globalThis as {
      Buffer?: { from: (s: string) => { toString: (enc: string) => string } };
    }
  ).Buffer;
  return `Basic ${bufferCtor!.from(raw).toString('base64')}`;
}

const PASSWORD = 'SERVICENOW_PASSWORD' as unknown as { $secret: string };

function connector(
  overrides: {
    resources?: string[];
    instanceUrl?: string;
  } = {},
) {
  return new ServiceNowConnector(
    {
      instanceUrl: overrides.instanceUrl ?? 'acme.service-now.com',
      ...(overrides.resources
        ? { resources: overrides.resources as never }
        : {}),
    },
    { username: 'rawdash.integration', password: PASSWORD },
  );
}

describe('ServiceNowConnector.sync', () => {
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

  it('clears every entity scope at the start of a full sync', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetch(() => undefined),
    );
    const storage = makeStorage();
    await connector().sync({ mode: 'full' }, storage);

    const clearedTypes = storage.entities.mock.calls
      .filter((c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0)
      .map((c) => (c[1] as { types: string[] }).types[0]);
    expect(clearedTypes).toContain('servicenow_incident');
    expect(clearedTypes).toContain('servicenow_change_request');
    expect(clearedTypes).toContain('servicenow_problem');
  });

  it('always clears the incident-event scope, even on an incremental tick', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetch(() => undefined),
    );
    const storage = makeStorage();
    await connector().sync(
      { mode: 'latest', since: new Date(Date.now() - 60_000).toISOString() },
      storage,
    );

    const clearedEvents = storage.events.mock.calls.map(
      (c) => (c[1] as { names: string[] }).names[0],
    );
    expect(clearedEvents).toContain('servicenow_incident_state_change');

    const entityClears = storage.entities.mock.calls.filter(
      (c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0,
    );
    expect(entityClears).toHaveLength(0);
  });

  it('writes an incident entity with mapped labels and resolved references', async () => {
    const fetchSpy = makeFetch((url) => {
      if (url.includes('/api/now/table/incident')) {
        return {
          result: [
            {
              sys_id: 'a1b2',
              number: 'INC0010001',
              short_description: 'email down',
              state: '2',
              priority: '1',
              urgency: '1',
              impact: '1',
              category: 'inquiry',
              assignment_group: 'grp-1',
              assigned_to: 'usr-7',
              caller_id: 'usr-9',
              active: 'true',
              opened_at: '2024-01-01 00:00:00',
              resolved_at: '',
              closed_at: '',
              sys_created_on: '2024-01-01 00:00:00',
              sys_updated_on: '2024-01-02 00:00:00',
            },
          ],
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector({ resources: ['incidents'] }).sync(
      { mode: 'full' },
      storage,
    );

    const entity = storage.entity.mock.calls[0]![0] as {
      type: string;
      id: string;
      attributes: {
        number: string;
        state: string;
        stateLabel: string;
        priority: string;
        priorityLabel: string;
        assignmentGroupId: string;
        assignedToId: string;
        active: boolean;
        openedAt: number;
        resolvedAt: number | null;
      };
      updated_at: number;
    };
    expect(entity.type).toBe('servicenow_incident');
    expect(entity.id).toBe('a1b2');
    expect(entity.attributes.number).toBe('INC0010001');
    expect(entity.attributes.state).toBe('2');
    expect(entity.attributes.stateLabel).toBe('In Progress');
    expect(entity.attributes.priorityLabel).toBe('Critical');
    expect(entity.attributes.assignmentGroupId).toBe('grp-1');
    expect(entity.attributes.assignedToId).toBe('usr-7');
    expect(entity.attributes.active).toBe(true);
    expect(entity.attributes.openedAt).toBe(Date.parse('2024-01-01T00:00:00Z'));
    expect(entity.attributes.resolvedAt).toBeNull();
    expect(entity.updated_at).toBe(Date.parse('2024-01-02T00:00:00Z'));
  });

  it('resolves reference fields returned as {value} objects', async () => {
    const fetchSpy = makeFetch((url) => {
      if (url.includes('/api/now/table/incident')) {
        return {
          result: [
            {
              sys_id: 'a1',
              assignment_group: { value: 'grp-42', link: 'https://x/grp-42' },
              sys_created_on: '2024-01-01 00:00:00',
              sys_updated_on: '2024-01-01 00:00:00',
            },
          ],
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector({ resources: ['incidents'] }).sync(
      { mode: 'full' },
      storage,
    );

    const entity = storage.entity.mock.calls[0]![0] as {
      attributes: { assignmentGroupId: string | null };
    };
    expect(entity.attributes.assignmentGroupId).toBe('grp-42');
  });

  it('emits opened/resolved/closed events derived from incident timestamps', async () => {
    const fetchSpy = makeFetch((url) => {
      if (url.includes('/api/now/table/incident')) {
        return {
          result: [
            {
              sys_id: 'open-1',
              opened_at: '2024-01-01 00:00:00',
              sys_created_on: '2024-01-01 00:00:00',
            },
            {
              sys_id: 'closed-1',
              opened_at: '2024-01-01 00:00:00',
              resolved_at: '2024-01-02 00:00:00',
              closed_at: '2024-01-03 00:00:00',
              sys_created_on: '2024-01-01 00:00:00',
            },
          ],
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector({ resources: ['incident_events'] }).sync(
      { mode: 'full' },
      storage,
    );

    const transitions = storage.event.mock.calls.map(
      (c) =>
        (c[0] as { attributes: { transition: string } }).attributes.transition,
    );
    expect(transitions.filter((t) => t === 'opened')).toHaveLength(2);
    expect(transitions.filter((t) => t === 'resolved')).toHaveLength(1);
    expect(transitions.filter((t) => t === 'closed')).toHaveLength(1);

    const first = storage.event.mock.calls[0]![0] as { name: string };
    expect(first.name).toBe('servicenow_incident_state_change');
  });

  it('filters on sys_updated_on for incidents on an incremental tick', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    const since = '2024-01-01T00:00:00.000Z';
    await connector({ resources: ['incidents'] }).sync(
      { mode: 'latest', since },
      makeStorage(),
    );

    const req = recordCalls(fetchSpy).find((c) =>
      c.url.includes('/api/now/table/incident'),
    );
    expect(req).toBeDefined();
    const query = new URL(req!.url).searchParams.get('sysparm_query');
    expect(query).toContain('sys_updated_on>=2024-01-01 00:00:00');
    expect(query).toContain('ORDERBYsys_updated_on');
  });

  it('does not filter incident_events by since (rebuilds the full window)', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector({ resources: ['incident_events'] }).sync(
      { mode: 'latest', since: '2024-01-01T00:00:00.000Z' },
      makeStorage(),
    );

    const req = recordCalls(fetchSpy).find((c) =>
      c.url.includes('/api/now/table/incident'),
    );
    expect(req).toBeDefined();
    const query = new URL(req!.url).searchParams.get('sysparm_query');
    expect(query).not.toContain('sys_updated_on>=');
  });

  it('paginates via sysparm_offset when a full page is returned', async () => {
    let calls = 0;
    const fetchSpy = makeFetch((url) => {
      if (url.includes('/api/now/table/incident')) {
        calls += 1;
        if (calls === 1) {
          return {
            result: Array.from({ length: 100 }, (_, i) => ({
              sys_id: `a${i}`,
              sys_created_on: '2024-01-01 00:00:00',
              sys_updated_on: '2024-01-01 00:00:00',
            })),
          };
        }
        return { result: [] };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    await connector({ resources: ['incidents'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const reqs = recordCalls(fetchSpy).filter((c) =>
      c.url.includes('/api/now/table/incident'),
    );
    expect(reqs).toHaveLength(2);
    expect(new URL(reqs[0]!.url).searchParams.get('sysparm_offset')).toBe('0');
    expect(new URL(reqs[1]!.url).searchParams.get('sysparm_offset')).toBe(
      '100',
    );
  });

  it('only fetches the resources listed in settings.resources', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector({ resources: ['incidents', 'problems'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const urls = recordCalls(fetchSpy).map((c) => c.url);
    expect(urls.some((u) => u.includes('/api/now/table/incident'))).toBe(true);
    expect(urls.some((u) => u.includes('/api/now/table/problem'))).toBe(true);
    expect(urls.some((u) => u.includes('/api/now/table/change_request'))).toBe(
      false,
    );
  });

  it('resumes from a saved cursor, skipping earlier phases', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector().sync(
      {
        mode: 'full',
        cursor: { phase: 'change_requests', page: '200' },
      },
      makeStorage(),
    );

    const urls = recordCalls(fetchSpy).map((c) => c.url);
    expect(urls.some((u) => u.includes('/api/now/table/incident'))).toBe(false);
    const changeCall = urls.find((u) =>
      u.includes('/api/now/table/change_request'),
    );
    expect(changeCall).toBeDefined();
    expect(new URL(changeCall!).searchParams.get('sysparm_offset')).toBe('200');
  });

  it('pushes a single state filter onto the incident query', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector({ resources: ['incidents'] }).sync(
      {
        mode: 'full',
        fetchSpecs: {
          servicenow_incident: [
            { filter: [{ field: 'state', op: 'eq', value: '2' }] },
          ],
        },
      } as never,
      makeStorage(),
    );

    const req = recordCalls(fetchSpy).find((c) =>
      c.url.includes('/api/now/table/incident'),
    );
    expect(req).toBeDefined();
    expect(new URL(req!.url).searchParams.get('sysparm_query')).toContain(
      'state=2',
    );
  });

  it('does not push a state filter when two incident specs are provided', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector({ resources: ['incidents'] }).sync(
      {
        mode: 'full',
        fetchSpecs: {
          servicenow_incident: [
            { filter: [{ field: 'state', op: 'eq', value: '2' }] },
            { filter: [{ field: 'state', op: 'eq', value: '6' }] },
          ],
        },
      } as never,
      makeStorage(),
    );

    const req = recordCalls(fetchSpy).find((c) =>
      c.url.includes('/api/now/table/incident'),
    );
    expect(req).toBeDefined();
    expect(new URL(req!.url).searchParams.get('sysparm_query')).not.toContain(
      'state=',
    );
  });

  it('sends basic auth and routes to the configured instance', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector({
      resources: ['incidents'],
      instanceUrl: 'https://rawdash.service-now.com',
    }).sync({ mode: 'full' }, makeStorage());

    const call = recordCalls(fetchSpy)[0]!;
    expect(call.url).toContain(
      'https://rawdash.service-now.com/api/now/table/incident',
    );
    const expected = expectedBasicAuth(
      'rawdash.integration:SERVICENOW_PASSWORD',
    );
    expect(call.headers['authorization']).toBe(expected);
    expect(call.headers['accept']).toBe('application/json');
  });
});

describe('ServiceNowConnector.create', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('returns the connector instance directly', () => {
    vi.stubEnv('SERVICENOW_PASSWORD', 'test_password_fixture');
    const c = ServiceNowConnector.create({
      instanceUrl: 'acme.service-now.com',
      username: 'rawdash.integration',
      password: { $secret: 'SERVICENOW_PASSWORD' },
    });
    expect(c).toBeInstanceOf(ServiceNowConnector);
    expect(c.id).toBe('servicenow');
  });

  it('resolves the env-backed password into the outgoing auth header', async () => {
    vi.stubEnv('SERVICENOW_PASSWORD', 'test_password_fixture');
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    const c = ServiceNowConnector.create({
      instanceUrl: 'acme.service-now.com',
      username: 'rawdash.integration',
      password: { $secret: 'SERVICENOW_PASSWORD' },
      resources: ['incidents'],
    });
    await c.sync({ mode: 'full' }, makeStorage());

    const call = recordCalls(fetchSpy)[0]!;
    const expected = expectedBasicAuth(
      'rawdash.integration:test_password_fixture',
    );
    expect(call.headers['authorization']).toBe(expected);
  });
});
