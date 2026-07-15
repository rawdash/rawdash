import { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  OneSignalConnector,
  bucketNotificationsByDay,
  configFields,
  notificationToEntity,
} from './onesignal';

const CONNECTOR_ID = 'onesignal';
const KEY = 'ONESIGNAL_REST_API_KEY' as unknown as { $secret: string };
const APP_ID = '11111111-1111-1111-1111-111111111111';

const DAY1 = Math.floor(Date.UTC(2026, 0, 10, 8) / 1000);
const DAY1_LATE = Math.floor(Date.UTC(2026, 0, 10, 20) / 1000);
const DAY2 = Math.floor(Date.UTC(2026, 0, 11, 9) / 1000);

interface MockCall {
  url: string;
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

function makeNotification(overrides: Record<string, unknown> = {}) {
  return {
    id: 'n_1',
    name: 'Campaign',
    contents: { en: 'Body', es: 'Cuerpo' },
    headings: { en: 'Title' },
    url: 'https://example.com',
    successful: 900,
    failed: 80,
    errored: 20,
    converted: 100,
    received: 850,
    remaining: 0,
    canceled: false,
    queued_at: DAY1,
    send_after: DAY1,
    completed_at: DAY1 + 100,
    ...overrides,
  };
}

function makeFetch(pages: unknown[]): {
  spy: ReturnType<typeof vi.fn>;
  calls: MockCall[];
} {
  const calls: MockCall[] = [];
  let index = 0;
  const spy = vi
    .fn()
    .mockImplementation((url: string | URL, init?: RequestInit) => {
      const u = typeof url === 'string' ? url : url.toString();
      const headers: Record<string, string> = {};
      const raw = init?.headers as Record<string, string> | undefined;
      if (raw) {
        for (const [k, v] of Object.entries(raw)) {
          headers[k] = v;
        }
      }
      calls.push({ url: u, headers });
      const body = pages[Math.min(index, pages.length - 1)];
      index += 1;
      return Promise.resolve(jsonResponse(body));
    });
  return { spy, calls };
}

function page(notifications: unknown[], totalCount?: number): unknown {
  return {
    total_count: totalCount ?? notifications.length,
    offset: 0,
    limit: 50,
    notifications,
  };
}

describe('configFields', () => {
  it('parses a minimal config with apiKey and appId', () => {
    expect(
      configFields.safeParse({
        apiKey: { $secret: 'ONESIGNAL_REST_API_KEY' },
        appId: APP_ID,
      }).success,
    ).toBe(true);
  });

  it('rejects a config missing appId', () => {
    expect(
      configFields.safeParse({
        apiKey: { $secret: 'ONESIGNAL_REST_API_KEY' },
      }).success,
    ).toBe(false);
  });

  it('rejects a plain string apiKey instead of a secret object', () => {
    expect(
      configFields.safeParse({ apiKey: 'abc', appId: APP_ID }).success,
    ).toBe(false);
  });

  it('rejects an unknown resource', () => {
    expect(
      configFields.safeParse({
        apiKey: { $secret: 'ONESIGNAL_REST_API_KEY' },
        appId: APP_ID,
        resources: ['notifications', 'players'],
      }).success,
    ).toBe(false);
  });
});

describe('notificationToEntity', () => {
  it('maps counters, derived rates, and timestamps', () => {
    const entity = notificationToEntity(makeNotification());
    expect(entity.type).toBe('onesignal_notification');
    expect(entity.id).toBe('n_1');
    expect(entity.attributes).toMatchObject({
      name: 'Campaign',
      message: 'Body',
      heading: 'Title',
      successful: 900,
      failed: 80,
      errored: 20,
      converted: 100,
      recipients: 1000,
      deliveryRate: 0.9,
      conversionRate: 100 / 900,
      canceled: false,
    });
    expect(entity.attributes.queuedAt).toBe(DAY1 * 1000);
    expect(entity.updated_at).toBe((DAY1 + 100) * 1000);
  });

  it('falls back to a non-English content string and guards divide-by-zero', () => {
    const entity = notificationToEntity(
      makeNotification({
        contents: { es: 'Solo' },
        headings: null,
        successful: 0,
        failed: 0,
        errored: 0,
        converted: 0,
      }),
    );
    expect(entity.attributes.message).toBe('Solo');
    expect(entity.attributes.heading).toBeNull();
    expect(entity.attributes.recipients).toBe(0);
    expect(entity.attributes.deliveryRate).toBe(0);
    expect(entity.attributes.conversionRate).toBe(0);
  });
});

describe('bucketNotificationsByDay', () => {
  it('aggregates counters per UTC queued day', () => {
    const buckets = bucketNotificationsByDay([
      makeNotification({ queued_at: DAY1, successful: 100 }),
      makeNotification({ queued_at: DAY1_LATE, successful: 50, failed: 5 }),
      makeNotification({ queued_at: DAY2, successful: 10 }),
    ]);
    expect([...buckets.keys()].sort()).toEqual(['2026-01-10', '2026-01-11']);
    expect(buckets.get('2026-01-10')).toMatchObject({
      notifications: 2,
      successful: 150,
      failed: 85,
    });
    expect(buckets.get('2026-01-11')).toMatchObject({
      notifications: 1,
      successful: 10,
    });
  });

  it('skips records without a queued timestamp', () => {
    const buckets = bucketNotificationsByDay([
      makeNotification({ queued_at: null }),
    ]);
    expect(buckets.size).toBe(0);
  });
});

describe('OneSignalConnector sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('writes one entity per notification and sends the Key auth header', async () => {
    const recent = Math.floor(Date.now() / 1000) - 24 * 3600;
    const { spy, calls } = makeFetch([
      page([makeNotification({ queued_at: recent, completed_at: recent })]),
    ]);
    vi.stubGlobal('fetch', spy);

    const storage = new InMemoryStorage();
    const handle = storage.getStorageHandle(CONNECTOR_ID);
    await new OneSignalConnector(
      { appId: APP_ID, resources: ['notifications'] },
      { apiKey: KEY },
    ).sync({ mode: 'full' }, handle);

    const entities = await handle.queryEntities({
      type: 'onesignal_notification',
    });
    expect(entities).toHaveLength(1);
    expect(entities[0]!.attributes).toMatchObject({ successful: 900 });

    expect(calls[0]!.url).toContain(`app_id=${APP_ID}`);
    expect(calls[0]!.url).toContain('limit=50');
    expect(calls[0]!.headers.authorization).toBe('Key ONESIGNAL_REST_API_KEY');
  });

  it('writes daily stats metrics with recipients as the value', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const olderDay = nowSec - 2 * 24 * 3600;
    const newerDay = nowSec - 1 * 24 * 3600;
    const { spy } = makeFetch([
      page([
        makeNotification({
          queued_at: olderDay,
          successful: 100,
          failed: 10,
          errored: 0,
        }),
        makeNotification({
          queued_at: newerDay,
          successful: 20,
          failed: 0,
          errored: 0,
        }),
      ]),
    ]);
    vi.stubGlobal('fetch', spy);

    const storage = new InMemoryStorage();
    const handle = storage.getStorageHandle(CONNECTOR_ID);
    await new OneSignalConnector(
      { appId: APP_ID, resources: ['notification_stats'] },
      { apiKey: KEY },
    ).sync({ mode: 'full' }, handle);

    const samples = (
      await handle.queryMetrics({ name: 'onesignal_notification_stats' })
    )
      .slice()
      .sort((a, b) => a.ts - b.ts);
    expect(samples).toHaveLength(2);
    const expectedDate = new Date(olderDay * 1000).toISOString().slice(0, 10);
    expect(samples[0]!.value).toBe(110);
    expect(samples[0]!.attributes).toMatchObject({
      date: expectedDate,
      delivered: 100,
      failed: 10,
    });
  });

  it('stops paging once a page predates the incremental cutoff', async () => {
    const recent = makeNotification({
      id: 'recent',
      queued_at: Math.floor(Date.now() / 1000) - 3600,
    });
    const old = makeNotification({
      id: 'old',
      queued_at: Math.floor(Date.now() / 1000) - 60 * 24 * 3600,
    });
    const { spy, calls } = makeFetch([page([recent, old], 100), page([], 100)]);
    vi.stubGlobal('fetch', spy);

    const storage = new InMemoryStorage();
    const handle = storage.getStorageHandle(CONNECTOR_ID);
    await new OneSignalConnector(
      { appId: APP_ID, resources: ['notifications'] },
      { apiKey: KEY },
    ).sync({ mode: 'latest' }, handle);

    const entities = await handle.queryEntities({
      type: 'onesignal_notification',
    });
    expect(entities.map((e) => e.id)).toEqual(['recent']);
    expect(calls).toHaveLength(1);
  });

  it('only calls the notifications endpoint for the selected resource', async () => {
    const { spy, calls } = makeFetch([page([makeNotification()])]);
    vi.stubGlobal('fetch', spy);

    const storage = new InMemoryStorage();
    const handle = storage.getStorageHandle(CONNECTOR_ID);
    await new OneSignalConnector(
      { appId: APP_ID, resources: ['notifications'] },
      { apiKey: KEY },
    ).sync({ mode: 'full' }, handle);

    const metrics = await handle.queryMetrics({
      name: 'onesignal_notification_stats',
    });
    expect(metrics).toHaveLength(0);
    expect(calls).toHaveLength(1);
  });
});
