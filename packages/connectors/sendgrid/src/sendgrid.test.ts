import { afterEach, describe, expect, it, vi } from 'vitest';

import { SendgridConnector, configFields } from './sendgrid';

describe('configFields', () => {
  it('parses a valid config', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'SENDGRID_API_KEY' },
    });
    expect(result.success).toBe(true);
  });

  it('parses a config with categories, backfill, and a resources allowlist', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'SENDGRID_API_KEY' },
      categories: ['transactional', 'marketing'],
      backfillDays: 30,
      resources: ['email_stats', 'bounces'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a plain-string apiKey', () => {
    const result = configFields.safeParse({ apiKey: 'plain' });
    expect(result.success).toBe(false);
  });

  it('rejects an empty categories array', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'SENDGRID_API_KEY' },
      categories: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown resource name', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'SENDGRID_API_KEY' },
      resources: ['email_stats', 'opens'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-positive backfillDays', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'SENDGRID_API_KEY' },
      backfillDays: 0,
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

function makeFetch(route: (url: string) => unknown) {
  return vi.fn().mockImplementation((url: string | URL) => {
    const u = typeof url === 'string' ? url : url.toString();
    const explicit = route(u);
    if (explicit !== undefined) {
      return Promise.resolve(jsonResponse(explicit));
    }
    if (u.includes('/stats') || u.includes('/categories/stats')) {
      return Promise.resolve(jsonResponse([]));
    }
    if (u.includes('/suppression/bounces')) {
      return Promise.resolve(jsonResponse([]));
    }
    if (u.includes('/suppression/spam_reports')) {
      return Promise.resolve(jsonResponse([]));
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

const API_KEY = 'SENDGRID_API_KEY' as unknown as { $secret: string };

function connector(
  resources?: string[],
  overrides: { categories?: string[]; backfillDays?: number } = {},
) {
  return new SendgridConnector(
    {
      categories: overrides.categories,
      backfillDays: overrides.backfillDays,
      ...(resources ? { resources: resources as never } : {}),
    },
    { apiKey: API_KEY },
  );
}

describe('SendgridConnector.sync', () => {
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

  it('sends the api key as a bearer authorization header', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector(['email_stats']).sync({ mode: 'full' }, makeStorage());

    const call = recordCalls(fetchSpy).find((c) => c.url.includes('/stats'));
    expect(call).toBeDefined();
    const auth =
      call!.headers['Authorization'] ?? call!.headers['authorization'];
    expect(auth).toBe('Bearer SENDGRID_API_KEY');
  });

  it('writes one email_stats metric sample per (day, global) from global stats', async () => {
    const fetchSpy = makeFetch((u) => {
      if (u.includes('/stats')) {
        return [
          {
            date: '2024-04-01',
            stats: [
              {
                metrics: {
                  requests: 100,
                  delivered: 95,
                  bounces: 3,
                  opens: 40,
                  clicks: 10,
                  spam_reports: 1,
                  unsubscribes: 2,
                },
              },
            ],
          },
          {
            date: '2024-04-02',
            stats: [{ metrics: { requests: 80, delivered: 78 } }],
          },
        ];
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['email_stats']).sync({ mode: 'full' }, storage);

    expect(storage.metrics).toHaveBeenCalledTimes(1);
    const [samples, scope] = storage.metrics.mock.calls[0]!;
    expect(scope).toEqual({ names: ['sendgrid_email_stats'] });
    expect(samples).toHaveLength(2);
    expect(samples[0].name).toBe('sendgrid_email_stats');
    expect(samples[0].ts).toBe(Date.UTC(2024, 3, 1));
    expect(samples[0].value).toBe(100);
    expect(samples[0].attributes.category).toBe('all');
    expect(samples[0].attributes.delivered).toBe(95);
    expect(samples[0].attributes.bounces).toBe(3);
  });

  it('uses the category stats endpoint and category names when categories are configured', async () => {
    const fetchSpy = makeFetch((u) => {
      if (u.includes('/categories/stats')) {
        return [
          {
            date: '2024-04-01',
            stats: [
              { name: 'transactional', metrics: { requests: 50 } },
              { name: 'marketing', metrics: { requests: 20 } },
            ],
          },
        ];
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['email_stats'], {
      categories: ['transactional', 'marketing'],
    }).sync({ mode: 'full' }, storage);

    const statsCall = recordCalls(fetchSpy).find((c) =>
      c.url.includes('/categories/stats'),
    );
    expect(statsCall).toBeDefined();
    const params = new URL(statsCall!.url).searchParams;
    expect(params.getAll('categories')).toEqual(['transactional', 'marketing']);

    const [samples] = storage.metrics.mock.calls[0]!;
    expect(samples).toHaveLength(2);
    expect(samples[0].attributes.category).toBe('transactional');
    expect(samples[1].attributes.category).toBe('marketing');
  });

  it('emits a bounce event per suppression row', async () => {
    const fetchSpy = makeFetch((u) => {
      if (u.includes('/suppression/bounces')) {
        if (Number(new URL(u).searchParams.get('offset')) > 0) {
          return [];
        }
        return [
          {
            created: 1712000000,
            email: 'a@example.com',
            reason: '550 mailbox unavailable',
            status: '5.1.1',
          },
          { created: 1712100000, email: 'b@example.com' },
        ];
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['bounces']).sync({ mode: 'full' }, storage);

    expect(storage.event).toHaveBeenCalledTimes(2);
    const first = storage.event.mock.calls[0]![0] as {
      name: string;
      start_ts: number;
      attributes: { email: string; reason: string | null };
    };
    expect(first.name).toBe('sendgrid_bounce');
    expect(first.start_ts).toBe(1712000000 * 1000);
    expect(first.attributes.email).toBe('a@example.com');
    expect(first.attributes.reason).toBe('550 mailbox unavailable');
  });

  it('emits a spam_report event per suppression row', async () => {
    const fetchSpy = makeFetch((u) => {
      if (u.includes('/suppression/spam_reports')) {
        if (Number(new URL(u).searchParams.get('offset')) > 0) {
          return [];
        }
        return [
          { created: 1712200000, email: 'c@example.com', ip: '10.0.0.1' },
        ];
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['spam_reports']).sync({ mode: 'full' }, storage);

    expect(storage.event).toHaveBeenCalledTimes(1);
    const ev = storage.event.mock.calls[0]![0] as {
      name: string;
      attributes: { email: string; ip: string | null };
    };
    expect(ev.name).toBe('sendgrid_spam_report');
    expect(ev.attributes.ip).toBe('10.0.0.1');
  });

  it('paginates suppression bounces via offset until a short page', async () => {
    const TOTAL = 1100;
    const all = Array.from({ length: TOTAL }, (_, i) => ({
      created: 1712000000 + i,
      email: `user${i}@example.com`,
    }));
    const fetchSpy = makeFetch((u) => {
      if (u.includes('/suppression/bounces')) {
        const offset = Number(new URL(u).searchParams.get('offset'));
        return all.slice(offset, offset + 500);
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector(['bounces']).sync({ mode: 'full' }, storage);

    expect(storage.event).toHaveBeenCalledTimes(TOTAL);
    const offsets = recordCalls(fetchSpy)
      .filter((c) => c.url.includes('/suppression/bounces'))
      .map((c) => new URL(c.url).searchParams.get('offset'));
    expect(offsets).toEqual(['0', '500', '1000']);
  });

  it('clears the event scope only on full sync, not on incremental', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetch(() => undefined),
    );
    const incremental = makeStorage();
    await connector(['bounces']).sync(
      { mode: 'latest', since: '2024-01-01T00:00:00.000Z' },
      incremental,
    );
    expect(incremental.events).not.toHaveBeenCalled();

    const full = makeStorage();
    await connector(['bounces']).sync({ mode: 'full' }, full);
    expect(full.events).toHaveBeenCalledWith([], {
      names: ['sendgrid_bounce'],
    });
  });

  it('pulls the suppression window from the since bound on an incremental sync', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector(['bounces']).sync(
      { mode: 'latest', since: '2024-01-01T00:00:00.000Z' },
      makeStorage(),
    );

    const call = recordCalls(fetchSpy).find((c) =>
      c.url.includes('/suppression/bounces'),
    );
    expect(call).toBeDefined();
    const startTime = new URL(call!.url).searchParams.get('start_time');
    expect(startTime).toBe(
      String(Math.floor(Date.parse('2024-01-01T00:00:00.000Z') / 1000)),
    );
  });

  it('only fetches the resources listed in settings.resources', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector(['email_stats']).sync({ mode: 'full' }, makeStorage());

    const calls = recordCalls(fetchSpy);
    expect(calls.some((c) => c.url.includes('/stats'))).toBe(true);
    expect(calls.some((c) => c.url.includes('/suppression/bounces'))).toBe(
      false,
    );
    expect(calls.some((c) => c.url.includes('/suppression/spam_reports'))).toBe(
      false,
    );
  });

  it('resumes from a saved cursor, skipping earlier phases', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector().sync(
      { mode: 'full', cursor: { phase: 'bounces', page: '0' } },
      makeStorage(),
    );

    const calls = recordCalls(fetchSpy);
    expect(calls.some((c) => c.url.includes('/stats'))).toBe(false);
    expect(calls.some((c) => c.url.includes('/suppression/bounces'))).toBe(
      true,
    );
  });

  it('caps the stats backfill window at the configured number of days', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector(['email_stats'], { backfillDays: 7 }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const call = recordCalls(fetchSpy).find((c) => c.url.includes('/stats'));
    const params = new URL(call!.url).searchParams;
    const start = params.get('start_date')!;
    const end = params.get('end_date')!;
    const diffDays = Math.round(
      (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) /
        (24 * 60 * 60 * 1000),
    );
    expect(diffDays).toBe(6);
    expect(params.get('aggregated_by')).toBe('day');
  });
});

describe('SendgridConnector.create', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns a configured instance from JSON input', () => {
    vi.stubEnv('SENDGRID_API_KEY', 'sg_test');
    const c = SendgridConnector.create({
      apiKey: { $secret: 'SENDGRID_API_KEY' },
    });
    expect(c).toBeInstanceOf(SendgridConnector);
    expect(c.id).toBe('sendgrid');
  });
});
