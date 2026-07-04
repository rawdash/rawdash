import { afterEach, describe, expect, it, vi } from 'vitest';

import { CalendlyConnector, configFields, getStartWindow } from './calendly';

const ORG = 'https://api.calendly.com/organizations/AAAAAAAAAAAAAAAA';

describe('configFields', () => {
  it('parses a valid config', () => {
    const result = configFields.safeParse({
      apiToken: { $secret: 'CALENDLY_API_TOKEN' },
      organizationUri: ORG,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a config missing apiToken', () => {
    const result = configFields.safeParse({ organizationUri: ORG });
    expect(result.success).toBe(false);
  });

  it('rejects an apiToken passed as a plain string', () => {
    const result = configFields.safeParse({
      apiToken: 'plain-token',
      organizationUri: ORG,
    });
    expect(result.success).toBe(false);
  });

  it('rejects an organizationUri that is not an organization URI', () => {
    const result = configFields.safeParse({
      apiToken: { $secret: 'CALENDLY_API_TOKEN' },
      organizationUri: 'https://api.calendly.com/users/me',
    });
    expect(result.success).toBe(false);
  });

  it('accepts optional lookbackDays and resources', () => {
    const result = configFields.safeParse({
      apiToken: { $secret: 'CALENDLY_API_TOKEN' },
      organizationUri: ORG,
      lookbackDays: 30,
      resources: ['scheduled_events'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lookbackDays).toBe(30);
      expect(result.data.resources).toEqual(['scheduled_events']);
    }
  });

  it('rejects an empty resources array', () => {
    const result = configFields.safeParse({
      apiToken: { $secret: 'CALENDLY_API_TOKEN' },
      organizationUri: ORG,
      resources: [],
    });
    expect(result.success).toBe(false);
  });
});

describe('getStartWindow', () => {
  it('spans lookbackDays back through the forward horizon', () => {
    const now = Date.UTC(2024, 5, 15);
    const window = getStartWindow(90, now);
    expect(new Date(window.minStartTime).getTime()).toBe(
      now - 90 * 24 * 60 * 60 * 1000,
    );
    expect(new Date(window.maxStartTime).getTime()).toBe(
      now + 60 * 24 * 60 * 60 * 1000,
    );
  });
});

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
  apiToken: 'calendly_secret' as unknown as { $secret: string },
};

interface RouteResponses {
  event_types?: unknown;
  scheduled_events?: unknown;
  invitees?: unknown;
}

const EMPTY: Required<RouteResponses> = {
  event_types: { collection: [], pagination: { next_page_token: null } },
  scheduled_events: { collection: [], pagination: { next_page_token: null } },
  invitees: { collection: [], pagination: { next_page_token: null } },
};

function mockFetch(responses: RouteResponses = {}) {
  const merged = { ...EMPTY, ...responses };
  const spy = vi.fn().mockImplementation((url: string | URL) => {
    const u = typeof url === 'string' ? url : url.toString();
    let body: unknown = {};
    if (/\/scheduled_events\/[^/]+\/invitees/.test(u)) {
      body = merged.invitees;
    } else if (u.includes('/scheduled_events')) {
      body = merged.scheduled_events;
    } else if (u.includes('/event_types')) {
      body = merged.event_types;
    }
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

function makeConnector(settings: Record<string, unknown> = {}) {
  return new CalendlyConnector(
    { organizationUri: ORG, ...settings } as never,
    CREDS,
  );
}

describe('CalendlyConnector.sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('writes event types, scheduled events, and cancellations', async () => {
    mockFetch({
      event_types: {
        collection: [
          {
            uri: 'https://api.calendly.com/event_types/ET1',
            name: '30 Minute Meeting',
            active: true,
            slug: '30min',
            kind: 'solo',
            duration: 30,
            scheduling_url: 'https://calendly.com/acme/30min',
            created_at: '2024-01-01T00:00:00.000000Z',
            updated_at: '2024-02-01T00:00:00.000000Z',
            profile: {
              type: 'User',
              owner: 'https://api.calendly.com/users/U1',
            },
          },
        ],
        pagination: { next_page_token: null },
      },
      scheduled_events: {
        collection: [
          {
            uri: 'https://api.calendly.com/scheduled_events/SE1',
            name: 'Intro call',
            status: 'active',
            start_time: '2024-06-10T15:00:00.000000Z',
            end_time: '2024-06-10T15:30:00.000000Z',
            created_at: '2024-06-01T00:00:00.000000Z',
            updated_at: '2024-06-02T00:00:00.000000Z',
            event_type: 'https://api.calendly.com/event_types/ET1',
            invitees_counter: { total: 1, active: 1, limit: 1 },
            event_memberships: [
              { user_email: 'host@acme.test', user_name: 'Host' },
            ],
          },
          {
            uri: 'https://api.calendly.com/scheduled_events/SE2',
            name: 'Follow up',
            status: 'canceled',
            start_time: '2024-06-11T15:00:00.000000Z',
            end_time: '2024-06-11T15:30:00.000000Z',
            event_type: 'https://api.calendly.com/event_types/ET1',
            cancellation: {
              canceled_by: 'Ada',
              canceler_type: 'invitee',
              reason: 'conflict',
              created_at: '2024-06-05T00:00:00.000000Z',
            },
          },
        ],
        pagination: { next_page_token: null },
      },
      invitees: {
        collection: [
          {
            uri: 'https://api.calendly.com/scheduled_events/SE1/invitees/IN1',
            email: 'ada@acme.test',
            name: 'Ada',
            status: 'active',
            created_at: '2024-06-01T00:00:00.000000Z',
            no_show: null,
          },
        ],
        pagination: { next_page_token: null },
      },
    });

    const storage = makeStorage();
    const result = await makeConnector().sync(
      { mode: 'full' },
      storage as never,
    );
    expect(result.done).toBe(true);

    const eventType = storage.entity.mock.calls
      .map((c) => c[0] as { type: string; attributes: Record<string, unknown> })
      .find((e) => e.type === 'calendly_event_type');
    expect(eventType?.attributes['durationMinutes']).toBe(30);
    expect(eventType?.attributes['ownerUri']).toBe(
      'https://api.calendly.com/users/U1',
    );

    const events = storage.event.mock.calls.map(
      (c) => c[0] as { name: string; attributes: Record<string, unknown> },
    );
    const booking = events.find(
      (e) =>
        e.name === 'calendly_scheduled_event' &&
        e.attributes['uri'] === 'https://api.calendly.com/scheduled_events/SE1',
    );
    expect(booking?.attributes['inviteeEmail']).toBe('ada@acme.test');
    expect(booking?.attributes['hostEmail']).toBe('host@acme.test');
    expect(booking?.attributes['canceled']).toBe(false);

    const cancellation = events.find((e) => e.name === 'calendly_cancellation');
    expect(cancellation?.attributes['reason']).toBe('conflict');
    expect(cancellation?.attributes['canceledBy']).toBe('Ada');
  });

  it('counts no-shows from the invitees endpoint', async () => {
    mockFetch({
      scheduled_events: {
        collection: [
          {
            uri: 'https://api.calendly.com/scheduled_events/SE1',
            name: 'Group session',
            status: 'active',
            start_time: '2024-06-10T15:00:00.000000Z',
            invitees_counter: { total: 2, active: 2, limit: 10 },
          },
        ],
        pagination: { next_page_token: null },
      },
      invitees: {
        collection: [
          { uri: 'a', email: 'a@x.test', status: 'active', no_show: null },
          {
            uri: 'b',
            email: 'b@x.test',
            status: 'active',
            no_show: { uri: 'ns', created_at: '2024-06-10T16:00:00.000000Z' },
          },
        ],
        pagination: { next_page_token: null },
      },
    });

    const storage = makeStorage();
    await makeConnector({ resources: ['scheduled_events'] }).sync(
      { mode: 'full' },
      storage as never,
    );

    const booking = storage.event.mock.calls[0]![0] as {
      attributes: Record<string, unknown>;
    };
    expect(booking.attributes['noShowCount']).toBe(1);
  });

  it('skips invitee fetches when only cancellations is enabled', async () => {
    const spy = mockFetch({
      scheduled_events: {
        collection: [
          {
            uri: 'https://api.calendly.com/scheduled_events/SE2',
            name: 'Canceled',
            status: 'canceled',
            start_time: '2024-06-11T15:00:00.000000Z',
            cancellation: {
              reason: 'conflict',
              created_at: '2024-06-05T00:00:00.000000Z',
            },
          },
        ],
        pagination: { next_page_token: null },
      },
    });

    const storage = makeStorage();
    await makeConnector({ resources: ['cancellations'] }).sync(
      { mode: 'full' },
      storage as never,
    );

    const inviteeCalls = spy.mock.calls.filter((c) =>
      /\/invitees/.test(String(c[0])),
    );
    expect(inviteeCalls).toHaveLength(0);
    const events = storage.event.mock.calls.map(
      (c) => c[0] as { name: string },
    );
    expect(events.every((e) => e.name === 'calendly_cancellation')).toBe(true);
  });

  it('clears the scheduled-event window at the start of a sync', async () => {
    mockFetch();
    const storage = makeStorage();
    await makeConnector({ resources: ['scheduled_events'] }).sync(
      { mode: 'latest' },
      storage as never,
    );
    expect(storage.events).toHaveBeenCalledWith([], {
      names: ['calendly_scheduled_event'],
    });
  });
});
