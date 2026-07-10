import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  JiraServiceManagementConnector,
  configFields,
} from './jira-service-management';

describe('configFields', () => {
  const valid = {
    email: 'you@yourorg.com',
    apiToken: { $secret: 'JIRA_API_TOKEN' },
    host: 'yourorg.atlassian.net',
  };

  it('parses a valid minimal config', () => {
    expect(configFields.safeParse(valid).success).toBe(true);
  });

  it('parses a config with project keys and explicit resources', () => {
    expect(
      configFields.safeParse({
        ...valid,
        projectKeys: ['IT', 'HELP'],
        resources: ['requests', 'sla_breaches'],
      }).success,
    ).toBe(true);
  });

  it('rejects a host that contains a protocol or path', () => {
    expect(
      configFields.safeParse({
        ...valid,
        host: 'https://yourorg.atlassian.net',
      }).success,
    ).toBe(false);
    expect(
      configFields.safeParse({ ...valid, host: 'yourorg.atlassian.net/jira' })
        .success,
    ).toBe(false);
  });

  it('rejects a plain string token instead of a secret object', () => {
    expect(configFields.safeParse({ ...valid, apiToken: 'abc' }).success).toBe(
      false,
    );
  });

  it('rejects an unknown resource', () => {
    expect(
      configFields.safeParse({ ...valid, resources: ['requests', 'tickets'] })
        .success,
    ).toBe(false);
  });

  it('rejects a config missing required fields', () => {
    expect(configFields.safeParse({}).success).toBe(false);
  });
});

interface MockCall {
  url: string;
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

function makeFetch(route: (url: string) => unknown) {
  return vi.fn().mockImplementation((url: string | URL) => {
    const u = typeof url === 'string' ? url : url.toString();
    const explicit = route(u);
    return Promise.resolve(
      jsonResponse(explicit === undefined ? {} : explicit),
    );
  });
}

function recordCalls(spy: ReturnType<typeof vi.fn>): MockCall[] {
  return spy.mock.calls.map((c: unknown[]) => {
    const init = (c[1] ?? {}) as RequestInit;
    return {
      url: String(c[0]),
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

const TOKEN = 'JIRA_API_TOKEN' as unknown as { $secret: string };

function connector(overrides: { resources?: string[] } = {}) {
  return new JiraServiceManagementConnector(
    {
      host: 'yourorg.atlassian.net',
      ...(overrides.resources
        ? { resources: overrides.resources as never }
        : {}),
    },
    { email: 'agent@yourorg.com', apiToken: TOKEN },
  );
}

const SLA_FIELD = 'customfield_10030';
const REQUEST_TYPE_FIELD = 'customfield_10010';

const FIELD_LIST = [
  { id: 'summary', name: 'Summary' },
  {
    id: SLA_FIELD,
    name: 'Time to resolution',
    schema: { custom: 'com.atlassian.servicedesk:sd-sla-field' },
  },
  {
    id: REQUEST_TYPE_FIELD,
    name: 'Request Type',
    schema: { custom: 'com.atlassian.servicedesk:vp-origin' },
  },
];

function sampleIssue() {
  return {
    id: '1001',
    key: 'IT-42',
    fields: {
      summary: 'Laptop will not boot',
      status: {
        name: 'Waiting for support',
        statusCategory: { key: 'indeterminate', name: 'In Progress' },
      },
      priority: { name: 'High' },
      issuetype: { name: 'Service Request' },
      assignee: { accountId: 'acc-agent', displayName: 'Agent A' },
      reporter: { accountId: 'acc-user', displayName: 'User U' },
      project: { id: '900', key: 'IT' },
      created: '2026-01-01T09:00:00.000Z',
      updated: '2026-01-02T09:00:00.000Z',
      resolutiondate: '2026-01-02T09:00:00.000Z',
      [REQUEST_TYPE_FIELD]: { requestType: { id: 'rt1', name: 'Get IT help' } },
      [SLA_FIELD]: {
        completedCycles: [
          {
            startTime: { epochMillis: 1735722000000 },
            stopTime: { epochMillis: 1735808400000 },
            breached: true,
            goalDuration: { millis: 28800000 },
            elapsedTime: { millis: 86400000 },
          },
        ],
      },
      changelog: undefined,
    },
    changelog: {
      histories: [
        {
          id: 'h1',
          created: '2026-01-02T09:00:00.000Z',
          author: { accountId: 'acc-agent' },
          items: [
            {
              field: 'status',
              fromString: 'Open',
              toString: 'Waiting for support',
            },
            { field: 'assignee', fromString: null, toString: 'Agent A' },
          ],
        },
      ],
    },
  };
}

function fullSyncFetch() {
  return makeFetch((url) => {
    if (url.includes('/rest/servicedeskapi/servicedesk')) {
      return {
        values: [
          { id: '5', projectId: 900, projectKey: 'IT', projectName: 'IT Help' },
        ],
        isLastPage: true,
      };
    }
    if (url.includes('/rest/api/3/field')) {
      return FIELD_LIST;
    }
    if (url.includes('/rest/api/3/search/jql')) {
      return { issues: [sampleIssue()], isLast: true };
    }
    return {};
  });
}

describe('JiraServiceManagementConnector.sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns done:true and clears every scope on an empty full sync', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetch(() => ({})),
    );
    const storage = makeStorage();
    const result = await connector().sync({ mode: 'full' }, storage);
    expect(result.done).toBe(true);

    const clearedTypes = storage.entities.mock.calls
      .filter((c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0)
      .map((c) => (c[1] as { types: string[] }).types[0]);
    expect(clearedTypes).toContain('jsm_service_desk');
    expect(clearedTypes).toContain('jsm_request');

    const clearedEvents = storage.events.mock.calls.map(
      (c) => (c[1] as { names: string[] }).names[0],
    );
    expect(clearedEvents).toContain('jsm_request_status_change');
    expect(clearedEvents).toContain('jsm_sla_cycle');
  });

  it('sends Basic auth with the account email and token', async () => {
    const fetchSpy = fullSyncFetch();
    vi.stubGlobal('fetch', fetchSpy);
    await connector().sync({ mode: 'full' }, makeStorage());
    const auth = recordCalls(fetchSpy)
      .map((c) => c.headers['authorization'])
      .find((v) => typeof v === 'string');
    expect(auth).toBe(`Basic ${btoa('agent@yourorg.com:JIRA_API_TOKEN')}`);
  });

  it('writes a service desk entity from the Service Desk API', async () => {
    vi.stubGlobal('fetch', fullSyncFetch());
    const storage = makeStorage();
    await connector({ resources: ['service_desks'] }).sync(
      { mode: 'full' },
      storage,
    );
    const desk = storage.entity.mock.calls
      .map((c) => c[0] as { type: string; id: string; attributes: unknown })
      .find((e) => e.type === 'jsm_service_desk');
    expect(desk).toMatchObject({
      id: '5',
      attributes: {
        projectKey: 'IT',
        projectName: 'IT Help',
        projectId: '900',
      },
    });
  });

  it('writes a request entity with mapped status, priority, and request type', async () => {
    vi.stubGlobal('fetch', fullSyncFetch());
    const storage = makeStorage();
    await connector({ resources: ['requests'] }).sync(
      { mode: 'full' },
      storage,
    );
    const request = storage.entity.mock.calls
      .map((c) => c[0] as { type: string; attributes: Record<string, unknown> })
      .find((e) => e.type === 'jsm_request');
    expect(request?.attributes).toMatchObject({
      key: 'IT-42',
      summary: 'Laptop will not boot',
      statusName: 'Waiting for support',
      statusCategory: 'indeterminate',
      priority: 'High',
      requestType: 'Get IT help',
      issueType: 'Service Request',
      assigneeId: 'acc-agent',
      reporterId: 'acc-user',
      projectKey: 'IT',
    });
    expect(request?.attributes.resolvedAt).toBe(
      Date.parse('2026-01-02T09:00:00.000Z'),
    );
  });

  it('derives status-change events from the request changelog', async () => {
    vi.stubGlobal('fetch', fullSyncFetch());
    const storage = makeStorage();
    await connector({ resources: ['request_events'] }).sync(
      { mode: 'full' },
      storage,
    );
    const statusEvents = storage.event.mock.calls
      .map((c) => c[0] as { name: string; attributes: Record<string, unknown> })
      .filter((e) => e.name === 'jsm_request_status_change');
    expect(statusEvents).toHaveLength(1);
    expect(statusEvents[0]!.attributes).toMatchObject({
      requestKey: 'IT-42',
      fromStatus: 'Open',
      toStatus: 'Waiting for support',
    });
  });

  it('emits an SLA cycle event flagged as breached', async () => {
    vi.stubGlobal('fetch', fullSyncFetch());
    const storage = makeStorage();
    await connector({ resources: ['sla_breaches'] }).sync(
      { mode: 'full' },
      storage,
    );
    const slaEvents = storage.event.mock.calls
      .map(
        (c) =>
          c[0] as {
            name: string;
            start_ts: number;
            attributes: Record<string, unknown>;
          },
      )
      .filter((e) => e.name === 'jsm_sla_cycle');
    expect(slaEvents).toHaveLength(1);
    expect(slaEvents[0]!.start_ts).toBe(1735808400000);
    expect(slaEvents[0]!.attributes).toMatchObject({
      slaName: 'Time to resolution',
      breached: 1,
      requestKey: 'IT-42',
      goalMs: 28800000,
    });
  });

  it('scopes the JQL to discovered service desk projects and filters by updated on an incremental tick', async () => {
    const fetchSpy = fullSyncFetch();
    vi.stubGlobal('fetch', fetchSpy);
    await connector({ resources: ['requests'] }).sync(
      { mode: 'latest', since: '2026-01-01T00:00:00.000Z' },
      makeStorage(),
    );
    const jqlCall = recordCalls(fetchSpy).find((c) =>
      c.url.includes('/rest/api/3/search/jql'),
    );
    expect(jqlCall).toBeDefined();
    const jql = decodeURIComponent(
      new URL(jqlCall!.url).searchParams.get('jql') ?? '',
    );
    expect(jql).toContain('project in ("IT")');
    expect(jql).toContain('updated >=');
    expect(jql).toContain('ORDER BY updated ASC');
  });

  it('does not re-emit old changelog transitions on an incremental tick', async () => {
    vi.stubGlobal('fetch', fullSyncFetch());
    const storage = makeStorage();
    await connector({ resources: ['request_events'] }).sync(
      { mode: 'latest', since: '2026-06-01T00:00:00.000Z' },
      storage,
    );
    const statusEvents = storage.event.mock.calls
      .map((c) => c[0] as { name: string })
      .filter((e) => e.name === 'jsm_request_status_change');
    expect(statusEvents).toHaveLength(0);
  });

  it('honours explicit projectKeys without enumerating service desks', async () => {
    const fetchSpy = fullSyncFetch();
    vi.stubGlobal('fetch', fetchSpy);
    const c = new JiraServiceManagementConnector(
      {
        host: 'yourorg.atlassian.net',
        projectKeys: ['HELP'],
        resources: ['requests'],
      },
      { email: 'agent@yourorg.com', apiToken: TOKEN },
    );
    await c.sync({ mode: 'full' }, makeStorage());
    const calledServiceDesk = recordCalls(fetchSpy).some((c) =>
      c.url.includes('/rest/servicedeskapi/servicedesk'),
    );
    expect(calledServiceDesk).toBe(false);
    const jqlCall = recordCalls(fetchSpy).find((c) =>
      c.url.includes('/rest/api/3/search/jql'),
    );
    const jql = decodeURIComponent(
      new URL(jqlCall!.url).searchParams.get('jql') ?? '',
    );
    expect(jql).toContain('project in ("HELP")');
  });
});
