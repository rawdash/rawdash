import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdpConnector, configFields } from './adp';

describe('configFields', () => {
  const base = {
    clientId: 'client-1',
    clientSecret: { $secret: 'ADP_CLIENT_SECRET' },
    certPem: { $secret: 'ADP_CERT_PEM' },
    keyPem: { $secret: 'ADP_KEY_PEM' },
  };

  it('parses a valid config with all credentials', () => {
    expect(configFields.safeParse(base).success).toBe(true);
  });

  it('parses a config with a resources allowlist', () => {
    expect(
      configFields.safeParse({ ...base, resources: ['workers'] }).success,
    ).toBe(true);
  });

  it('rejects an unknown resource', () => {
    expect(
      configFields.safeParse({ ...base, resources: ['pay-statements'] })
        .success,
    ).toBe(false);
  });

  it('rejects a plain string clientSecret instead of a secret object', () => {
    expect(
      configFields.safeParse({ ...base, clientSecret: 'literal' }).success,
    ).toBe(false);
  });

  it('rejects a config missing the client certificate', () => {
    const { certPem: _certPem, ...withoutCert } = base;
    expect(configFields.safeParse(withoutCert).success).toBe(false);
  });
});

interface MockCall {
  url: string;
  method: string;
  headers: Record<string, string>;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body ?? null), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeFetch(route: (url: string) => unknown | undefined) {
  return vi.fn().mockImplementation((url: string | URL) => {
    const u = typeof url === 'string' ? url : url.toString();
    if (u.includes('accounts.adp.com')) {
      return Promise.resolve(
        jsonResponse({ access_token: 'tok-123', expires_in: 3600 }),
      );
    }
    const explicit = route(u);
    if (explicit !== undefined) {
      return Promise.resolve(jsonResponse(explicit));
    }
    if (u.includes('/hr/v2/workers')) {
      return Promise.resolve(jsonResponse({ workers: [] }));
    }
    return Promise.resolve(jsonResponse({ payrollOutputs: [] }));
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

const CREDS = {
  clientId: 'client-1',
  clientSecret: 'secret-1' as unknown as { $secret: string },
  certPem: 'cert' as unknown as { $secret: string },
  keyPem: 'key' as unknown as { $secret: string },
};

function connector(overrides: { resources?: string[] } = {}) {
  return new AdpConnector(
    overrides.resources ? { resources: overrides.resources as never } : {},
    CREDS,
  );
}

describe('AdpConnector.sync', () => {
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

  it('mints an OAuth token and sends it as a Bearer credential on data calls', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector({ resources: ['workers'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const calls = recordCalls(fetchSpy);
    const tokenCall = calls.find((c) => c.url.includes('accounts.adp.com'))!;
    expect(tokenCall.method).toBe('POST');
    expect(tokenCall.headers['authorization']).toBe(
      `Basic ${btoa('client-1:secret-1')}`,
    );

    const workerCall = calls.find((c) => c.url.includes('/hr/v2/workers'))!;
    expect(workerCall.headers['authorization']).toBe('Bearer tok-123');
  });

  it('flattens a worker into a headcount entity', async () => {
    const fetchSpy = makeFetch((url) => {
      if (url.includes('/hr/v2/workers')) {
        return {
          workers: [
            {
              associateOID: 'G123',
              workerStatus: { statusCode: { codeValue: 'Active' } },
              person: {
                legalName: { formattedName: 'Ada Lovelace' },
              },
              workAssignments: [
                {
                  primaryIndicator: true,
                  jobTitle: 'Staff Engineer',
                  hireDate: '2020-03-01',
                  terminationDate: null,
                  homeOrganizationalUnits: [
                    { nameCode: { shortName: 'Engineering' } },
                  ],
                },
              ],
            },
          ],
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector({ resources: ['workers'] }).sync({ mode: 'full' }, storage);

    const entity = storage.entity.mock.calls[0]![0] as {
      type: string;
      id: string;
      attributes: {
        name: string;
        jobTitle: string;
        businessUnit: string;
        status: string;
        hireDate: number;
        terminationDate: number | null;
      };
    };
    expect(entity.type).toBe('adp_worker');
    expect(entity.id).toBe('G123');
    expect(entity.attributes.name).toBe('Ada Lovelace');
    expect(entity.attributes.jobTitle).toBe('Staff Engineer');
    expect(entity.attributes.businessUnit).toBe('Engineering');
    expect(entity.attributes.status).toBe('active');
    expect(entity.attributes.hireDate).toBe(Date.parse('2020-03-01'));
    expect(entity.attributes.terminationDate).toBeNull();
  });

  it('writes a payroll entity and derives one metric sample per amount kind', async () => {
    const fetchSpy = makeFetch((url) => {
      if (url.includes('/payroll/v1/payroll-output')) {
        return {
          payrollOutputs: [
            {
              payrollGroupCode: 'BW1',
              payrollDate: '2026-06-15',
              organizationalUnit: { shortName: 'US' },
              currencyCode: 'USD',
              employeeCount: 42,
              grossPay: { amountValue: 100000 },
              netPay: { amountValue: 72000 },
              totalTaxes: { amountValue: 20000 },
              totalDeductions: { amountValue: 8000 },
            },
          ],
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector({ resources: ['payrolls'] }).sync(
      { mode: 'full' },
      storage,
    );

    const entity = storage.entity.mock.calls[0]![0] as {
      type: string;
      id: string;
      attributes: {
        grossPay: number;
        netPay: number;
        taxes: number;
        deductions: number;
        businessUnit: string;
        payDate: number;
      };
    };
    expect(entity.type).toBe('adp_payroll');
    expect(entity.id).toBe('BW1:2026-06-15');
    expect(entity.attributes.grossPay).toBe(100000);
    expect(entity.attributes.businessUnit).toBe('US');
    expect(entity.attributes.payDate).toBe(Date.parse('2026-06-15'));

    const samples = storage.metrics.mock.calls
      .map((c) => c[0] as unknown[])
      .find((arg) => Array.isArray(arg) && arg.length > 0) as Array<{
      name: string;
      ts: number;
      value: number;
      attributes: { kind: string; businessUnit: string };
    }>;
    const byKind = Object.fromEntries(
      samples.map((s) => [s.attributes.kind, s]),
    );
    expect(Object.keys(byKind).sort()).toEqual([
      'deductions',
      'gross',
      'net',
      'taxes',
    ]);
    expect(byKind['gross']!.value).toBe(100000);
    expect(byKind['gross']!.ts).toBe(Date.parse('2026-06-15'));
    expect(byKind['gross']!.attributes.businessUnit).toBe('US');
    for (const s of samples) {
      expect(s.name).toBe('adp_payroll_metric');
    }
  });

  it('follows $skip pagination until meta.totalNumber is reached', async () => {
    let calls = 0;
    const fetchSpy = makeFetch((url) => {
      if (url.includes('/hr/v2/workers')) {
        calls += 1;
        const oid = `W${calls}`;
        return {
          workers: [
            {
              associateOID: oid,
              workAssignments: [{ primaryIndicator: true }],
            },
          ],
          meta: { totalNumber: 2 },
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector({ resources: ['workers'] }).sync({ mode: 'full' }, storage);

    const workerUrls = recordCalls(fetchSpy)
      .map((c) => c.url)
      .filter((u) => u.includes('/hr/v2/workers'));
    expect(workerUrls).toHaveLength(2);
    expect(workerUrls[1]).toContain('%24skip=1');
    const ids = storage.entity.mock.calls.map(
      (c) => (c[0] as { id: string }).id,
    );
    expect(ids).toEqual(['W1', 'W2']);
  });

  it('only fetches the resources listed in settings.resources', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector({ resources: ['workers'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const urls = recordCalls(fetchSpy).map((c) => c.url);
    expect(urls.some((u) => u.includes('/hr/v2/workers'))).toBe(true);
    expect(urls.some((u) => u.includes('/payroll/v1/payroll-output'))).toBe(
      false,
    );
  });

  it('clears the worker scope at the start of the sync', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetch(() => undefined),
    );
    const storage = makeStorage();
    await connector({ resources: ['workers'] }).sync({ mode: 'full' }, storage);
    const cleared = storage.entities.mock.calls
      .filter((c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0)
      .map((c) => (c[1] as { types: string[] }).types[0]);
    expect(cleared).toContain('adp_worker');
  });

  it('applies lookbackDays as a payDateFrom lower bound on the payroll call', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector({ resources: ['payrolls'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const payrollUrl = recordCalls(fetchSpy)
      .map((c) => c.url)
      .find((u) => u.includes('/payroll/v1/payroll-output'))!;
    expect(payrollUrl).toContain('payDateFrom=');
  });
});

describe('AdpConnector.create', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the connector instance directly', () => {
    vi.stubEnv('ADP_CLIENT_SECRET', 'secret_fixture');
    vi.stubEnv('ADP_CERT_PEM', 'cert_fixture');
    vi.stubEnv('ADP_KEY_PEM', 'key_fixture');
    const c = AdpConnector.create({
      clientId: 'client-1',
      clientSecret: { $secret: 'ADP_CLIENT_SECRET' },
      certPem: { $secret: 'ADP_CERT_PEM' },
      keyPem: { $secret: 'ADP_KEY_PEM' },
    });
    expect(c).toBeInstanceOf(AdpConnector);
    expect(c.id).toBe('adp');
  });
});
