import { afterEach, describe, expect, it, vi } from 'vitest';

import { CalComConnector, configFields, getBookingWindow } from './cal-com';

describe('configFields', () => {
  it('parses a valid config', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'CAL_API_KEY' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a config missing apiKey', () => {
    const result = configFields.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects an apiKey passed as a plain string', () => {
    const result = configFields.safeParse({ apiKey: 'plain-key' });
    expect(result.success).toBe(false);
  });

  it('rejects an apiBaseUrl that is not a URL', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'CAL_API_KEY' },
      apiBaseUrl: 'not-a-url',
    });
    expect(result.success).toBe(false);
  });

  it('accepts optional apiBaseUrl, lookbackDays, and resources', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'CAL_API_KEY' },
      apiBaseUrl: 'https://cal.example.com',
      lookbackDays: 30,
      resources: ['bookings'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lookbackDays).toBe(30);
      expect(result.data.resources).toEqual(['bookings']);
    }
  });

  it('rejects an empty resources array', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'CAL_API_KEY' },
      resources: [],
    });
    expect(result.success).toBe(false);
  });
});

describe('getBookingWindow', () => {
  it('spans lookbackDays back through the forward horizon', () => {
    const now = Date.UTC(2024, 5, 15);
    const window = getBookingWindow(90, now);
    expect(new Date(window.afterStart).getTime()).toBe(
      now - 90 * 24 * 60 * 60 * 1000,
    );
    expect(new Date(window.beforeEnd).getTime()).toBe(
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
  apiKey: 'cal_secret' as unknown as { $secret: string },
};

interface RouteResponses {
  me?: unknown;
  event_types?: unknown;
  bookings?: unknown;
}

const EMPTY: Required<RouteResponses> = {
  me: { data: { username: 'acme' } },
  event_types: { data: [] },
  bookings: { data: [], pagination: { nextCursor: null, hasMore: false } },
};

function mockFetch(responses: RouteResponses = {}) {
  const merged = { ...EMPTY, ...responses };
  const spy = vi.fn().mockImplementation((url: string | URL) => {
    const u = typeof url === 'string' ? url : url.toString();
    let body: unknown = {};
    if (u.includes('/v2/me')) {
      body = merged.me;
    } else if (u.includes('/v2/bookings')) {
      body = merged.bookings;
    } else if (u.includes('/v2/event-types')) {
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
  return new CalComConnector(settings as never, CREDS);
}

describe('CalComConnector.sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('writes event types, bookings, and cancellations', async () => {
    mockFetch({
      event_types: {
        data: [
          {
            id: 101,
            title: '30 Minute Meeting',
            slug: '30min',
            description: 'Quick intro',
            lengthInMinutes: 30,
            hidden: false,
            price: 0,
            currency: 'usd',
            ownerId: 5,
          },
        ],
      },
      bookings: {
        data: [
          {
            id: 1,
            uid: 'bk_1',
            title: 'Intro call',
            status: 'accepted',
            start: '2024-06-10T15:00:00.000Z',
            end: '2024-06-10T15:30:00.000Z',
            duration: 30,
            eventType: { id: 101, slug: '30min' },
            location: 'https://cal.example/meet',
            hosts: [{ id: 5, name: 'Host', email: 'host@acme.test' }],
            attendees: [{ name: 'Ada', email: 'ada@acme.test', absent: false }],
            createdAt: '2024-06-01T00:00:00.000Z',
            updatedAt: '2024-06-02T00:00:00.000Z',
          },
          {
            id: 2,
            uid: 'bk_2',
            title: 'Follow up',
            status: 'cancelled',
            start: '2024-06-11T15:00:00.000Z',
            end: '2024-06-11T15:30:00.000Z',
            eventTypeId: 101,
            cancellationReason: 'conflict',
            cancelledByEmail: 'ada@acme.test',
            updatedAt: '2024-06-05T00:00:00.000Z',
          },
        ],
        pagination: { nextCursor: null, hasMore: false },
      },
    });

    const storage = makeStorage();
    const result = await makeConnector().sync(
      { mode: 'full' },
      storage as never,
    );
    expect(result.done).toBe(true);

    const eventType = storage.entity.mock.calls
      .map(
        (c) =>
          c[0] as {
            type: string;
            id: string;
            attributes: Record<string, unknown>;
          },
      )
      .find((e) => e.type === 'cal_com_event_type');
    expect(eventType?.id).toBe('101');
    expect(eventType?.attributes['lengthMinutes']).toBe(30);
    expect(eventType?.attributes['ownerId']).toBe(5);

    const events = storage.event.mock.calls.map(
      (c) => c[0] as { name: string; attributes: Record<string, unknown> },
    );
    const booking = events.find(
      (e) => e.name === 'cal_com_booking' && e.attributes['uid'] === 'bk_1',
    );
    expect(booking?.attributes['attendeeEmail']).toBe('ada@acme.test');
    expect(booking?.attributes['hostEmail']).toBe('host@acme.test');
    expect(booking?.attributes['eventTypeId']).toBe(101);
    expect(booking?.attributes['cancelled']).toBe(false);

    const cancellation = events.find((e) => e.name === 'cal_com_cancellation');
    expect(cancellation?.attributes['reason']).toBe('conflict');
    expect(cancellation?.attributes['cancelledByEmail']).toBe('ada@acme.test');
    expect(cancellation?.attributes['bookingUid']).toBe('bk_2');
  });

  it('counts no-shows from attendee absence flags', async () => {
    mockFetch({
      bookings: {
        data: [
          {
            id: 1,
            uid: 'bk_1',
            title: 'Group session',
            status: 'accepted',
            start: '2024-06-10T15:00:00.000Z',
            attendees: [
              { email: 'a@x.test', absent: false },
              { email: 'b@x.test', absent: true },
            ],
          },
        ],
        pagination: { nextCursor: null, hasMore: false },
      },
    });

    const storage = makeStorage();
    await makeConnector({ resources: ['bookings'] }).sync(
      { mode: 'full' },
      storage as never,
    );

    const booking = storage.event.mock.calls[0]![0] as {
      attributes: Record<string, unknown>;
    };
    expect(booking.attributes['noShowCount']).toBe(1);
    expect(booking.attributes['attendeeCount']).toBe(2);
  });

  it('follows the booking pagination cursor across pages', async () => {
    const page1 = {
      data: [
        {
          id: 1,
          uid: 'bk_1',
          status: 'accepted',
          start: '2024-06-10T15:00:00.000Z',
        },
      ],
      pagination: { nextCursor: 'CURSOR2', hasMore: true },
    };
    const page2 = {
      data: [
        {
          id: 2,
          uid: 'bk_2',
          status: 'accepted',
          start: '2024-06-11T15:00:00.000Z',
        },
      ],
      pagination: { nextCursor: null, hasMore: false },
    };
    const spy = vi.fn().mockImplementation((url: string | URL) => {
      const u = typeof url === 'string' ? url : url.toString();
      let body: unknown = { data: [] };
      if (u.includes('/v2/me')) {
        body = { data: { username: 'acme' } };
      } else if (u.includes('/v2/bookings')) {
        body = u.includes('cursor=CURSOR2') ? page2 : page1;
      } else if (u.includes('/v2/event-types')) {
        body = { data: [] };
      }
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });
    vi.stubGlobal('fetch', spy);

    const storage = makeStorage();
    await makeConnector({ resources: ['bookings'] }).sync(
      { mode: 'full' },
      storage as never,
    );

    const uids = storage.event.mock.calls.map(
      (c) =>
        (c[0] as { attributes: Record<string, unknown> }).attributes['uid'],
    );
    expect(uids).toEqual(['bk_1', 'bk_2']);
  });

  it('clears the booking window at the start of a sync', async () => {
    mockFetch();
    const storage = makeStorage();
    await makeConnector({ resources: ['bookings'] }).sync(
      { mode: 'latest' },
      storage as never,
    );
    expect(storage.events).toHaveBeenCalledWith([], {
      names: ['cal_com_booking'],
    });
  });

  it('respects a custom apiBaseUrl', async () => {
    const spy = mockFetch();
    const storage = makeStorage();
    await makeConnector({ apiBaseUrl: 'https://cal.example.com/' }).sync(
      { mode: 'full' },
      storage as never,
    );
    const calledUrls = spy.mock.calls.map((c) => String(c[0]));
    expect(
      calledUrls.every((u) => u.startsWith('https://cal.example.com/v2/')),
    ).toBe(true);
  });
});
