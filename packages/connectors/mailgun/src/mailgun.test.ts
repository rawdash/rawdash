import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  configFields,
  getWindow,
  logsItemToEvent,
  metricsItemToSample,
} from './mailgun';

describe('configFields', () => {
  it('parses a valid config', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'MAILGUN_API_KEY' },
      domain: 'mg.example.com',
    });
    expect(result.success).toBe(true);
  });

  it('defaults region to us', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'MAILGUN_API_KEY' },
      domain: 'mg.example.com',
    });
    expect(result.success && result.data.region).toBe('us');
  });

  it('rejects a plain-string key', () => {
    const result = configFields.safeParse({
      apiKey: 'key-123',
      domain: 'mg.example.com',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a missing domain', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'MAILGUN_API_KEY' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown region', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'MAILGUN_API_KEY' },
      domain: 'mg.example.com',
      region: 'apac',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown resource', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'MAILGUN_API_KEY' },
      domain: 'mg.example.com',
      resources: ['email_stats', 'webhooks'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-positive lookbackDays', () => {
    const result = configFields.safeParse({
      apiKey: { $secret: 'MAILGUN_API_KEY' },
      domain: 'mg.example.com',
      lookbackDays: 0,
    });
    expect(result.success).toBe(false);
  });
});

describe('getWindow', () => {
  const NOW = Date.UTC(2026, 5, 10, 12, 0, 0);
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  it('spans lookbackDays back from today on a full sync', () => {
    const window = getWindow({ mode: 'full' }, 30, NOW);
    const days = Math.round((window.endMs - window.startMs) / MS_PER_DAY);
    expect(days).toBe(30);
    expect(new Date(window.startMs).toISOString().slice(0, 10)).toBe(
      '2026-05-12',
    );
  });

  it('caps a wide since at lookbackDays', () => {
    const window = getWindow(
      { mode: 'full', since: '2020-01-01T00:00:00Z' },
      30,
      NOW,
    );
    expect(new Date(window.startMs).toISOString().slice(0, 10)).toBe(
      '2026-05-12',
    );
  });

  it('uses a fixed short window for latest-mode syncs', () => {
    const window = getWindow(
      { mode: 'latest', since: '2026-06-08T00:00:00Z' },
      90,
      NOW,
    );
    expect(new Date(window.startMs).toISOString().slice(0, 10)).toBe(
      '2026-06-04',
    );
  });
});

describe('metricsItemToSample', () => {
  it('maps accepted to value and the rest to measures', () => {
    const sample = metricsItemToSample(
      {
        dimensions: [
          {
            dimension: 'time',
            value: 'Wed, 03 Jun 2026 00:00:00 +0000',
            display_value: '2026-06-03',
          },
        ],
        metrics: {
          accepted_count: 100,
          delivered_count: 95,
          failed_count: 5,
          opened_count: 40,
          clicked_count: 12,
          unsubscribed_count: 1,
          complained_count: 2,
        },
      },
      'mg.example.com',
    );
    expect(sample.name).toBe('mailgun_email_stats');
    expect(sample.value).toBe(100);
    expect(sample.ts).toBe(Date.UTC(2026, 5, 3));
    expect(sample.attributes).toMatchObject({
      date: '2026-06-03',
      domain: 'mg.example.com',
      delivered: 95,
      failed: 5,
      opened: 40,
      clicked: 12,
      unsubscribed: 1,
      complained: 2,
    });
  });

  it('treats missing metric counts as zero', () => {
    const sample = metricsItemToSample(
      {
        dimensions: [{ dimension: 'time', value: '2026-06-03T00:00:00Z' }],
        metrics: {},
      },
      'mg.example.com',
    );
    expect(sample.value).toBe(0);
    expect(sample.attributes).toMatchObject({ delivered: 0, complained: 0 });
  });
});

describe('logsItemToEvent', () => {
  it('maps a log item to an event record', () => {
    const event = logsItemToEvent(
      {
        id: 'evt_1',
        event: 'delivered',
        '@timestamp': '2026-06-03T10:00:00Z',
        recipient: 'user@dest.com',
        severity: null,
        reason: null,
      },
      'mg.example.com',
    );
    expect(event.name).toBe('mailgun_event');
    expect(event.start_ts).toBe(Date.parse('2026-06-03T10:00:00Z'));
    expect(event.attributes).toMatchObject({
      eventId: 'evt_1',
      eventType: 'delivered',
      recipient: 'user@dest.com',
      domain: 'mg.example.com',
    });
  });
});

describe('MailgunConnector.sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches metrics with basic auth and the domain filter', async () => {
    const { MailgunConnector } = await import('./mailgun');
    const { InMemoryStorage } = await import('@rawdash/core');

    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(
          JSON.stringify({
            items: [
              {
                dimensions: [
                  {
                    dimension: 'time',
                    value: 'Wed, 03 Jun 2026 00:00:00 +0000',
                  },
                ],
                metrics: { accepted_count: 10, delivered_count: 9 },
              },
            ],
            pagination: { skip: 0, limit: 1000, total: 1 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }),
    );

    const storage = new InMemoryStorage();
    const connector = new MailgunConnector(
      { domain: 'mg.example.com', region: 'us', resources: ['email_stats'] },
      { apiKey: 'key-abc' as unknown as { $secret: string } },
    );
    await connector.sync({ mode: 'full' }, storage.getStorageHandle('mailgun'));

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.mailgun.net/v1/analytics/metrics');
    const headers = new Headers(calls[0]!.init.headers as HeadersInit);
    expect(headers.get('authorization')).toBe(`Basic ${btoa('api:key-abc')}`);
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.resolution).toBe('day');
    expect(body.filter.AND[0].values[0].value).toBe('mg.example.com');
  });

  it('targets the EU host when region is eu', async () => {
    const { MailgunConnector } = await import('./mailgun');
    const { InMemoryStorage } = await import('@rawdash/core');

    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        return new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    const storage = new InMemoryStorage();
    const connector = new MailgunConnector(
      { domain: 'mg.example.com', region: 'eu', resources: ['email_stats'] },
      { apiKey: 'key-abc' as unknown as { $secret: string } },
    );
    await connector.sync({ mode: 'full' }, storage.getStorageHandle('mailgun'));

    expect(calls[0]).toBe('https://api.eu.mailgun.net/v1/analytics/metrics');
  });
});
