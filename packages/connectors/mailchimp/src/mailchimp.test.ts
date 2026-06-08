import { afterEach, describe, expect, it, vi } from 'vitest';

import { MailchimpConnector, configFields } from './mailchimp';

// ---------------------------------------------------------------------------
// configFields
// ---------------------------------------------------------------------------

describe('configFields', () => {
  it('parses a minimal config with only apiKey', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'MAILCHIMP_API_KEY' },
    });
    expect(result.success).toBe(true);
  });

  it('parses a config with explicit resources', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'MAILCHIMP_API_KEY' },
      resources: ['campaigns', 'campaign_stats'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown resource', () => {
    expect(
      configFields.safeParse({
        apiKey: { $secret: 'MAILCHIMP_API_KEY' },
        resources: ['campaigns', 'members'],
      }).success,
    ).toBe(false);
  });

  it('rejects a plain string apiKey instead of secret object', () => {
    expect(configFields.safeParse({ apiKey: 'abc-us1' }).success).toBe(false);
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
    if (u.includes('/campaigns')) {
      return Promise.resolve(jsonResponse({ campaigns: [] }));
    }
    if (u.includes('/lists')) {
      return Promise.resolve(jsonResponse({ lists: [] }));
    }
    if (u.includes('/automations')) {
      return Promise.resolve(jsonResponse({ automations: [] }));
    }
    if (u.includes('/reports')) {
      return Promise.resolve(jsonResponse({ reports: [] }));
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
      body: init.body ? JSON.parse(init.body as string) : undefined,
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

// In these unit tests the credential is treated as a literal string, since
// BaseConnector uses unresolved credentials verbatim. The Mailchimp shape is
// `<key>-<dc>`, and we read the dc suffix at sync time to route requests.
const API_KEY = 'mailchimp-test-key-us1' as unknown as { $secret: string };

function connector(overrides: { resources?: string[] } = {}) {
  return new MailchimpConnector(
    overrides.resources ? { resources: overrides.resources as never } : {},
    { apiKey: API_KEY },
  );
}

// ---------------------------------------------------------------------------
// sync — phase orchestration
// ---------------------------------------------------------------------------

describe('MailchimpConnector.sync', () => {
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

  it('routes requests to the data-center host derived from the API key', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector({ resources: ['campaigns'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const call = recordCalls(fetchSpy)[0]!;
    expect(call.url).toContain('https://us1.api.mailchimp.com/3.0/campaigns');
  });

  it('sends HTTP Basic auth with the API key as the password', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector({ resources: ['campaigns'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const auth = recordCalls(fetchSpy)[0]!.headers['authorization'];
    expect(auth).toBeDefined();
    expect(auth!.startsWith('Basic ')).toBe(true);
    const decoded = atob(auth!.slice('Basic '.length));
    // Mailchimp accepts any username; we send `rawdash:<api_key>`.
    expect(decoded).toBe('rawdash:mailchimp-test-key-us1');
  });

  it('writes a campaign entity from /campaigns', async () => {
    const fetchSpy = makeFetch((url, method) => {
      if (method === 'GET' && url.includes('/campaigns')) {
        return {
          campaigns: [
            {
              id: 'c_1',
              status: 'sent',
              type: 'regular',
              create_time: '2024-01-01T00:00:00.000Z',
              send_time: '2024-02-01T00:00:00.000Z',
              emails_sent: 1000,
              recipients: { list_id: 'l_1', list_name: 'Newsletter' },
              settings: {
                subject_line: 'Welcome',
                title: 'Welcome blast',
                from_name: 'Marketing',
                reply_to: 'reply@example.com',
              },
            },
          ],
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector({ resources: ['campaigns'] }).sync(
      { mode: 'full' },
      storage,
    );

    const entity = storage.entity.mock.calls[0]![0] as {
      type: string;
      id: string;
      attributes: {
        status: string;
        type: string;
        subjectLine: string;
        title: string;
        fromName: string;
        listId: string;
        listName: string;
        emailsSent: number;
        sendTime: number;
      };
      updated_at: number;
    };
    expect(entity.type).toBe('mailchimp_campaign');
    expect(entity.id).toBe('c_1');
    expect(entity.attributes.status).toBe('sent');
    expect(entity.attributes.type).toBe('regular');
    expect(entity.attributes.subjectLine).toBe('Welcome');
    expect(entity.attributes.listId).toBe('l_1');
    expect(entity.attributes.listName).toBe('Newsletter');
    expect(entity.attributes.emailsSent).toBe(1000);
    expect(entity.attributes.sendTime).toBe(
      Date.parse('2024-02-01T00:00:00.000Z'),
    );
    expect(entity.updated_at).toBe(Date.parse('2024-02-01T00:00:00.000Z'));
  });

  it('writes a list entity with stats fields', async () => {
    const fetchSpy = makeFetch((url, method) => {
      if (method === 'GET' && url.includes('/lists')) {
        return {
          lists: [
            {
              id: 'l_1',
              name: 'Newsletter',
              date_created: '2023-05-01T00:00:00.000Z',
              list_rating: 4,
              stats: {
                member_count: 1200,
                unsubscribe_count: 30,
                cleaned_count: 5,
                open_rate: 0.45,
                click_rate: 0.12,
                campaign_count: 24,
              },
            },
          ],
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector({ resources: ['lists'] }).sync({ mode: 'full' }, storage);

    const entity = storage.entity.mock.calls[0]![0] as {
      type: string;
      id: string;
      attributes: {
        name: string;
        memberCount: number;
        openRate: number;
        clickRate: number;
        campaignCount: number;
      };
    };
    expect(entity.type).toBe('mailchimp_list');
    expect(entity.id).toBe('l_1');
    expect(entity.attributes.name).toBe('Newsletter');
    expect(entity.attributes.memberCount).toBe(1200);
    expect(entity.attributes.openRate).toBe(0.45);
    expect(entity.attributes.clickRate).toBe(0.12);
    expect(entity.attributes.campaignCount).toBe(24);
  });

  it('writes an automation entity', async () => {
    const fetchSpy = makeFetch((url, method) => {
      if (method === 'GET' && url.includes('/automations')) {
        return {
          automations: [
            {
              id: 'a_1',
              create_time: '2024-01-01T00:00:00.000Z',
              start_time: '2024-01-02T00:00:00.000Z',
              status: 'sending',
              emails_sent: 5,
              recipients: { list_id: 'l_1', list_name: 'Newsletter' },
              settings: {
                title: 'Welcome series',
                from_name: 'Onboarding',
                reply_to: 'hello@example.com',
              },
            },
          ],
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector({ resources: ['automations'] }).sync(
      { mode: 'full' },
      storage,
    );

    const entity = storage.entity.mock.calls[0]![0] as {
      type: string;
      id: string;
      attributes: {
        status: string;
        title: string;
        emailsSent: number;
      };
    };
    expect(entity.type).toBe('mailchimp_automation');
    expect(entity.id).toBe('a_1');
    expect(entity.attributes.status).toBe('sending');
    expect(entity.attributes.title).toBe('Welcome series');
    expect(entity.attributes.emailsSent).toBe(5);
  });

  it('writes a campaign_stats metric per report and clears the metric scope on every sync', async () => {
    const fetchSpy = makeFetch((url, method) => {
      if (method === 'GET' && url.includes('/reports')) {
        return {
          reports: [
            {
              id: 'c_1',
              campaign_title: 'Welcome blast',
              type: 'regular',
              list_id: 'l_1',
              emails_sent: 1000,
              unsubscribed: 4,
              send_time: '2024-02-01T00:00:00.000Z',
              opens: { opens_total: 600, unique_opens: 450, open_rate: 0.45 },
              clicks: {
                clicks_total: 120,
                unique_clicks: 100,
                click_rate: 0.1,
              },
              bounces: { hard_bounces: 3, soft_bounces: 7, syntax_errors: 0 },
            },
          ],
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector({ resources: ['campaign_stats'] }).sync(
      { mode: 'latest' },
      storage,
    );

    // Metric scope must be cleared even on an incremental tick.
    const clearedMetrics = storage.metrics.mock.calls.map(
      (c) => (c[1] as { names: string[] }).names[0],
    );
    expect(clearedMetrics).toContain('mailchimp_campaign_stats');

    const metric = storage.metric.mock.calls[0]![0] as {
      name: string;
      ts: number;
      value: number;
      attributes: {
        campaignId: string;
        opensTotal: number;
        uniqueOpens: number;
        clicksTotal: number;
        clickRate: number;
        hardBounces: number;
        unsubscribed: number;
      };
    };
    expect(metric.name).toBe('mailchimp_campaign_stats');
    expect(metric.ts).toBe(Date.parse('2024-02-01T00:00:00.000Z'));
    expect(metric.value).toBe(1000);
    expect(metric.attributes.campaignId).toBe('c_1');
    expect(metric.attributes.opensTotal).toBe(600);
    expect(metric.attributes.uniqueOpens).toBe(450);
    expect(metric.attributes.clicksTotal).toBe(120);
    expect(metric.attributes.clickRate).toBe(0.1);
    expect(metric.attributes.hardBounces).toBe(3);
    expect(metric.attributes.unsubscribed).toBe(4);
  });

  it('skips reports for campaigns without a send_time', async () => {
    const fetchSpy = makeFetch((url, method) => {
      if (method === 'GET' && url.includes('/reports')) {
        return {
          reports: [
            {
              id: 'c_unscheduled',
              emails_sent: 0,
              send_time: null,
            },
            {
              id: 'c_sent',
              emails_sent: 10,
              send_time: '2024-02-01T00:00:00.000Z',
            },
          ],
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const storage = makeStorage();
    await connector({ resources: ['campaign_stats'] }).sync(
      { mode: 'full' },
      storage,
    );

    expect(storage.metric.mock.calls).toHaveLength(1);
    const metric = storage.metric.mock.calls[0]![0] as {
      attributes: { campaignId: string };
    };
    expect(metric.attributes.campaignId).toBe('c_sent');
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
    expect(clearedTypes).toContain('mailchimp_campaign');
    expect(clearedTypes).toContain('mailchimp_list');
    expect(clearedTypes).toContain('mailchimp_automation');
  });

  it('does not clear entity scopes on an incremental sync', async () => {
    vi.stubGlobal(
      'fetch',
      makeFetch(() => undefined),
    );
    const storage = makeStorage();
    await connector().sync(
      { mode: 'latest', since: '2024-01-01T00:00:00.000Z' },
      storage,
    );

    const entityClears = storage.entities.mock.calls.filter(
      (c) => Array.isArray(c[0]) && (c[0] as unknown[]).length === 0,
    );
    expect(entityClears).toHaveLength(0);
  });

  it('forwards options.since as since_send_time on campaigns', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    const since = '2024-01-01T00:00:00.000Z';
    await connector({ resources: ['campaigns'] }).sync(
      { mode: 'latest', since },
      makeStorage(),
    );

    const call = recordCalls(fetchSpy).find((c) =>
      c.url.includes('/campaigns'),
    );
    expect(call).toBeDefined();
    const u = new URL(call!.url);
    expect(u.searchParams.get('since_send_time')).toBe(since);
  });

  it('forwards options.since as since_date_created on lists', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    const since = '2024-01-01T00:00:00.000Z';
    await connector({ resources: ['lists'] }).sync(
      { mode: 'latest', since },
      makeStorage(),
    );

    const call = recordCalls(fetchSpy).find((c) => c.url.includes('/lists'));
    expect(call).toBeDefined();
    const u = new URL(call!.url);
    expect(u.searchParams.get('since_date_created')).toBe(since);
  });

  it('paginates campaigns using offset until a short page', async () => {
    let call = 0;
    const fetchSpy = makeFetch((url, method) => {
      if (method === 'GET' && url.includes('/campaigns')) {
        call += 1;
        const pageSize = 500;
        if (call === 1) {
          return {
            campaigns: Array.from({ length: pageSize }, (_, i) => ({
              id: `c_${i}`,
              send_time: '2024-02-01T00:00:00.000Z',
            })),
          };
        }
        return {
          campaigns: [{ id: 'c_last', send_time: '2024-02-02T00:00:00.000Z' }],
        };
      }
      return undefined;
    });
    vi.stubGlobal('fetch', fetchSpy);

    await connector({ resources: ['campaigns'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const urls = recordCalls(fetchSpy)
      .filter((c) => c.url.includes('/campaigns'))
      .map((c) => c.url);
    expect(urls).toHaveLength(2);
    expect(new URL(urls[0]!).searchParams.get('offset')).toBe('0');
    expect(new URL(urls[1]!).searchParams.get('offset')).toBe('500');
  });

  it('only fetches the resources listed in settings.resources', async () => {
    const fetchSpy = makeFetch(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);

    await connector({ resources: ['campaigns', 'lists'] }).sync(
      { mode: 'full' },
      makeStorage(),
    );

    const urls = recordCalls(fetchSpy).map((c) => c.url);
    expect(urls.some((u) => u.includes('/campaigns'))).toBe(true);
    expect(urls.some((u) => u.includes('/lists'))).toBe(true);
    expect(urls.some((u) => u.includes('/automations'))).toBe(false);
    expect(urls.some((u) => u.includes('/reports'))).toBe(false);
  });

  it('returns a transientError when the API key has no data-center suffix', async () => {
    const c = new MailchimpConnector(
      { resources: ['campaigns'] },
      { apiKey: 'invalid' as unknown as { $secret: string } },
    );
    const result = await c.sync({ mode: 'full' }, makeStorage());
    expect(result.done).toBe(false);
    expect((result.transientError as Error | undefined)?.message).toMatch(
      /data-center suffix/,
    );
  });
});

describe('MailchimpConnector.create', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the connector instance directly', () => {
    vi.stubEnv('MAILCHIMP_API_KEY', 'abc123-us1');
    const c = MailchimpConnector.create({
      apiKey: { $secret: 'MAILCHIMP_API_KEY' },
    });
    expect(c).toBeInstanceOf(MailchimpConnector);
    expect(c.id).toBe('mailchimp');
  });
});
