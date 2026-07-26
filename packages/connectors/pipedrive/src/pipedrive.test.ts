import { afterEach, describe, expect, it, vi } from 'vitest';

import { PipedriveConnector, configFields } from './pipedrive';

describe('configFields', () => {
  it('parses a valid config with companyDomain and apiToken', () => {
    const result = configFields.safeParse({
      companyDomain: 'acme',
      apiToken: { $secret: 'PIPEDRIVE_TOKEN' },
    });
    expect(result.success).toBe(true);
  });

  it('parses a valid config with resources', () => {
    const result = configFields.safeParse({
      companyDomain: 'acme',
      apiToken: { $secret: 'PIPEDRIVE_TOKEN' },
      resources: ['deals', 'activities'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a config missing apiToken', () => {
    expect(configFields.safeParse({ companyDomain: 'acme' }).success).toBe(
      false,
    );
  });

  it('rejects a plain string apiToken instead of a secret object', () => {
    const result = configFields.safeParse({
      companyDomain: 'acme',
      apiToken: 'plain-token',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a companyDomain that includes a protocol or path', () => {
    const result = configFields.safeParse({
      companyDomain: 'https://acme.pipedrive.com',
      apiToken: { $secret: 'PIPEDRIVE_TOKEN' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown resource name', () => {
    const result = configFields.safeParse({
      companyDomain: 'acme',
      apiToken: { $secret: 'PIPEDRIVE_TOKEN' },
      resources: ['deals', 'leads'],
    });
    expect(result.success).toBe(false);
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
    return Promise.resolve(jsonResponse({ data: [] }));
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

const TOKEN = 'PIPEDRIVE_TOKEN' as unknown as { $secret: string };

function connector(resources?: string[]) {
  return new PipedriveConnector(
    { companyDomain: 'acme', resources: resources as never },
    { apiToken: TOKEN },
  );
}

describe('PipedriveConnector.sync', () => {
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

  it('targets the company-domain base URL and passes the api_token', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector(['deals']).sync({ mode: 'full' }, makeStorage());

    const call = recordCalls(fetchSpy).find((c) => c.url.includes('/deals'));
    expect(call).toBeDefined();
    expect(
      call!.url.startsWith('https://acme.pipedrive.com/api/v1/deals'),
    ).toBe(true);
    expect(call!.url).toContain('api_token=PIPEDRIVE_TOKEN');
  });

  it('clears the deal entity scope at the start of a full sync', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetch(() => undefined),
    );
    const storage = makeStorage();
    await connector(['deals']).sync({ mode: 'full' }, storage);

    const clearedTypes = storage.entities.mock.calls
      .filter((c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0)
      .map((c) => (c[1] as { types: string[] }).types[0]);
    expect(clearedTypes).toContain('pipedrive_deal');
  });

  it('does not clear entity scope in latest mode', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetch(() => undefined),
    );
    const storage = makeStorage();
    await connector(['deals']).sync(
      { mode: 'latest', since: new Date(Date.now() - 60_000).toISOString() },
      storage,
    );
    const entityClears = storage.entities.mock.calls.filter(
      (c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0,
    );
    expect(entityClears).toHaveLength(0);
  });

  it('always clears the deal stage-change event scope, even in latest mode', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetch(() => undefined),
    );
    const storage = makeStorage();
    await connector(['deal_events']).sync(
      { mode: 'latest', since: new Date(Date.now() - 60_000).toISOString() },
      storage,
    );
    const clearedEvents = storage.events.mock.calls.map(
      (c) => (c[1] as { names: string[] }).names[0],
    );
    expect(clearedEvents).toContain('pipedrive_deal_stage_change');
  });

  it('writes a deal entity with parsed value, owner, and UTC timestamps', async () => {
    const fetchSpy = makeFetch((url) => {
      if (url.includes('/deals')) {
        return {
          data: [
            {
              id: 42,
              title: 'Acme expansion',
              status: 'won',
              value: 4200.5,
              currency: 'USD',
              stage_id: 3,
              pipeline_id: 1,
              user_id: { value: 7, name: 'Rep' },
              person_id: 99,
              add_time: '2024-01-01 09:00:00',
              update_time: '2024-02-01 10:30:00',
              won_time: '2024-02-01 10:30:00',
            },
          ],
          additional_data: { pagination: { more_items_in_collection: false } },
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['deals']).sync({ mode: 'full' }, storage);

    const entity = storage.entity.mock.calls[0]![0] as {
      type: string;
      id: string;
      attributes: {
        value: number;
        currency: string;
        stageId: string;
        ownerId: string;
        personId: string;
        status: string;
      };
      updated_at: number;
    };
    expect(entity.type).toBe('pipedrive_deal');
    expect(entity.id).toBe('42');
    expect(entity.attributes.value).toBe(4200.5);
    expect(entity.attributes.currency).toBe('USD');
    expect(entity.attributes.stageId).toBe('3');
    expect(entity.attributes.ownerId).toBe('7');
    expect(entity.attributes.personId).toBe('99');
    expect(entity.attributes.status).toBe('won');
    expect(entity.updated_at).toBe(Date.parse('2024-02-01T10:30:00Z'));
  });

  it('paginates deals via next_start until the collection is exhausted', async () => {
    const fetchSpy = makeFetch((url) => {
      if (url.includes('/deals')) {
        if (url.includes('start=0')) {
          return {
            data: [{ id: 1, update_time: '2024-01-01 00:00:00' }],
            additional_data: {
              pagination: { more_items_in_collection: true, next_start: 1 },
            },
          };
        }
        return {
          data: [{ id: 2, update_time: '2024-01-02 00:00:00' }],
          additional_data: { pagination: { more_items_in_collection: false } },
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['deals']).sync({ mode: 'full' }, storage);

    const ids = storage.entity.mock.calls.map(
      (c) => (c[0] as { id: string }).id,
    );
    expect(ids).toEqual(['1', '2']);
    const dealCalls = recordCalls(fetchSpy).filter((c) =>
      c.url.includes('/deals'),
    );
    expect(dealCalls.some((c) => c.url.includes('start=1'))).toBe(true);
  });

  it('stops paginating deals once a page predates the since floor', async () => {
    const fetchSpy = makeFetch((url) => {
      if (url.includes('/deals')) {
        return {
          data: [
            { id: 10, update_time: '2024-03-10 00:00:00' },
            { id: 11, update_time: '2024-01-01 00:00:00' },
          ],
          additional_data: {
            pagination: { more_items_in_collection: true, next_start: 2 },
          },
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    const result = await connector(['deals']).sync(
      { mode: 'latest', since: '2024-02-01T00:00:00.000Z' },
      storage,
    );

    const ids = storage.entity.mock.calls.map(
      (c) => (c[0] as { id: string }).id,
    );
    expect(ids).toEqual(['10']);
    expect(result.done).toBe(true);
    const dealCalls = recordCalls(fetchSpy).filter((c) =>
      c.url.includes('/deals'),
    );
    expect(dealCalls.some((c) => c.url.includes('start=2'))).toBe(false);
  });

  it('pushes a status filter into the deals query and overrides the default', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector(['deals']).sync(
      {
        mode: 'full',
        fetchSpecs: {
          pipedrive_deal: [
            { filter: [{ field: 'status', op: 'eq', value: 'won' }] },
          ],
        } as never,
      },
      makeStorage(),
    );

    const call = recordCalls(fetchSpy).find((c) => c.url.includes('/deals'));
    expect(call!.url).toContain('status=won');
    expect(call!.url).not.toContain('all_not_deleted');
  });

  it('defaults the deals status filter to all_not_deleted', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector(['deals']).sync({ mode: 'full' }, makeStorage());

    const call = recordCalls(fetchSpy).find((c) => c.url.includes('/deals'));
    expect(call!.url).toContain('status=all_not_deleted');
  });

  it('emits a stage-change event per stage_id transition in a deal flow', async () => {
    const fetchSpy = makeFetch((url) => {
      if (url.includes('/deals/55/flow')) {
        return {
          data: [
            {
              object: 'dealChange',
              data: {
                item_id: 55,
                field_key: 'stage_id',
                old_value: 1,
                new_value: 2,
                user_id: 7,
                log_time: '2024-02-01 12:00:00',
              },
            },
            {
              object: 'note',
              data: { id: 1 },
            },
            {
              object: 'dealChange',
              data: {
                item_id: 55,
                field_key: 'title',
                old_value: 'a',
                new_value: 'b',
                log_time: '2024-02-02 12:00:00',
              },
            },
          ],
          additional_data: { pagination: { more_items_in_collection: false } },
        };
      }
      if (url.includes('/deals')) {
        return {
          data: [{ id: 55 }],
          additional_data: { pagination: { more_items_in_collection: false } },
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['deal_events']).sync({ mode: 'full' }, storage);

    expect(storage.event).toHaveBeenCalledTimes(1);
    const event = storage.event.mock.calls[0]![0] as {
      name: string;
      start_ts: number;
      attributes: { dealId: string; fromStageId: string; toStageId: string };
    };
    expect(event.name).toBe('pipedrive_deal_stage_change');
    expect(event.attributes.dealId).toBe('55');
    expect(event.attributes.fromStageId).toBe('1');
    expect(event.attributes.toStageId).toBe('2');
    expect(event.start_ts).toBe(Date.parse('2024-02-01T12:00:00Z'));
  });

  it('writes pipeline entities without pagination', async () => {
    const fetchSpy = makeFetch((url) => {
      if (url.includes('/pipelines')) {
        return {
          data: [
            {
              id: 1,
              name: 'Sales',
              active: true,
              deal_probability: true,
              order_nr: 0,
              update_time: '2024-01-01 00:00:00',
            },
          ],
          additional_data: {
            pagination: { more_items_in_collection: true, next_start: 1 },
          },
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['pipelines']).sync({ mode: 'full' }, storage);

    const entity = storage.entity.mock.calls[0]![0] as {
      type: string;
      attributes: { name: string; dealProbability: boolean };
    };
    expect(entity.type).toBe('pipedrive_pipeline');
    expect(entity.attributes.name).toBe('Sales');
    const pipelineCalls = recordCalls(fetchSpy).filter((c) =>
      c.url.includes('/pipelines'),
    );
    expect(pipelineCalls).toHaveLength(1);
  });

  it('writes activity entities and requests all users', async () => {
    const fetchSpy = makeFetch((url) => {
      if (url.includes('/activities')) {
        return {
          data: [
            {
              id: 5,
              type: 'call',
              subject: 'Intro call',
              done: true,
              deal_id: 55,
              user_id: 7,
              marked_as_done_time: '2024-02-01 15:00:00',
              add_time: '2024-01-30 09:00:00',
              update_time: '2024-02-01 15:00:00',
            },
          ],
          additional_data: { pagination: { more_items_in_collection: false } },
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['activities']).sync({ mode: 'full' }, storage);

    const entity = storage.entity.mock.calls[0]![0] as {
      type: string;
      attributes: { type: string; dealId: string; doneTime: number };
    };
    expect(entity.type).toBe('pipedrive_activity');
    expect(entity.attributes.type).toBe('call');
    expect(entity.attributes.dealId).toBe('55');
    expect(entity.attributes.doneTime).toBe(Date.parse('2024-02-01T15:00:00Z'));
    const call = recordCalls(fetchSpy).find((c) =>
      c.url.includes('/activities'),
    );
    expect(call!.url).toContain('user_id=0');
  });

  it('resumes from a saved cursor, skipping earlier phases', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector().sync(
      { mode: 'full', cursor: { phase: 'pipelines', page: null } },
      makeStorage(),
    );

    const calls = recordCalls(fetchSpy);
    expect(calls.some((c) => c.url.includes('/deals'))).toBe(false);
    expect(calls.some((c) => c.url.includes('/pipelines'))).toBe(true);
  });

  it('only fetches the resources listed in settings.resources', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector(['pipelines']).sync({ mode: 'full' }, makeStorage());

    const calls = recordCalls(fetchSpy);
    expect(calls.some((c) => c.url.includes('/pipelines'))).toBe(true);
    expect(calls.some((c) => c.url.includes('/activities'))).toBe(false);
    expect(calls.some((c) => c.url.includes('/api/v1/deals'))).toBe(false);
  });
});

describe('PipedriveConnector.create', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the connector instance directly', () => {
    vi.stubEnv('PIPEDRIVE_TOKEN', 'test_token_fixture');
    const c = PipedriveConnector.create({
      companyDomain: 'acme',
      apiToken: { $secret: 'PIPEDRIVE_TOKEN' },
    });
    expect(c).toBeInstanceOf(PipedriveConnector);
    expect(c.id).toBe('pipedrive');
  });
});
