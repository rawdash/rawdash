import {
  eventStoreFor,
  installFetchMock,
  metricStoreFor,
} from '@rawdash/connector-test-utils';
import { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TwilioConnector, usageWindowFor } from './twilio';

const CONNECTOR_ID = 'twilio';
const ACCOUNT_SID = 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
const SECRET = 'auth_token_secret' as unknown as { $secret: string };
const MS_PER_DAY = 86_400_000;

function makeConnector(
  overrides: Partial<{
    resources: readonly (
      | 'twilio_message'
      | 'twilio_call'
      | 'twilio_usage_count'
      | 'twilio_usage_price'
    )[];
    lookbackDays: number;
  }> = {},
): TwilioConnector {
  return new TwilioConnector(
    { accountSid: ACCOUNT_SID, ...overrides },
    { authToken: SECRET },
  );
}

function messageFixture(sid: string, sentAt: string) {
  return {
    sid,
    status: 'delivered',
    error_code: null,
    direction: 'outbound-api',
    price: '-0.00750',
    price_unit: 'USD',
    date_sent: sentAt,
    date_created: sentAt,
    from: '+15551112222',
    to: '+15553334444',
    num_segments: '1',
    num_media: '0',
    messaging_service_sid: null,
  };
}

function usageFixture(
  category: string,
  date: string,
  price: string | number = '-0.9',
) {
  return {
    category,
    description: category.toUpperCase(),
    count: '120',
    count_unit: 'messages',
    usage: '120',
    usage_unit: 'messages',
    price,
    price_unit: 'USD',
    start_date: date,
    end_date: date,
  };
}

function utcDate(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);
}

function messagesPath(query: string): string {
  return `/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json?${query}`;
}

function usagePath(query: string): string {
  return `/2010-04-01/Accounts/${ACCOUNT_SID}/Usage/Records/Daily.json?${query}`;
}

const EMPTY = {
  messages: [],
  calls: [],
  usage_records: [],
  next_page_uri: null,
};

describe('TwilioConnector paged writes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retains every page of messages when the window spans multiple pages', async () => {
    installFetchMock((url) => {
      if (!url.includes('/Messages.json')) {
        return EMPTY;
      }
      if (url.includes('PageToken=page2')) {
        return {
          messages: [messageFixture('SM2', 'Mon, 01 Jan 2024 00:00:00 +0000')],
          next_page_uri: null,
        };
      }
      return {
        messages: [messageFixture('SM1', 'Tue, 02 Jan 2024 00:00:00 +0000')],
        next_page_uri: messagesPath('PageToken=page2'),
      };
    });

    const storage = new InMemoryStorage();
    await makeConnector({ resources: ['twilio_message'] }).sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    const sids = eventStoreFor<{
      name: string;
      attributes: { sid: string };
    }>(storage, CONNECTOR_ID)
      .filter((e) => e.name === 'twilio_message')
      .map((e) => e.attributes.sid);
    expect(sids.sort()).toEqual(['SM1', 'SM2']);
  });

  it('retains every page of usage records when the window spans multiple pages', async () => {
    installFetchMock((url) => {
      if (!url.includes('/Usage/Records/Daily.json')) {
        return EMPTY;
      }
      if (url.includes('PageToken=page2')) {
        return {
          usage_records: [usageFixture('calls', utcDate(0))],
          next_page_uri: null,
        };
      }
      return {
        usage_records: [usageFixture('sms', utcDate(0))],
        next_page_uri: usagePath('PageToken=page2'),
      };
    });

    const storage = new InMemoryStorage();
    await makeConnector({
      resources: ['twilio_usage_count', 'twilio_usage_price'],
    }).sync({ mode: 'full' }, storage.getStorageHandle(CONNECTOR_ID));

    const counts = metricStoreFor<{
      name: string;
      attributes: { category: string };
    }>(storage, CONNECTOR_ID).filter((m) => m.name === 'twilio_usage_count');
    expect(counts.map((m) => m.attributes.category).sort()).toEqual([
      'calls',
      'sms',
    ]);
  });

  it('keeps history outside the refetched window across an incremental sync', async () => {
    const oldDay = utcDate(-20);
    const today = utcDate(0);

    installFetchMock((url) => {
      if (url.includes('/Messages.json')) {
        return {
          messages: [
            messageFixture('SM_OLD', 'Mon, 01 Jan 2024 00:00:00 +0000'),
          ],
          next_page_uri: null,
        };
      }
      if (url.includes('/Usage/Records/Daily.json')) {
        return {
          usage_records: [
            usageFixture('sms', oldDay),
            usageFixture('sms', today),
          ],
          next_page_uri: null,
        };
      }
      return EMPTY;
    });

    const storage = new InMemoryStorage();
    const handle = storage.getStorageHandle(CONNECTOR_ID);
    const connector = makeConnector({
      resources: ['twilio_message', 'twilio_usage_count'],
    });
    await connector.sync({ mode: 'full' }, handle);

    installFetchMock((url) => {
      if (url.includes('/Messages.json')) {
        return {
          messages: [
            messageFixture('SM_NEW', 'Wed, 03 Jan 2024 00:00:00 +0000'),
          ],
          next_page_uri: null,
        };
      }
      if (url.includes('/Usage/Records/Daily.json')) {
        return {
          usage_records: [usageFixture('sms', today)],
          next_page_uri: null,
        };
      }
      return EMPTY;
    });
    await connector.sync(
      { mode: 'latest', since: new Date().toISOString() },
      handle,
    );

    const sids = eventStoreFor<{
      name: string;
      attributes: { sid: string };
    }>(storage, CONNECTOR_ID)
      .filter((e) => e.name === 'twilio_message')
      .map((e) => e.attributes.sid);
    expect(sids.sort()).toEqual(['SM_NEW', 'SM_OLD']);

    const days = metricStoreFor<{ name: string; ts: number }>(
      storage,
      CONNECTOR_ID,
    )
      .filter((m) => m.name === 'twilio_usage_count')
      .map((m) => new Date(m.ts).toISOString().slice(0, 10));
    expect(days.sort()).toEqual([oldDay, today]);
  });

  it('honors options.resources by resource name for phases and writes', async () => {
    const requested: string[] = [];
    installFetchMock((url) => {
      requested.push(url);
      if (url.includes('/Usage/Records/Daily.json')) {
        return {
          usage_records: [usageFixture('sms', utcDate(0))],
          next_page_uri: null,
        };
      }
      return EMPTY;
    });

    const storage = new InMemoryStorage();
    await makeConnector().sync(
      { mode: 'full', resources: new Set(['twilio_usage_price']) },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    expect(requested.some((u) => u.includes('/Messages.json'))).toBe(false);
    expect(requested.some((u) => u.includes('/Calls.json'))).toBe(false);
    const names = metricStoreFor<{ name: string }>(storage, CONNECTOR_ID).map(
      (m) => m.name,
    );
    expect(names).toEqual(['twilio_usage_price']);
  });

  it('parses a usage record price returned as a JSON number', async () => {
    installFetchMock((url) =>
      url.includes('/Usage/Records/Daily.json')
        ? {
            usage_records: [usageFixture('sms', utcDate(0), -0.9)],
            next_page_uri: null,
          }
        : EMPTY,
    );

    const storage = new InMemoryStorage();
    await makeConnector({ resources: ['twilio_usage_price'] }).sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    const prices = metricStoreFor<{ name: string; value: number }>(
      storage,
      CONNECTOR_ID,
    ).filter((m) => m.name === 'twilio_usage_price');
    expect(prices.map((m) => m.value)).toEqual([0.9]);
  });
});

describe('usageWindowFor', () => {
  const now = Date.parse('2026-03-10T12:00:00.000Z');

  it('spans the configured lookback on a full sync, floored to UTC days', () => {
    const window = usageWindowFor({ mode: 'full' }, 30, now);
    expect(new Date(window.startMs).toISOString()).toBe(
      '2026-02-08T00:00:00.000Z',
    );
    expect(new Date(window.endMs).toISOString()).toBe(
      '2026-03-10T23:59:59.999Z',
    );
  });

  it('refetches at least the trailing two days on an incremental sync', () => {
    const window = usageWindowFor(
      { mode: 'latest', since: '2026-03-10T11:00:00.000Z' },
      30,
      now,
    );
    expect(new Date(window.startMs).toISOString()).toBe(
      '2026-03-08T00:00:00.000Z',
    );
  });
});
