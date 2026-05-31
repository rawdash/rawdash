import { afterEach, describe, expect, it, vi } from 'vitest';

import { SalesforceConnector, configFields } from './salesforce';

// ---------------------------------------------------------------------------
// configFields
// ---------------------------------------------------------------------------

describe('configFields', () => {
  it('parses a valid full config', () => {
    const result = configFields.safeParse({
      clientId: '3MVG9_clientId',
      clientSecret: { $secret: 'SF_CLIENT_SECRET' },
      refreshToken: { $secret: 'SF_REFRESH_TOKEN' },
      instanceUrl: 'https://mycompany.my.salesforce.com',
    });
    expect(result.success).toBe(true);
  });

  it('parses a config with a resource list and api version', () => {
    const result = configFields.safeParse({
      clientId: '3MVG9_clientId',
      clientSecret: { $secret: 'SF_CLIENT_SECRET' },
      refreshToken: { $secret: 'SF_REFRESH_TOKEN' },
      instanceUrl: 'https://mycompany.my.salesforce.com',
      apiVersion: '60.0',
      resources: ['opportunities', 'opportunity_events'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a plain-string clientSecret', () => {
    const result = configFields.safeParse({
      clientId: '3MVG9_clientId',
      clientSecret: 'sk_plain',
      refreshToken: { $secret: 'SF_REFRESH_TOKEN' },
      instanceUrl: 'https://mycompany.my.salesforce.com',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown resource name', () => {
    const result = configFields.safeParse({
      clientId: '3MVG9_clientId',
      clientSecret: { $secret: 'SF_CLIENT_SECRET' },
      refreshToken: { $secret: 'SF_REFRESH_TOKEN' },
      instanceUrl: 'https://mycompany.my.salesforce.com',
      resources: ['opportunities', 'contracts'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-URL instanceUrl', () => {
    const result = configFields.safeParse({
      clientId: '3MVG9_clientId',
      clientSecret: { $secret: 'SF_CLIENT_SECRET' },
      refreshToken: { $secret: 'SF_REFRESH_TOKEN' },
      instanceUrl: 'not-a-url',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an apiVersion that is not <major>.<minor>', () => {
    const result = configFields.safeParse({
      clientId: '3MVG9_clientId',
      clientSecret: { $secret: 'SF_CLIENT_SECRET' },
      refreshToken: { $secret: 'SF_REFRESH_TOKEN' },
      instanceUrl: 'https://mycompany.my.salesforce.com',
      apiVersion: '60',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Fetch + storage mocks
// ---------------------------------------------------------------------------

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

function emptyQuery(): unknown {
  return { totalSize: 0, done: true, records: [] };
}

function makeFetch(route: (url: string, method: string) => unknown) {
  return vi.fn().mockImplementation((url: string | URL, init?: RequestInit) => {
    const u = typeof url === 'string' ? url : url.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    const explicit = route(u, method);
    if (explicit !== undefined) {
      return Promise.resolve(jsonResponse(explicit));
    }
    if (u.includes('/services/oauth2/token')) {
      return Promise.resolve(
        jsonResponse({ access_token: 'fake_access_token' }),
      );
    }
    return Promise.resolve(jsonResponse(emptyQuery()));
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

const CLIENT_SECRET = 'SF_CLIENT_SECRET' as unknown as { $secret: string };
const REFRESH_TOKEN = 'SF_REFRESH_TOKEN' as unknown as { $secret: string };

function connector(
  resources?: string[],
  overrides: { instanceUrl?: string; apiVersion?: string } = {},
) {
  return new SalesforceConnector(
    {
      instanceUrl:
        overrides.instanceUrl ?? 'https://mycompany.my.salesforce.com',
      apiVersion: overrides.apiVersion,
      ...(resources ? { resources: resources as never } : {}),
    },
    {
      clientId: '3MVG9_clientId',
      clientSecret: CLIENT_SECRET,
      refreshToken: REFRESH_TOKEN,
    },
  );
}

// ---------------------------------------------------------------------------
// sync — happy path
// ---------------------------------------------------------------------------

describe('SalesforceConnector.sync', () => {
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

  it('refreshes the access token once and reuses it across phases', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector().sync({ mode: 'full' }, makeStorage());

    const tokenCalls = recordCalls(fetchSpy).filter((c) =>
      c.url.includes('/services/oauth2/token'),
    );
    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0]!.method).toBe('POST');
    expect(String(tokenCalls[0]!.body)).toContain('grant_type=refresh_token');
    expect(String(tokenCalls[0]!.body)).toContain(
      'refresh_token=SF_REFRESH_TOKEN',
    );
    expect(String(tokenCalls[0]!.body)).toContain(
      'client_secret=SF_CLIENT_SECRET',
    );
  });

  it('sends the access token as a bearer authorization header on query calls', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector(['users']).sync({ mode: 'full' }, makeStorage());

    const queryCall = recordCalls(fetchSpy).find((c) =>
      c.url.includes('/services/data/'),
    );
    expect(queryCall).toBeDefined();
    expect(queryCall!.headers['authorization']).toBe(
      'Bearer fake_access_token',
    );
  });

  it('uses the default API version when none is configured', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector(['users']).sync({ mode: 'full' }, makeStorage());

    const queryCall = recordCalls(fetchSpy).find((c) =>
      c.url.includes('/services/data/'),
    );
    expect(queryCall!.url).toContain('/services/data/v59.0/query');
  });

  it('honors a custom API version', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector(['users'], { apiVersion: '60.0' }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const queryCall = recordCalls(fetchSpy).find((c) =>
      c.url.includes('/services/data/'),
    );
    expect(queryCall!.url).toContain('/services/data/v60.0/query');
  });

  it('writes an opportunity entity from a SOQL response', async () => {
    const fetchSpy = makeFetch((url, _method) => {
      if (url.includes('FROM+Opportunity')) {
        return {
          totalSize: 1,
          done: true,
          records: [
            {
              Id: '006xx0000000001',
              Name: 'Acme Annual',
              StageName: 'Closed Won',
              Amount: 50000,
              CloseDate: '2024-03-15',
              OwnerId: '005xx00000000A1',
              Probability: 100,
              ForecastCategoryName: 'Closed',
              IsClosed: true,
              IsWon: true,
              CreatedDate: '2024-01-01T00:00:00.000Z',
              LastModifiedDate: '2024-03-15T12:00:00.000Z',
            },
          ],
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['opportunities']).sync({ mode: 'full' }, storage);

    const entity = storage.entity.mock.calls[0]![0] as {
      type: string;
      id: string;
      attributes: { amount: number; stage: string; isWon: boolean };
      updated_at: number;
    };
    expect(entity.type).toBe('salesforce_opportunity');
    expect(entity.id).toBe('006xx0000000001');
    expect(entity.attributes.amount).toBe(50000);
    expect(entity.attributes.stage).toBe('Closed Won');
    expect(entity.attributes.isWon).toBe(true);
    expect(entity.updated_at).toBe(Date.parse('2024-03-15T12:00:00.000Z'));
  });

  it('emits opportunity stage-change events from OpportunityFieldHistory', async () => {
    const fetchSpy = makeFetch((url, _method) => {
      if (url.includes('FROM+OpportunityFieldHistory')) {
        return {
          totalSize: 2,
          done: true,
          records: [
            {
              Id: 'h_1',
              OpportunityId: 'opp_1',
              Field: 'StageName',
              OldValue: 'Prospecting',
              NewValue: 'Qualification',
              CreatedDate: '2024-02-01T00:00:00.000Z',
              CreatedById: 'user_1',
            },
            {
              Id: 'h_2',
              OpportunityId: 'opp_1',
              Field: 'StageName',
              OldValue: 'Qualification',
              NewValue: 'Closed Won',
              CreatedDate: '2024-02-10T00:00:00.000Z',
              CreatedById: 'user_2',
            },
          ],
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['opportunity_events']).sync({ mode: 'full' }, storage);

    expect(storage.event).toHaveBeenCalledTimes(2);
    const first = storage.event.mock.calls[0]![0] as {
      name: string;
      start_ts: number;
      attributes: { opportunityId: string; toStage: string };
    };
    expect(first.name).toBe('salesforce_opportunity_stage_change');
    expect(first.start_ts).toBe(Date.parse('2024-02-01T00:00:00.000Z'));
    expect(first.attributes.opportunityId).toBe('opp_1');
    expect(first.attributes.toStage).toBe('Qualification');
  });

  it('only fetches the resources listed in settings.resources', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector(['opportunities']).sync({ mode: 'full' }, makeStorage());

    const calls = recordCalls(fetchSpy);
    expect(
      calls.some(
        (c) =>
          c.url.includes('FROM+Opportunity') &&
          !c.url.includes('OpportunityFieldHistory'),
      ),
    ).toBe(true);
    expect(calls.some((c) => c.url.includes('FROM+Account'))).toBe(false);
    expect(calls.some((c) => c.url.includes('FROM+Lead'))).toBe(false);
    expect(calls.some((c) => c.url.includes('FROM+User'))).toBe(false);
  });

  it('clears entity scopes only on full sync, not on incremental', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetch(() => undefined),
    );
    const storage = makeStorage();
    await connector(['opportunities']).sync(
      { mode: 'latest', since: '2024-01-01T00:00:00Z' },
      storage,
    );
    expect(storage.entities).not.toHaveBeenCalled();
  });

  it('clears the opportunity_events scope only on full sync', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetch(() => undefined),
    );
    const storage = makeStorage();
    await connector(['opportunity_events']).sync(
      { mode: 'latest', since: '2024-01-01T00:00:00Z' },
      storage,
    );
    expect(storage.events).not.toHaveBeenCalled();
  });

  it('drops a millisecond suffix from since in the SOQL literal', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector(['accounts']).sync(
      { mode: 'latest', since: '2024-01-01T00:00:00.123Z' },
      makeStorage(),
    );

    const queryCall = recordCalls(fetchSpy).find((c) =>
      c.url.includes('FROM+Account'),
    );
    expect(queryCall).toBeDefined();
    const soql = new URL(queryCall!.url).searchParams.get('q')!;
    expect(soql).toContain('LastModifiedDate >= 2024-01-01T00:00:00Z');
    expect(soql).not.toContain('.123Z');
  });

  it('appends a since filter with AND when the SOQL already has a WHERE', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector(['opportunity_events']).sync(
      { mode: 'latest', since: '2024-01-01T00:00:00Z' },
      makeStorage(),
    );

    const queryCall = recordCalls(fetchSpy).find((c) =>
      c.url.includes('FROM+OpportunityFieldHistory'),
    );
    expect(queryCall).toBeDefined();
    const soql = new URL(queryCall!.url).searchParams.get('q')!;
    expect(soql).toContain("Field = 'StageName'");
    expect(soql).toContain('AND CreatedDate >= 2024-01-01T00:00:00Z');
  });

  it('paginates via nextRecordsUrl', async () => {
    let call = 0;
    const fetchSpy = vi
      .fn()
      .mockImplementation((url: string | URL, init?: RequestInit) => {
        const u = typeof url === 'string' ? url : url.toString();
        const method = (init?.method ?? 'GET').toUpperCase();
        if (u.includes('/services/oauth2/token')) {
          return Promise.resolve(
            jsonResponse({ access_token: 'fake_access_token' }),
          );
        }
        if (method !== 'GET') {
          return Promise.resolve(jsonResponse(emptyQuery()));
        }
        if (u.includes('FROM+Account') && !u.includes('/query/')) {
          call += 1;
          return Promise.resolve(
            jsonResponse({
              totalSize: 2,
              done: false,
              nextRecordsUrl: '/services/data/v59.0/query/01g-2000',
              records: [
                {
                  Id: 'a_1',
                  Name: 'Acme',
                  Industry: null,
                  AnnualRevenue: null,
                  OwnerId: null,
                  CreatedDate: '2024-01-01T00:00:00.000Z',
                  LastModifiedDate: '2024-01-02T00:00:00.000Z',
                },
              ],
            }),
          );
        }
        if (u.includes('/query/01g-2000')) {
          call += 1;
          return Promise.resolve(
            jsonResponse({
              totalSize: 2,
              done: true,
              records: [
                {
                  Id: 'a_2',
                  Name: 'Globex',
                  Industry: null,
                  AnnualRevenue: null,
                  OwnerId: null,
                  CreatedDate: '2024-01-03T00:00:00.000Z',
                  LastModifiedDate: '2024-01-04T00:00:00.000Z',
                },
              ],
            }),
          );
        }
        return Promise.resolve(jsonResponse(emptyQuery()));
      });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['accounts']).sync({ mode: 'full' }, storage);

    expect(call).toBe(2);
    const ids = storage.entity.mock.calls.map(
      (c) => (c[0] as { id: string }).id,
    );
    expect(ids).toEqual(['a_1', 'a_2']);
  });

  it('resumes from a saved cursor, skipping earlier phases', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector().sync(
      {
        mode: 'full',
        cursor: {
          phase: 'opportunities',
          page: '/services/data/v59.0/query/01g-2000',
        },
      },
      makeStorage(),
    );

    const calls = recordCalls(fetchSpy);
    expect(calls.some((c) => c.url.includes('FROM+User'))).toBe(false);
    expect(calls.some((c) => c.url.includes('FROM+Account'))).toBe(false);
    expect(calls.some((c) => c.url.includes('FROM+Lead'))).toBe(false);
    const opportunityCall = calls.find((c) =>
      c.url.includes('/services/data/v59.0/query/01g-2000'),
    );
    expect(opportunityCall).toBeDefined();
  });

  it('ignores an absolute nextRecordsUrl that does not point at /services/data', async () => {
    let lastPath = '';
    const fetchSpy = vi
      .fn()
      .mockImplementation((url: string | URL, init?: RequestInit) => {
        const u = typeof url === 'string' ? url : url.toString();
        const method = (init?.method ?? 'GET').toUpperCase();
        if (u.includes('/services/oauth2/token')) {
          return Promise.resolve(
            jsonResponse({ access_token: 'fake_access_token' }),
          );
        }
        if (method !== 'GET') {
          return Promise.resolve(jsonResponse(emptyQuery()));
        }
        if (u.includes('FROM+User')) {
          lastPath = u;
          return Promise.resolve(
            jsonResponse({
              totalSize: 1,
              done: false,
              nextRecordsUrl: 'https://evil.example.com/leak',
              records: [{ Id: 'u_1', Name: 'A', Email: null, IsActive: true }],
            }),
          );
        }
        return Promise.resolve(jsonResponse(emptyQuery()));
      });
    vi.stubGlobal('fetch', fetchSpy);

    await connector(['users']).sync({ mode: 'full' }, makeStorage());

    expect(lastPath).toContain('FROM+User');
    expect(
      recordCalls(fetchSpy).some((c) => c.url.includes('evil.example.com')),
    ).toBe(false);
  });

  it('never issues a request for a resumed cursor page that points off the /services/data path', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    const result = await connector().sync(
      {
        mode: 'full',
        cursor: {
          phase: 'opportunities',
          page: 'https://evil.example.com/leak',
        },
      },
      makeStorage(),
    );

    expect((result.transientError as Error | undefined)?.message).toMatch(
      /Invalid Salesforce cursor page/,
    );
    expect(
      recordCalls(fetchSpy).some((c) => c.url.includes('evil.example.com')),
    ).toBe(false);
  });

  it('strips a trailing slash on instanceUrl when building URLs', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector(['users'], {
      instanceUrl: 'https://mycompany.my.salesforce.com/',
    }).sync({ mode: 'full' }, makeStorage());

    const calls = recordCalls(fetchSpy);
    expect(
      calls.every(
        (c) =>
          !c.url.includes('salesforce.com//') ||
          c.url.includes('://') === false,
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// static create
// ---------------------------------------------------------------------------

describe('SalesforceConnector.create', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns a configured instance from JSON input', () => {
    vi.stubEnv('SF_CLIENT_SECRET', 'cs_test');
    vi.stubEnv('SF_REFRESH_TOKEN', 'rt_test');
    const c = SalesforceConnector.create({
      clientId: '3MVG9_clientId',
      clientSecret: { $secret: 'SF_CLIENT_SECRET' },
      refreshToken: { $secret: 'SF_REFRESH_TOKEN' },
      instanceUrl: 'https://mycompany.my.salesforce.com',
    });
    expect(c).toBeInstanceOf(SalesforceConnector);
    expect(c.id).toBe('salesforce');
  });
});
