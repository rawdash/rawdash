import { afterEach, describe, expect, it, vi } from 'vitest';

import { WizConnector, configFields } from './wiz';

describe('configFields', () => {
  it('parses a valid config', () => {
    const result = configFields.safeParse({
      apiEndpoint: 'https://api.us1.app.wiz.io/graphql',
      clientId: 'cid',
      clientSecret: { $secret: 'WIZ_CLIENT_SECRET' },
    });
    expect(result.success).toBe(true);
  });

  it('parses a config with optional overrides', () => {
    const result = configFields.safeParse({
      apiEndpoint: 'https://api.eu2.app.wiz.io/graphql',
      clientId: 'cid',
      clientSecret: { $secret: 'WIZ_CLIENT_SECRET' },
      tokenEndpoint: 'https://auth.gov.wiz.io/oauth/token',
      audience: 'beyond-api',
      resources: ['issues', 'issue_events'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a plain-string clientSecret', () => {
    const result = configFields.safeParse({
      apiEndpoint: 'https://api.us1.app.wiz.io/graphql',
      clientId: 'cid',
      clientSecret: 'plain',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-wiz.io API endpoint', () => {
    const result = configFields.safeParse({
      apiEndpoint: 'https://api.example.com/graphql',
      clientId: 'cid',
      clientSecret: { $secret: 'WIZ_CLIENT_SECRET' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown resource name', () => {
    const result = configFields.safeParse({
      apiEndpoint: 'https://api.us1.app.wiz.io/graphql',
      clientId: 'cid',
      clientSecret: { $secret: 'WIZ_CLIENT_SECRET' },
      resources: ['issues', 'rules'],
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

function emptyIssues(): unknown {
  return {
    data: {
      issues: {
        nodes: [],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    },
  };
}

function emptyVulns(): unknown {
  return {
    data: {
      vulnerabilityFindings: {
        nodes: [],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    },
  };
}

function isGraphqlRequest(url: string, body: unknown): boolean {
  if (!url.endsWith('/graphql')) {
    return false;
  }
  if (typeof body !== 'string') {
    return false;
  }
  return body.includes('query');
}

function graphqlQueryName(body: unknown): string | null {
  if (typeof body !== 'string') {
    return null;
  }
  if (body.includes('vulnerabilityFindings')) {
    return 'vulnerabilities';
  }
  if (body.includes('issues(')) {
    return 'issues';
  }
  return null;
}

function makeFetch(route: (req: MockCall) => unknown) {
  return vi.fn().mockImplementation((url: string | URL, init?: RequestInit) => {
    const u = typeof url === 'string' ? url : url.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = init?.body;
    const call: MockCall = { url: u, method, headers, body };
    const explicit = route(call);
    if (explicit !== undefined) {
      return Promise.resolve(jsonResponse(explicit));
    }
    if (u.includes('/oauth/token')) {
      return Promise.resolve(
        jsonResponse({ access_token: 'tok', expires_in: 3600 }),
      );
    }
    if (isGraphqlRequest(u, body)) {
      const kind = graphqlQueryName(body);
      if (kind === 'issues') {
        return Promise.resolve(jsonResponse(emptyIssues()));
      }
      if (kind === 'vulnerabilities') {
        return Promise.resolve(jsonResponse(emptyVulns()));
      }
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

const CLIENT_SECRET = 'WIZ_CLIENT_SECRET' as unknown as { $secret: string };

function connector(
  resources?: string[],
  overrides: { audience?: string; tokenEndpoint?: string } = {},
) {
  return new WizConnector(
    {
      apiEndpoint: 'https://api.us1.app.wiz.io/graphql',
      audience: overrides.audience,
      tokenEndpoint: overrides.tokenEndpoint,
      ...(resources ? { resources: resources as never } : {}),
    },
    { clientId: 'cid', clientSecret: CLIENT_SECRET },
  );
}

describe('WizConnector.sync', () => {
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

  it('mints an OAuth access token via client_credentials form post', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector().sync({ mode: 'full' }, makeStorage());

    const tokenCalls = recordCalls(fetchSpy).filter((c) =>
      c.url.includes('/oauth/token'),
    );
    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0]!.method).toBe('POST');
    const form = new URLSearchParams(String(tokenCalls[0]!.body));
    expect(form.get('grant_type')).toBe('client_credentials');
    expect(form.get('client_id')).toBe('cid');
    expect(form.get('client_secret')).toBe('WIZ_CLIENT_SECRET');
    expect(form.get('audience')).toBe('wiz-api');
  });

  it('overrides the audience and token endpoint when settings provide them', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector([], {
      audience: 'beyond-api',
      tokenEndpoint: 'https://auth.gov.wiz.io/oauth/token',
    }).sync({ mode: 'full' }, makeStorage());

    const tokenCall = recordCalls(fetchSpy).find((c) =>
      c.url.includes('/oauth/token'),
    );
    expect(tokenCall!.url).toBe('https://auth.gov.wiz.io/oauth/token');
    expect(new URLSearchParams(String(tokenCall!.body)).get('audience')).toBe(
      'beyond-api',
    );
  });

  it('sends the access token as a bearer authorization header on GraphQL calls', async () => {
    const fetchSpy = makeFetch((c) => {
      if (c.url.includes('/oauth/token')) {
        return { access_token: 'real_token', expires_in: 3600 };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    await connector(['issues']).sync({ mode: 'full' }, makeStorage());

    const gql = recordCalls(fetchSpy).find((c) => c.url.endsWith('/graphql'));
    expect(gql).toBeDefined();
    const auth = gql!.headers['Authorization'] ?? gql!.headers['authorization'];
    expect(auth).toBe('Bearer real_token');
  });

  it('writes a wiz_issue entity per issue node', async () => {
    const fetchSpy = makeFetch((c) => {
      if (graphqlQueryName(c.body) === 'issues') {
        return {
          data: {
            issues: {
              nodes: [
                {
                  id: 'issue_1',
                  severity: 'CRITICAL',
                  status: 'OPEN',
                  type: 'CLOUD_CONFIGURATION',
                  createdAt: '2025-01-01T00:00:00.000Z',
                  updatedAt: '2025-01-02T00:00:00.000Z',
                  resolvedAt: null,
                  dueAt: '2025-02-01T00:00:00.000Z',
                  sourceRule: { id: 'rule_1', name: 'Public S3 bucket' },
                  entitySnapshot: {
                    id: 'asset_1',
                    name: 'logs-prod',
                    type: 'BUCKET',
                    cloudProvider: 'AWS',
                    externalId: 'arn:aws:s3:::logs-prod',
                  },
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['issues']).sync({ mode: 'full' }, storage);

    expect(storage.entity).toHaveBeenCalledTimes(1);
    const entity = storage.entity.mock.calls[0]![0] as {
      type: string;
      id: string;
      attributes: {
        severity: string;
        status: string;
        cloudProvider: string;
        resourceName: string;
        resourceType: string;
        ruleName: string;
      };
      updated_at: number;
    };
    expect(entity.type).toBe('wiz_issue');
    expect(entity.id).toBe('issue_1');
    expect(entity.attributes.severity).toBe('CRITICAL');
    expect(entity.attributes.cloudProvider).toBe('AWS');
    expect(entity.attributes.resourceName).toBe('logs-prod');
    expect(entity.attributes.ruleName).toBe('Public S3 bucket');
    expect(entity.updated_at).toBe(Date.parse('2025-01-02T00:00:00.000Z'));
  });

  it('emits an opened event per issue and a resolved event when resolvedAt is set', async () => {
    const fetchSpy = makeFetch((c) => {
      if (graphqlQueryName(c.body) === 'issues') {
        return {
          data: {
            issues: {
              nodes: [
                {
                  id: 'issue_open',
                  severity: 'HIGH',
                  status: 'OPEN',
                  createdAt: '2025-01-01T00:00:00.000Z',
                  updatedAt: '2025-01-01T00:00:00.000Z',
                  resolvedAt: null,
                },
                {
                  id: 'issue_closed',
                  severity: 'LOW',
                  status: 'RESOLVED',
                  createdAt: '2025-01-02T00:00:00.000Z',
                  updatedAt: '2025-01-05T00:00:00.000Z',
                  resolvedAt: '2025-01-05T00:00:00.000Z',
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['issue_events']).sync({ mode: 'full' }, storage);

    expect(storage.event).toHaveBeenCalledTimes(3);
    const kinds = storage.event.mock.calls.map(
      (c) => (c[0] as { attributes: { kind: string } }).attributes.kind,
    );
    expect(kinds).toEqual(['opened', 'opened', 'resolved']);
    expect(storage.entity).not.toHaveBeenCalled();
  });

  it('writes both wiz_issue entities and wiz_issue_event events when both are enabled', async () => {
    const fetchSpy = makeFetch((c) => {
      if (graphqlQueryName(c.body) === 'issues') {
        return {
          data: {
            issues: {
              nodes: [
                {
                  id: 'issue_1',
                  severity: 'HIGH',
                  status: 'RESOLVED',
                  createdAt: '2025-01-01T00:00:00.000Z',
                  updatedAt: '2025-01-02T00:00:00.000Z',
                  resolvedAt: '2025-01-02T00:00:00.000Z',
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['issues', 'issue_events']).sync({ mode: 'full' }, storage);

    expect(storage.entity).toHaveBeenCalledTimes(1);
    expect(storage.event).toHaveBeenCalledTimes(2);
  });

  it('writes a wiz_vulnerability entity from a vulnerabilityFindings response', async () => {
    const fetchSpy = makeFetch((c) => {
      if (graphqlQueryName(c.body) === 'vulnerabilities') {
        return {
          data: {
            vulnerabilityFindings: {
              nodes: [
                {
                  id: 'vuln_1',
                  name: 'CVE-2024-1234',
                  severity: 'CRITICAL',
                  status: 'OPEN',
                  vulnerabilityExternalId: 'CVE-2024-1234',
                  firstDetectedAt: '2024-12-01T00:00:00.000Z',
                  lastDetectedAt: '2025-01-01T00:00:00.000Z',
                  resolvedAt: null,
                  vulnerableAsset: {
                    id: 'asset_1',
                    name: 'web-prod-1',
                    type: 'VIRTUAL_MACHINE',
                    cloudPlatform: 'AWS',
                  },
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['vulnerabilities']).sync({ mode: 'full' }, storage);

    expect(storage.entity).toHaveBeenCalledTimes(1);
    const entity = storage.entity.mock.calls[0]![0] as {
      type: string;
      id: string;
      attributes: {
        cve: string;
        severity: string;
        assetName: string;
        cloudPlatform: string;
      };
      updated_at: number;
    };
    expect(entity.type).toBe('wiz_vulnerability');
    expect(entity.id).toBe('vuln_1');
    expect(entity.attributes.cve).toBe('CVE-2024-1234');
    expect(entity.attributes.severity).toBe('CRITICAL');
    expect(entity.attributes.assetName).toBe('web-prod-1');
    expect(entity.updated_at).toBe(Date.parse('2025-01-01T00:00:00.000Z'));
  });

  it('only fetches the resources listed in settings.resources', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector(['vulnerabilities']).sync({ mode: 'full' }, makeStorage());

    const calls = recordCalls(fetchSpy).filter((c) =>
      c.url.endsWith('/graphql'),
    );
    expect(calls.length).toBeGreaterThanOrEqual(1);
    for (const c of calls) {
      const name = graphqlQueryName(c.body);
      expect(name).toBe('vulnerabilities');
    }
  });

  it('runs the issues phase when only issue_events is enabled', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector(['issue_events']).sync({ mode: 'full' }, makeStorage());

    const calls = recordCalls(fetchSpy).filter((c) =>
      c.url.endsWith('/graphql'),
    );
    expect(calls.some((c) => graphqlQueryName(c.body) === 'issues')).toBe(true);
    expect(
      calls.some((c) => graphqlQueryName(c.body) === 'vulnerabilities'),
    ).toBe(false);
  });

  it('clears entity scope on full sync but not on incremental', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetch(() => undefined),
    );
    const storage = makeStorage();
    await connector(['issues']).sync({ mode: 'full' }, storage);
    expect(storage.entities).toHaveBeenCalledWith([], { types: ['wiz_issue'] });

    storage.entities.mockClear();
    await connector(['issues']).sync(
      { mode: 'latest', since: '2025-01-01T00:00:00Z' },
      storage,
    );
    expect(storage.entities).not.toHaveBeenCalled();
  });

  it('clears event scope on full sync but not on incremental', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetch(() => undefined),
    );
    const storage = makeStorage();
    await connector(['issue_events']).sync({ mode: 'full' }, storage);
    expect(storage.events).toHaveBeenCalledWith([], {
      names: ['wiz_issue_event'],
    });

    storage.events.mockClear();
    await connector(['issue_events']).sync(
      { mode: 'latest', since: '2025-01-01T00:00:00Z' },
      storage,
    );
    expect(storage.events).not.toHaveBeenCalled();
  });

  it('pushes since into the issues filter as updatedAt.after', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector(['issues']).sync(
      { mode: 'latest', since: '2025-01-01T00:00:00.000Z' },
      makeStorage(),
    );

    const call = recordCalls(fetchSpy).find(
      (c) => graphqlQueryName(c.body) === 'issues',
    );
    expect(call).toBeDefined();
    const body = JSON.parse(String(call!.body)) as {
      variables: { filterBy?: { updatedAt?: { after?: string } } };
    };
    expect(body.variables.filterBy?.updatedAt?.after).toBe(
      '2025-01-01T00:00:00.000Z',
    );
  });

  it('drops lifecycle events older than the since bound', async () => {
    const fetchSpy = makeFetch((c) => {
      if (graphqlQueryName(c.body) === 'issues') {
        return {
          data: {
            issues: {
              nodes: [
                {
                  id: 'issue_old',
                  severity: 'LOW',
                  status: 'RESOLVED',
                  createdAt: '2024-01-01T00:00:00.000Z',
                  updatedAt: '2025-02-01T00:00:00.000Z',
                  resolvedAt: '2025-02-01T00:00:00.000Z',
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['issue_events']).sync(
      { mode: 'latest', since: '2025-01-01T00:00:00.000Z' },
      storage,
    );

    expect(storage.event).toHaveBeenCalledTimes(1);
    const onlyKind = (
      storage.event.mock.calls[0]![0] as { attributes: { kind: string } }
    ).attributes.kind;
    expect(onlyKind).toBe('resolved');
  });

  it('paginates issues via the GraphQL endCursor', async () => {
    let call = 0;
    const fetchSpy = vi
      .fn()
      .mockImplementation((url: string | URL, init?: RequestInit) => {
        const u = typeof url === 'string' ? url : url.toString();
        const body = init?.body;
        if (u.includes('/oauth/token')) {
          return Promise.resolve(
            jsonResponse({ access_token: 'tok', expires_in: 3600 }),
          );
        }
        if (graphqlQueryName(body) === 'issues') {
          call += 1;
          if (call === 1) {
            return Promise.resolve(
              jsonResponse({
                data: {
                  issues: {
                    nodes: [
                      {
                        id: 'a',
                        severity: 'LOW',
                        status: 'OPEN',
                        createdAt: '2025-01-01T00:00:00.000Z',
                        updatedAt: '2025-01-01T00:00:00.000Z',
                      },
                    ],
                    pageInfo: { hasNextPage: true, endCursor: 'cur1' },
                  },
                },
              }),
            );
          }
          return Promise.resolve(
            jsonResponse({
              data: {
                issues: {
                  nodes: [
                    {
                      id: 'b',
                      severity: 'LOW',
                      status: 'OPEN',
                      createdAt: '2025-01-02T00:00:00.000Z',
                      updatedAt: '2025-01-02T00:00:00.000Z',
                    },
                  ],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            }),
          );
        }
        return Promise.resolve(jsonResponse({}));
      });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['issues']).sync({ mode: 'full' }, storage);

    expect(call).toBe(2);
    expect(storage.entity).toHaveBeenCalledTimes(2);
    const second = JSON.parse(String(fetchSpy.mock.calls[2]![1].body));
    expect(second.variables.after).toBe('cur1');
  });

  it('stops paginating once a page is entirely older than since', async () => {
    let call = 0;
    const fetchSpy = vi
      .fn()
      .mockImplementation((url: string | URL, init?: RequestInit) => {
        const u = typeof url === 'string' ? url : url.toString();
        const body = init?.body;
        if (u.includes('/oauth/token')) {
          return Promise.resolve(
            jsonResponse({ access_token: 'tok', expires_in: 3600 }),
          );
        }
        if (graphqlQueryName(body) === 'issues') {
          call += 1;
          return Promise.resolve(
            jsonResponse({
              data: {
                issues: {
                  nodes: [
                    {
                      id: `old_${call}`,
                      severity: 'LOW',
                      status: 'OPEN',
                      createdAt: '2024-01-01T00:00:00.000Z',
                      updatedAt: '2024-01-01T00:00:00.000Z',
                    },
                  ],
                  pageInfo: { hasNextPage: true, endCursor: 'next' },
                },
              },
            }),
          );
        }
        return Promise.resolve(jsonResponse({}));
      });
    vi.stubGlobal('fetch', fetchSpy);

    await connector(['issues']).sync(
      { mode: 'latest', since: '2025-01-01T00:00:00.000Z' },
      makeStorage(),
    );

    expect(call).toBe(1);
  });

  it('surfaces GraphQL errors as a transient error on the sync result', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetch((c) => {
        if (graphqlQueryName(c.body) === 'issues') {
          return { errors: [{ message: 'access denied' }] };
        }
        return undefined;
      }),
    );

    const result = await connector(['issues']).sync(
      { mode: 'full' },
      makeStorage(),
    );
    expect(result.done).toBe(false);
    expect(
      String((result as { transientError?: unknown }).transientError),
    ).toMatch(/Wiz GraphQL error: access denied/);
  });

  it('resumes from a saved cursor, skipping earlier phases', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector().sync(
      { mode: 'full', cursor: { phase: 'vulnerabilities', page: null } },
      makeStorage(),
    );

    const calls = recordCalls(fetchSpy).filter((c) =>
      c.url.endsWith('/graphql'),
    );
    expect(calls.some((c) => graphqlQueryName(c.body) === 'issues')).toBe(
      false,
    );
    expect(
      calls.some((c) => graphqlQueryName(c.body) === 'vulnerabilities'),
    ).toBe(true);
  });
});

describe('WizConnector.create', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns a configured instance from JSON input', () => {
    vi.stubEnv('WIZ_CLIENT_SECRET', 'cs_test');
    const c = WizConnector.create({
      apiEndpoint: 'https://api.us1.app.wiz.io/graphql',
      clientId: 'cid',
      clientSecret: { $secret: 'WIZ_CLIENT_SECRET' },
    });
    expect(c).toBeInstanceOf(WizConnector);
    expect(c.id).toBe('wiz');
  });
});
