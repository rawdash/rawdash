import { metricStoreFor } from '@rawdash/connector-test-utils';
import { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PostmarkConnector,
  configFields,
  getStatsWindow,
  mergeDayBuckets,
} from './postmark';

const CONNECTOR_ID = 'postmark';
const TOKEN = 'POSTMARK_SERVER_TOKEN' as unknown as { $secret: string };

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

function routeBody(url: string): unknown {
  if (url.includes('/stats/outbound/sends')) {
    return {
      Sent: 30,
      Days: [
        { Date: '2025-03-01', Sent: 10 },
        { Date: '2025-03-02', Sent: 20 },
      ],
    };
  }
  if (url.includes('/stats/outbound/bounces')) {
    return {
      HardBounce: 3,
      Days: [{ Date: '2025-03-02', HardBounce: 2, SoftBounce: 1 }],
    };
  }
  if (url.includes('/stats/outbound/spam')) {
    return {
      SpamComplaint: 1,
      Days: [{ Date: '2025-03-02', SpamComplaint: 1 }],
    };
  }
  if (url.includes('/stats/outbound/opens')) {
    return {
      Opens: 12,
      Unique: 9,
      Days: [{ Date: '2025-03-01', Opens: 12, Unique: 9 }],
    };
  }
  if (url.includes('/bounces')) {
    return {
      TotalCount: 1,
      Bounces: [
        {
          ID: 7,
          Type: 'HardBounce',
          TypeCode: 1,
          Name: 'Hard bounce',
          Email: 'user@example.com',
          From: 'sender@example.com',
          Tag: 'welcome',
          MessageStream: 'outbound',
          MessageID: 'm_7',
          ServerID: 42,
          Subject: 'Welcome',
          BouncedAt: '2025-03-02T08:00:00Z',
          Inactive: true,
          CanActivate: true,
          DumpAvailable: false,
        },
      ],
    };
  }
  return {};
}

function makeFetch(): { spy: ReturnType<typeof vi.fn>; calls: MockCall[] } {
  const calls: MockCall[] = [];
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
      return Promise.resolve(jsonResponse(routeBody(u)));
    });
  return { spy, calls };
}

describe('configFields', () => {
  it('parses a minimal config with only serverToken', () => {
    expect(
      configFields.safeParse({
        serverToken: { $secret: 'POSTMARK_SERVER_TOKEN' },
      }).success,
    ).toBe(true);
  });

  it('parses a config with message stream and resources', () => {
    expect(
      configFields.safeParse({
        serverToken: { $secret: 'POSTMARK_SERVER_TOKEN' },
        messageStream: 'broadcast',
        resources: ['email_stats'],
      }).success,
    ).toBe(true);
  });

  it('rejects an unknown resource', () => {
    expect(
      configFields.safeParse({
        serverToken: { $secret: 'POSTMARK_SERVER_TOKEN' },
        resources: ['email_stats', 'messages'],
      }).success,
    ).toBe(false);
  });

  it('rejects a plain string serverToken instead of a secret object', () => {
    expect(configFields.safeParse({ serverToken: 'abc' }).success).toBe(false);
  });

  it('rejects a config missing serverToken', () => {
    expect(configFields.safeParse({}).success).toBe(false);
  });
});

describe('getStatsWindow', () => {
  const now = Date.UTC(2025, 2, 10);

  it('uses the full lookback window for a full sync', () => {
    const window = getStatsWindow({ mode: 'full' }, 30, now);
    expect(window.to).toBe('2025-03-10');
    expect(window.from).toBe('2025-02-09');
  });

  it('uses a short window for an incremental sync', () => {
    const window = getStatsWindow({ mode: 'latest' }, 90, now);
    expect(window.to).toBe('2025-03-10');
    expect(window.from).toBe('2025-02-25');
  });

  it('caps the window at lookbackDays even with an older since', () => {
    const window = getStatsWindow(
      { mode: 'full', since: '2024-01-01' },
      30,
      now,
    );
    expect(window.from).toBe('2025-02-09');
  });
});

describe('mergeDayBuckets', () => {
  it('merges counters across endpoints keyed by date', () => {
    const buckets = mergeDayBuckets({
      sends: { Days: [{ Date: '2025-03-01', Sent: 10 }] },
      bounces: { Days: [{ Date: '2025-03-01', HardBounce: 2, SoftBounce: 1 }] },
      spam: { Days: [{ Date: '2025-03-01', SpamComplaint: 1 }] },
      opens: { Days: [{ Date: '2025-03-01', Opens: 5, Unique: 4 }] },
    });
    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toMatchObject({
      date: '2025-03-01',
      sent: 10,
      hardBounces: 2,
      softBounces: 1,
      spamComplaints: 1,
      opens: 5,
      uniqueOpens: 4,
    });
  });
});

describe('PostmarkConnector sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('writes daily stats metrics with derived delivered and bounce rate', async () => {
    const { spy } = makeFetch();
    vi.stubGlobal('fetch', spy);

    const storage = new InMemoryStorage();
    const handle = storage.getStorageHandle(CONNECTOR_ID);
    await new PostmarkConnector(
      { resources: ['email_stats'] },
      { serverToken: TOKEN },
    ).sync({ mode: 'full' }, handle);

    const samples = (
      await handle.queryMetrics({ name: 'postmark_email_stats' })
    )
      .slice()
      .sort((a, b) => a.ts - b.ts);
    expect(samples).toHaveLength(2);

    const day2 = samples[1]!;
    expect(day2.value).toBe(20);
    expect(day2.attributes).toMatchObject({
      stream: 'all',
      bounced: 3,
      delivered: 17,
      hardBounces: 2,
      softBounces: 1,
      spamComplaints: 1,
    });
  });

  it('writes one bounce event per bounce record and sends the auth header', async () => {
    const { spy, calls } = makeFetch();
    vi.stubGlobal('fetch', spy);

    const storage = new InMemoryStorage();
    await new PostmarkConnector(
      { resources: ['bounces'] },
      { serverToken: TOKEN },
    ).sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));

    const events = await storage
      .getStorageHandle(CONNECTOR_ID)
      .queryEvents({ name: 'postmark_bounce' });
    expect(events).toHaveLength(1);
    expect(events[0]!.attributes).toMatchObject({
      bounceId: 7,
      type: 'HardBounce',
      email: 'user@example.com',
      messageStream: 'outbound',
    });

    const bounceCall = calls.find(
      (c) => new URL(c.url).pathname === '/bounces',
    );
    expect(bounceCall?.headers['x-postmark-server-token']).toBe(
      'POSTMARK_SERVER_TOKEN',
    );
  });

  it('passes the message stream filter when configured', async () => {
    const { spy, calls } = makeFetch();
    vi.stubGlobal('fetch', spy);

    const storage = new InMemoryStorage();
    await new PostmarkConnector(
      { messageStream: 'broadcast', resources: ['email_stats'] },
      { serverToken: TOKEN },
    ).sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));

    const sendsCall = calls.find((c) =>
      c.url.includes('/stats/outbound/sends'),
    );
    expect(sendsCall?.url).toContain('messagestream=broadcast');
  });

  it('preserves metric history outside the synced window on incremental sync', async () => {
    const { spy } = makeFetch();
    vi.stubGlobal('fetch', spy);

    const storage = new InMemoryStorage();
    const handle = storage.getStorageHandle(CONNECTOR_ID);
    const oldTs = Date.UTC(2020, 0, 1);
    await handle.metric({
      name: 'postmark_email_stats',
      ts: oldTs,
      value: 999,
      attributes: { date: '2020-01-01', stream: 'all' },
    });

    await new PostmarkConnector(
      { resources: ['email_stats'] },
      { serverToken: TOKEN },
    ).sync({ mode: 'latest' }, handle);

    const preserved = metricStoreFor(storage, CONNECTOR_ID).filter(
      (m) => m.name === 'postmark_email_stats' && m.ts === oldTs,
    );
    expect(preserved).toHaveLength(1);
  });

  it('only syncs the requested resource', async () => {
    const { spy, calls } = makeFetch();
    vi.stubGlobal('fetch', spy);

    const storage = new InMemoryStorage();
    await new PostmarkConnector(
      { resources: ['email_stats'] },
      { serverToken: TOKEN },
    ).sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));

    expect(calls.some((c) => new URL(c.url).pathname === '/bounces')).toBe(
      false,
    );
  });
});
