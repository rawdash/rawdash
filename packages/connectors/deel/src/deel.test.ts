import { afterEach, describe, expect, it, vi } from 'vitest';

import { DeelConnector, configFields } from './deel';

describe('configFields', () => {
  it('parses a valid config with only apiToken', () => {
    const result = configFields.safeParse({
      apiToken: { $secret: 'DEEL_API_TOKEN' },
    });
    expect(result.success).toBe(true);
  });

  it('parses a config with lookbackDays and a resources allowlist', () => {
    const result = configFields.safeParse({
      apiToken: { $secret: 'DEEL_API_TOKEN' },
      lookbackDays: 90,
      resources: ['people', 'invoices'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown resource', () => {
    expect(
      configFields.safeParse({
        apiToken: { $secret: 'DEEL_API_TOKEN' },
        resources: ['payslips'],
      }).success,
    ).toBe(false);
  });

  it('rejects a non-positive lookbackDays', () => {
    expect(
      configFields.safeParse({
        apiToken: { $secret: 'DEEL_API_TOKEN' },
        lookbackDays: 0,
      }).success,
    ).toBe(false);
  });

  it('rejects a plain string apiToken instead of secret object', () => {
    expect(configFields.safeParse({ apiToken: 'literal' }).success).toBe(false);
  });

  it('rejects a config missing apiToken', () => {
    expect(configFields.safeParse({}).success).toBe(false);
  });
});

interface MockCall {
  url: string;
  method: string;
  headers: Record<string, string>;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body ?? null), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function makeFetch(route: (url: string) => unknown | undefined) {
  return vi.fn().mockImplementation((url: string | URL) => {
    const u = typeof url === 'string' ? url : url.toString();
    const explicit = route(u);
    if (explicit !== undefined) {
      return Promise.resolve(jsonResponse(explicit));
    }
    return Promise.resolve(jsonResponse({ data: [], page: null }));
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

const TOKEN = 'API_TOKEN' as unknown as { $secret: string };

function connector(
  overrides: { resources?: string[]; lookbackDays?: number } = {},
) {
  return new DeelConnector(
    {
      resources: overrides.resources as never,
      lookbackDays: overrides.lookbackDays,
    },
    { apiToken: TOKEN },
  );
}

describe('DeelConnector.sync', () => {
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

  it('sends the API token as a Bearer credential', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector({ resources: ['people'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const headers = recordCalls(fetchSpy)[0]!.headers;
    expect(headers['authorization']).toBe('Bearer API_TOKEN');
    expect(headers['accept']).toBe('application/json');
  });

  it('targets the Deel REST v2 base with limit/offset paging', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector({ resources: ['people'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const url = recordCalls(fetchSpy)[0]!.url;
    expect(url).toContain('https://api.letsdeel.com/rest/v2/people');
    expect(url).toContain('limit=100');
    expect(url).toContain('offset=0');
  });

  it('filters invoices by status=all and an issued_from_date window', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector({ resources: ['invoices'], lookbackDays: 30 }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const url = recordCalls(fetchSpy).find((c) =>
      c.url.includes('/invoices'),
    )!.url;
    expect(url).toContain('status=all');
    expect(url).toMatch(/issued_from_date=\d{4}-\d{2}-\d{2}/);
  });

  it('walks pages using the offset envelope until total_rows is consumed', async () => {
    let calls = 0;
    const fetchSpy = makeFetch((url) => {
      if (url.includes('/people')) {
        calls += 1;
        if (url.includes('offset=0')) {
          return {
            data: [{ id: 'w1' }, { id: 'w2' }],
            page: { offset: 0, total_rows: 3, items_per_page: 2 },
          };
        }
        return {
          data: [{ id: 'w3' }],
          page: { offset: 2, total_rows: 3, items_per_page: 2 },
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector({ resources: ['people'] }).sync({ mode: 'full' }, storage);

    expect(calls).toBe(2);
    const writtenIds = storage.entity.mock.calls.map(
      (c) => (c[0] as { id: string }).id,
    );
    expect(writtenIds).toEqual(['w1', 'w2', 'w3']);
    const urls = recordCalls(fetchSpy).map((c) => c.url);
    expect(urls[1]).toContain('offset=2');
  });

  it('clears each entity scope on the first page of every sync', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetch(() => undefined),
    );

    const storage = makeStorage();
    await connector({ resources: ['people', 'contracts', 'invoices'] }).sync(
      { mode: 'latest', since: new Date(Date.now() - 60_000).toISOString() },
      storage,
    );
    const clearedTypes = storage.entities.mock.calls
      .filter((c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0)
      .map((c) => (c[1] as { types: string[] }).types[0]);
    expect(clearedTypes).toContain('deel_person');
    expect(clearedTypes).toContain('deel_contract');
    expect(clearedTypes).toContain('deel_invoice');
  });

  it('always clears the invoice_events scope', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetch(() => undefined),
    );

    const storage = makeStorage();
    await connector({ resources: ['invoice_events'] }).sync(
      { mode: 'full' },
      storage,
    );
    const clearedNames = storage.events.mock.calls.map(
      (c) => (c[1] as { names: string[] }).names[0],
    );
    expect(clearedNames).toContain('deel_invoice_event');
  });

  it('writes a person entity with employment fields flattened', async () => {
    const fetchSpy = makeFetch((url) => {
      if (url.includes('/people')) {
        return {
          data: [
            {
              id: 'w42',
              first_name: 'Ada',
              last_name: 'Lovelace',
              country: 'GB',
              job_title: 'Engineer',
              start_date: '2026-01-15T00:00:00Z',
              hiring_status: 'active',
              hiring_type: 'eor',
              employments: [
                { id: 'e1', type: 'eor', start_date: '2026-01-15T00:00:00Z' },
              ],
            },
          ],
          page: { offset: 0, total_rows: 1, items_per_page: 100 },
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector({ resources: ['people'] }).sync({ mode: 'full' }, storage);

    const entity = storage.entity.mock.calls[0]![0] as {
      type: string;
      id: string;
      attributes: {
        fullName: string;
        country: string;
        employmentType: string;
        status: string;
        startDate: number;
      };
    };
    expect(entity.type).toBe('deel_person');
    expect(entity.id).toBe('w42');
    expect(entity.attributes.fullName).toBe('Ada Lovelace');
    expect(entity.attributes.country).toBe('GB');
    expect(entity.attributes.employmentType).toBe('eor');
    expect(entity.attributes.status).toBe('active');
    expect(entity.attributes.startDate).toBe(
      Date.parse('2026-01-15T00:00:00Z'),
    );
  });

  it('parses contract compensation into a numeric rate and currency', async () => {
    const fetchSpy = makeFetch((url) => {
      if (url.includes('/contracts')) {
        return {
          data: [
            {
              id: 'c1',
              type: 'global_payroll',
              status: 'in_progress',
              start_date: '2026-02-01T00:00:00Z',
              created_at: '2026-01-20T00:00:00Z',
              compensation_details: {
                amount: '5000.50',
                currency_code: 'USD',
                frequency: 'monthly',
              },
            },
          ],
          page: { offset: 0, total_rows: 1, items_per_page: 100 },
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector({ resources: ['contracts'] }).sync(
      { mode: 'full' },
      storage,
    );

    const entity = storage.entity.mock.calls[0]![0] as {
      attributes: {
        type: string;
        rate: number;
        currency: string;
        frequency: string;
      };
    };
    expect(entity.attributes.type).toBe('global_payroll');
    expect(entity.attributes.rate).toBe(5000.5);
    expect(entity.attributes.currency).toBe('USD');
    expect(entity.attributes.frequency).toBe('monthly');
  });

  it('emits issued / paid events from each invoice timestamps', async () => {
    const fetchSpy = makeFetch((url) => {
      if (url.includes('/invoices')) {
        return {
          data: [
            {
              id: 'i1',
              total: '1200.00',
              currency: 'USD',
              status: 'paid',
              issued_at: '2026-03-01T00:00:00Z',
              paid_at: '2026-03-10T00:00:00Z',
              contract_id: 'c1',
            },
            {
              id: 'i2',
              total: '800.00',
              currency: 'EUR',
              status: 'pending',
              issued_at: '2026-03-05T00:00:00Z',
              paid_at: null,
              contract_id: 'c2',
            },
          ],
          page: { offset: 0, total_rows: 2, items_per_page: 100 },
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector({ resources: ['invoice_events'] }).sync(
      { mode: 'full' },
      storage,
    );

    const events = storage.event.mock.calls.map(
      (c) =>
        c[0] as {
          name: string;
          attributes: {
            invoiceId: string;
            transition: string;
            amount: number;
          };
        },
    );
    for (const e of events) {
      expect(e.name).toBe('deel_invoice_event');
    }
    const transitions = events.map(
      (e) => `${e.attributes.invoiceId}:${e.attributes.transition}`,
    );
    expect(transitions).toContain('i1:issued');
    expect(transitions).toContain('i1:paid');
    expect(transitions).toContain('i2:issued');
    expect(transitions).not.toContain('i2:paid');
    const paidI1 = events.find(
      (e) =>
        e.attributes.invoiceId === 'i1' && e.attributes.transition === 'paid',
    )!;
    expect(paidI1.attributes.amount).toBe(1200);
  });

  it('only fetches the resources listed in settings.resources', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector({ resources: ['people'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const urls = recordCalls(fetchSpy).map((c) => c.url);
    expect(urls.some((u) => u.includes('/people'))).toBe(true);
    expect(urls.some((u) => u.includes('/contracts'))).toBe(false);
    expect(urls.some((u) => u.includes('/invoices'))).toBe(false);
  });
});

describe('DeelConnector.create', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the connector instance directly', () => {
    vi.stubEnv('DEEL_API_TOKEN', 'test_token_fixture');
    const c = DeelConnector.create({
      apiToken: { $secret: 'DEEL_API_TOKEN' },
    });
    expect(c).toBeInstanceOf(DeelConnector);
    expect(c.id).toBe('deel');
  });
});
