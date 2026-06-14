import { afterEach, describe, expect, it, vi } from 'vitest';

import { EntraIdConnector, configFields } from './entra-id';

describe('configFields', () => {
  it('parses a valid config with a GUID tenant', () => {
    const result = configFields.safeParse({
      tenantId: '00000000-0000-0000-0000-000000000000',
      clientId: '11111111-1111-1111-1111-111111111111',
      clientSecret: { $secret: 'ENTRA_CLIENT_SECRET' },
    });
    expect(result.success).toBe(true);
  });

  it('parses a verified-domain tenant', () => {
    const result = configFields.safeParse({
      tenantId: 'contoso.onmicrosoft.com',
      clientId: 'abc',
      clientSecret: { $secret: 'ENTRA_CLIENT_SECRET' },
    });
    expect(result.success).toBe(true);
  });

  it('parses a config with a resources allowlist and signins lookback', () => {
    const result = configFields.safeParse({
      tenantId: 'contoso.onmicrosoft.com',
      clientId: 'abc',
      clientSecret: { $secret: 'ENTRA_CLIENT_SECRET' },
      resources: ['users', 'signins'],
      signinsLookbackDays: 14,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a plain-string clientSecret', () => {
    const result = configFields.safeParse({
      tenantId: 'contoso.onmicrosoft.com',
      clientId: 'abc',
      clientSecret: 'plain',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a tenant id with a slash', () => {
    const result = configFields.safeParse({
      tenantId: 'contoso/evil',
      clientId: 'abc',
      clientSecret: { $secret: 'ENTRA_CLIENT_SECRET' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown resource name', () => {
    const result = configFields.safeParse({
      tenantId: 'contoso.onmicrosoft.com',
      clientId: 'abc',
      clientSecret: { $secret: 'ENTRA_CLIENT_SECRET' },
      resources: ['users', 'apps'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a signinsLookbackDays above 30', () => {
    const result = configFields.safeParse({
      tenantId: 'contoso.onmicrosoft.com',
      clientId: 'abc',
      clientSecret: { $secret: 'ENTRA_CLIENT_SECRET' },
      signinsLookbackDays: 60,
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

function makeFetch(route: (url: string, method: string) => unknown) {
  return vi.fn().mockImplementation((url: string | URL, init?: RequestInit) => {
    const u = typeof url === 'string' ? url : url.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    const explicit = route(u, method);
    if (explicit !== undefined) {
      return Promise.resolve(jsonResponse(explicit));
    }
    if (u.includes('/oauth2/v2.0/token')) {
      return Promise.resolve(jsonResponse({ access_token: 'tok' }));
    }
    if (u.includes('/v1.0/users')) {
      return Promise.resolve(jsonResponse({ value: [] }));
    }
    if (u.includes('/v1.0/auditLogs/signIns')) {
      return Promise.resolve(jsonResponse({ value: [] }));
    }
    if (u.includes('/v1.0/identityProtection/riskyUsers')) {
      return Promise.resolve(jsonResponse({ value: [] }));
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

const CLIENT_SECRET = 'ENTRA_CLIENT_SECRET' as unknown as { $secret: string };

function connector(
  resources?: string[],
  overrides: { tenantId?: string; signinsLookbackDays?: number } = {},
) {
  return new EntraIdConnector(
    {
      tenantId: overrides.tenantId ?? 'contoso.onmicrosoft.com',
      signinsLookbackDays: overrides.signinsLookbackDays,
      ...(resources ? { resources: resources as never } : {}),
    },
    {
      clientId: 'AbCdEf',
      clientSecret: CLIENT_SECRET,
    },
  );
}

describe('EntraIdConnector.sync', () => {
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

  it('mints an access token once and reuses it across phases', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector().sync({ mode: 'full' }, makeStorage());

    const tokenCalls = recordCalls(fetchSpy).filter((c) =>
      c.url.includes('/oauth2/v2.0/token'),
    );
    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0]!.method).toBe('POST');
    const params = new URLSearchParams(String(tokenCalls[0]!.body));
    expect(params.get('grant_type')).toBe('client_credentials');
    expect(params.get('client_id')).toBe('AbCdEf');
    expect(params.get('client_secret')).toBe('ENTRA_CLIENT_SECRET');
    expect(params.get('scope')).toBe('https://graph.microsoft.com/.default');
  });

  it('hits the tenant-scoped token endpoint', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector(['users'], {
      tenantId: '12345678-1234-1234-1234-1234567890ab',
    }).sync({ mode: 'full' }, makeStorage());

    const tokenCall = recordCalls(fetchSpy).find((c) =>
      c.url.includes('/oauth2/v2.0/token'),
    );
    expect(tokenCall).toBeDefined();
    expect(tokenCall!.url).toBe(
      'https://login.microsoftonline.com/12345678-1234-1234-1234-1234567890ab/oauth2/v2.0/token',
    );
  });

  it('sends the access token as a bearer authorization header on API calls', async () => {
    const fetchSpy = makeFetch((u) => {
      if (u.includes('/oauth2/v2.0/token')) {
        return { access_token: 'real_access_token' };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    await connector(['users']).sync({ mode: 'full' }, makeStorage());

    const apiCall = recordCalls(fetchSpy).find((c) =>
      c.url.includes('graph.microsoft.com/v1.0/users'),
    );
    expect(apiCall).toBeDefined();
    const authHeader =
      apiCall!.headers['Authorization'] ?? apiCall!.headers['authorization'];
    expect(authHeader).toBe('Bearer real_access_token');
  });

  it('writes a user entity from a users response', async () => {
    const fetchSpy = makeFetch((u) => {
      if (u.includes('/v1.0/users')) {
        return {
          value: [
            {
              id: 'user-1',
              displayName: 'Alice Example',
              userPrincipalName: 'alice@contoso.com',
              mail: 'alice@contoso.com',
              accountEnabled: true,
              userType: 'Member',
              createdDateTime: '2024-01-01T00:00:00Z',
            },
          ],
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['users']).sync({ mode: 'full' }, storage);

    expect(storage.entity).toHaveBeenCalledTimes(1);
    const entity = storage.entity.mock.calls[0]![0] as {
      type: string;
      id: string;
      attributes: {
        displayName: string;
        userPrincipalName: string;
        mail: string;
        accountEnabled: boolean;
        userType: string;
        createdAt: number;
      };
      updated_at: number;
    };
    expect(entity.type).toBe('entra_user');
    expect(entity.id).toBe('user-1');
    expect(entity.attributes.displayName).toBe('Alice Example');
    expect(entity.attributes.userPrincipalName).toBe('alice@contoso.com');
    expect(entity.attributes.accountEnabled).toBe(true);
    expect(entity.attributes.userType).toBe('Member');
    expect(entity.attributes.createdAt).toBe(
      Date.parse('2024-01-01T00:00:00Z'),
    );
  });

  it('emits a sign-in event per audit log row and classifies status', async () => {
    const fetchSpy = makeFetch((u) => {
      if (u.includes('/v1.0/auditLogs/signIns')) {
        return {
          value: [
            {
              id: 'signin-1',
              createdDateTime: '2024-02-01T00:00:00Z',
              userId: 'user-1',
              userPrincipalName: 'alice@contoso.com',
              appId: 'app-1',
              appDisplayName: 'Office',
              ipAddress: '203.0.113.10',
              clientAppUsed: 'Browser',
              riskLevelAggregated: 'none',
              riskState: 'none',
              status: { errorCode: 0 },
              location: {
                city: 'Seattle',
                state: 'WA',
                countryOrRegion: 'US',
              },
            },
            {
              id: 'signin-2',
              createdDateTime: '2024-02-02T00:00:00Z',
              userId: 'user-2',
              status: {
                errorCode: 50126,
                failureReason: 'Invalid credentials',
              },
            },
          ],
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['signins']).sync({ mode: 'full' }, storage);

    expect(storage.event).toHaveBeenCalledTimes(2);
    const success = storage.event.mock.calls[0]![0] as {
      name: string;
      start_ts: number;
      attributes: {
        status: string;
        errorCode: number | null;
        countryOrRegion: string;
      };
    };
    expect(success.name).toBe('entra_signin_event');
    expect(success.start_ts).toBe(Date.parse('2024-02-01T00:00:00Z'));
    expect(success.attributes.status).toBe('success');
    expect(success.attributes.errorCode).toBe(0);
    expect(success.attributes.countryOrRegion).toBe('US');

    const failure = storage.event.mock.calls[1]![0] as {
      attributes: { status: string; errorCode: number | null };
    };
    expect(failure.attributes.status).toBe('failure');
    expect(failure.attributes.errorCode).toBe(50126);
  });

  it('writes a risky-user entity from the identityProtection response', async () => {
    const fetchSpy = makeFetch((u) => {
      if (u.includes('/identityProtection/riskyUsers')) {
        return {
          value: [
            {
              id: 'user-9',
              userPrincipalName: 'bob@contoso.com',
              userDisplayName: 'Bob Risky',
              riskLevel: 'high',
              riskState: 'atRisk',
              riskDetail: 'aiConfirmedSigninCompromised',
              riskLastUpdatedDateTime: '2024-03-01T00:00:00Z',
              isProcessing: false,
              isDeleted: false,
            },
          ],
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['risky_users']).sync({ mode: 'full' }, storage);

    expect(storage.entity).toHaveBeenCalledTimes(1);
    const entity = storage.entity.mock.calls[0]![0] as {
      type: string;
      id: string;
      attributes: {
        riskLevel: string;
        riskState: string;
        riskLastUpdatedAt: number;
      };
    };
    expect(entity.type).toBe('entra_risky_user');
    expect(entity.id).toBe('user-9');
    expect(entity.attributes.riskLevel).toBe('high');
    expect(entity.attributes.riskState).toBe('atRisk');
    expect(entity.attributes.riskLastUpdatedAt).toBe(
      Date.parse('2024-03-01T00:00:00Z'),
    );
  });

  it('only fetches the resources listed in settings.resources', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector(['users']).sync({ mode: 'full' }, makeStorage());

    const calls = recordCalls(fetchSpy);
    expect(
      calls.some((c) => c.url.includes('graph.microsoft.com/v1.0/users')),
    ).toBe(true);
    expect(calls.some((c) => c.url.includes('/auditLogs/signIns'))).toBe(false);
    expect(calls.some((c) => c.url.includes('/identityProtection'))).toBe(
      false,
    );
  });

  it('does not clear entity scopes on incremental sync', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetch(() => undefined),
    );
    const storage = makeStorage();
    await connector(['users']).sync(
      { mode: 'latest', since: '2024-01-01T00:00:00Z' },
      storage,
    );
    expect(storage.entities).not.toHaveBeenCalled();
  });

  it('clears the signin event scope on full sync only', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetch(() => undefined),
    );
    const storage = makeStorage();
    await connector(['signins']).sync(
      { mode: 'latest', since: '2024-01-01T00:00:00Z' },
      storage,
    );
    expect(storage.events).not.toHaveBeenCalled();
  });

  it('pushes a since filter into the signins $filter parameter', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector(['signins']).sync(
      { mode: 'latest', since: '2024-04-01T00:00:00.000Z' },
      makeStorage(),
    );

    const queryCall = recordCalls(fetchSpy).find((c) =>
      c.url.includes('/auditLogs/signIns'),
    );
    expect(queryCall).toBeDefined();
    const filter = new URL(queryCall!.url).searchParams.get('$filter');
    expect(filter).toContain('createdDateTime ge');
    expect(filter).toContain('2024-04-01T00:00:00.000Z');
  });

  it('drops sign-in events at or before options.since', async () => {
    const fetchSpy = makeFetch((u) => {
      if (u.includes('/auditLogs/signIns')) {
        return {
          value: [
            {
              id: 'signin-old',
              createdDateTime: '2024-04-01T00:00:00Z',
              status: { errorCode: 0 },
            },
            {
              id: 'signin-new',
              createdDateTime: '2024-04-02T00:00:00Z',
              status: { errorCode: 0 },
            },
          ],
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['signins']).sync(
      { mode: 'latest', since: '2024-04-01T00:00:00.000Z' },
      storage,
    );

    expect(storage.event).toHaveBeenCalledTimes(1);
    const ev = storage.event.mock.calls[0]![0] as {
      attributes: { signinId: string };
    };
    expect(ev.attributes.signinId).toBe('signin-new');
  });

  it('follows @odata.nextLink for paginated users', async () => {
    let call = 0;
    const fetchSpy = vi
      .fn()
      .mockImplementation((url: string | URL, init?: RequestInit) => {
        const u = typeof url === 'string' ? url : url.toString();
        const method = (init?.method ?? 'GET').toUpperCase();
        if (u.includes('/oauth2/v2.0/token')) {
          return Promise.resolve(jsonResponse({ access_token: 'tok' }));
        }
        if (method === 'GET' && u.includes('/v1.0/users')) {
          call += 1;
          if (call === 1) {
            return Promise.resolve(
              jsonResponse({
                '@odata.nextLink':
                  'https://graph.microsoft.com/v1.0/users?$skiptoken=abc',
                value: [
                  {
                    id: 'user-1',
                    displayName: 'A',
                    accountEnabled: true,
                  },
                ],
              }),
            );
          }
          return Promise.resolve(
            jsonResponse({
              value: [
                {
                  id: 'user-2',
                  displayName: 'B',
                  accountEnabled: true,
                },
              ],
            }),
          );
        }
        return Promise.resolve(jsonResponse({}));
      });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['users']).sync({ mode: 'full' }, storage);

    expect(call).toBe(2);
    expect(storage.entity).toHaveBeenCalledTimes(2);
  });

  it('drops a forged @odata.nextLink that points off-host', async () => {
    let call = 0;
    const fetchSpy = vi
      .fn()
      .mockImplementation((url: string | URL, init?: RequestInit) => {
        const u = typeof url === 'string' ? url : url.toString();
        const method = (init?.method ?? 'GET').toUpperCase();
        if (u.includes('/oauth2/v2.0/token')) {
          return Promise.resolve(jsonResponse({ access_token: 'tok' }));
        }
        if (method === 'GET' && u.includes('/v1.0/users')) {
          call += 1;
          return Promise.resolve(
            jsonResponse({
              '@odata.nextLink': 'https://evil.example.com/v1.0/users',
              value: [
                {
                  id: `user-${call}`,
                  accountEnabled: true,
                },
              ],
            }),
          );
        }
        return Promise.resolve(jsonResponse({}));
      });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['users']).sync({ mode: 'full' }, storage);

    expect(call).toBe(1);
    expect(storage.entity).toHaveBeenCalledTimes(1);
  });

  it('resumes from a saved cursor, skipping earlier phases', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector().sync(
      { mode: 'full', cursor: { phase: 'signins', page: null } },
      makeStorage(),
    );

    const calls = recordCalls(fetchSpy);
    expect(
      calls.some((c) => c.url.includes('graph.microsoft.com/v1.0/users')),
    ).toBe(false);
    expect(calls.some((c) => c.url.includes('/auditLogs/signIns'))).toBe(true);
  });

  it('caps signins lookback at the configured number of days', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    const before = Date.now();
    await connector(['signins'], { signinsLookbackDays: 3 }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const signinCall = recordCalls(fetchSpy).find((c) =>
      c.url.includes('/auditLogs/signIns'),
    );
    expect(signinCall).toBeDefined();
    const filter = new URL(signinCall!.url).searchParams.get('$filter')!;
    const match = filter.match(/createdDateTime ge (.+)$/);
    expect(match).not.toBeNull();
    const sinceMs = Date.parse(match![1]!);
    const expected = before - 3 * 24 * 60 * 60 * 1000;
    expect(Math.abs(sinceMs - expected)).toBeLessThan(5_000);
  });
});

describe('EntraIdConnector.create', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns a configured instance from JSON input', () => {
    vi.stubEnv('ENTRA_CLIENT_SECRET', 'cs_test');
    const c = EntraIdConnector.create({
      tenantId: 'contoso.onmicrosoft.com',
      clientId: 'AbCdEf',
      clientSecret: { $secret: 'ENTRA_CLIENT_SECRET' },
    });
    expect(c).toBeInstanceOf(EntraIdConnector);
    expect(c.id).toBe('entra-id');
  });
});
