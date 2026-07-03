import {
  entityStoreFor,
  eventStoreFor,
  installFetchMock,
} from '@rawdash/connector-test-utils';
import { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PlaidConnector, configFields } from './plaid';

const CONNECTOR_ID = 'plaid';

const balanceResponse = {
  accounts: [
    {
      account_id: 'acc_1',
      name: 'Plaid Checking',
      official_name: 'Plaid Gold Standard 0% Interest Checking',
      mask: '0000',
      type: 'depository',
      subtype: 'checking',
      balances: {
        available: 100.25,
        current: 110.0,
        limit: null,
        iso_currency_code: 'USD',
        unofficial_currency_code: null,
      },
    },
    {
      account_id: 'acc_2',
      name: 'Plaid Credit Card',
      official_name: null,
      mask: '3333',
      type: 'credit',
      subtype: 'credit card',
      balances: {
        available: null,
        current: 410.0,
        limit: 2000.0,
        iso_currency_code: 'USD',
        unofficial_currency_code: null,
      },
    },
  ],
  item: { item_id: 'item_1', institution_id: 'ins_1' },
  request_id: 'req_1',
};

const transactionsResponse = {
  accounts: balanceResponse.accounts,
  transactions: [
    {
      transaction_id: 'txn_1',
      account_id: 'acc_1',
      amount: 12.5,
      iso_currency_code: 'USD',
      unofficial_currency_code: null,
      name: 'Coffee Shop',
      merchant_name: 'Blue Bottle',
      pending: false,
      date: '2026-06-01',
      datetime: '2026-06-01T09:30:00Z',
      category: ['Food and Drink', 'Coffee Shop'],
      personal_finance_category: {
        primary: 'FOOD_AND_DRINK',
        detailed: 'FOOD_AND_DRINK_COFFEE',
      },
    },
    {
      transaction_id: 'txn_2',
      account_id: 'acc_1',
      amount: -2000,
      iso_currency_code: 'USD',
      unofficial_currency_code: null,
      name: 'Payroll',
      merchant_name: null,
      pending: false,
      date: '2026-06-02',
      datetime: null,
      category: null,
      personal_finance_category: null,
    },
  ],
  total_transactions: 2,
  item: { item_id: 'item_1', institution_id: 'ins_1' },
  request_id: 'req_2',
};

function routeBody(url: string): unknown {
  if (url.includes('/accounts/balance/get')) {
    return balanceResponse;
  }
  if (url.includes('/transactions/get')) {
    return transactionsResponse;
  }
  throw new Error(`unexpected url ${url}`);
}

function newConnector(
  settings: Partial<{
    environment: 'sandbox' | 'development' | 'production';
    resources: readonly ('accounts' | 'transactions')[];
  }> = {},
): PlaidConnector {
  return new PlaidConnector(
    {
      clientId: 'client_1',
      environment: settings.environment ?? 'production',
      resources: settings.resources,
    },
    {
      secret: 'secret_1' as unknown as { $secret: string },
      accessToken: 'access_1' as unknown as { $secret: string },
    },
  );
}

describe('PlaidConnector', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('writes accounts as entities with balances and item id', async () => {
    installFetchMock(routeBody);
    const storage = new InMemoryStorage();
    const connector = newConnector({ resources: ['accounts'] });
    await connector.sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    const accounts = entityStoreFor(storage, CONNECTOR_ID).get('plaid_account');
    expect(accounts?.size).toBe(2);
    const checking = accounts?.get('acc_1') as
      | { attributes: Record<string, unknown> }
      | undefined;
    expect(checking?.attributes).toMatchObject({
      itemId: 'item_1',
      name: 'Plaid Checking',
      type: 'depository',
      subtype: 'checking',
      currentBalance: 110,
      availableBalance: 100.25,
      currency: 'USD',
    });
    const credit = accounts?.get('acc_2') as
      | { attributes: Record<string, unknown> }
      | undefined;
    expect(credit?.attributes.limit).toBe(2000);
    expect(credit?.attributes.availableBalance).toBeNull();
  });

  it('writes transactions as events with normalized category and currency', async () => {
    installFetchMock(routeBody);
    const storage = new InMemoryStorage();
    const connector = newConnector({ resources: ['transactions'] });
    await connector.sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    const events = eventStoreFor<{
      name: string;
      start_ts: number;
      attributes: Record<string, unknown>;
    }>(storage, CONNECTOR_ID);
    expect(events).toHaveLength(2);
    const coffee = events.find((e) => e.attributes.id === 'txn_1');
    expect(coffee?.attributes).toMatchObject({
      accountId: 'acc_1',
      amount: 12.5,
      currency: 'USD',
      category: 'FOOD_AND_DRINK',
      merchantName: 'Blue Bottle',
      pending: false,
    });
    expect(coffee?.start_ts).toBe(Date.parse('2026-06-01T09:30:00Z'));

    const payroll = events.find((e) => e.attributes.id === 'txn_2');
    expect(payroll?.attributes.category).toBeNull();
    expect(payroll?.attributes.amount).toBe(-2000);
    expect(payroll?.start_ts).toBe(Date.parse('2026-06-02'));
  });

  it('paginates transactions using count/offset', async () => {
    const spy = vi.fn().mockImplementation((url: string | URL) => {
      const u = url.toString();
      const body = u.includes('/accounts/balance/get')
        ? balanceResponse
        : {
            ...transactionsResponse,
            transactions: [transactionsResponse.transactions[0]],
            total_transactions: 2,
          };
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });
    vi.stubGlobal('fetch', spy);

    const storage = new InMemoryStorage();
    const connector = newConnector({ resources: ['transactions'] });
    const result = await connector.sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    expect(result.done).toBe(true);
    const bodies = spy.mock.calls
      .map((call) => call[1]?.body as string | undefined)
      .filter((b): b is string => typeof b === 'string')
      .map((b) => JSON.parse(b) as { options?: { offset?: number } });
    const offsets = bodies
      .filter((b) => b.options)
      .map((b) => b.options?.offset);
    expect(offsets).toEqual([0, 1]);
  });

  it('sends credentials in the request body for the configured environment', async () => {
    const spy = installFetchMock(routeBody);
    const storage = new InMemoryStorage();
    const connector = newConnector({
      environment: 'sandbox',
      resources: ['accounts'],
    });
    await connector.sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    const [url, init] = spy.mock.calls[0] as [string, { body: string }];
    expect(url).toContain('https://sandbox.plaid.com/accounts/balance/get');
    expect(JSON.parse(init.body)).toMatchObject({
      client_id: 'client_1',
      secret: 'secret_1',
      access_token: 'access_1',
    });
  });

  it('parses config and defaults environment to production', () => {
    const parsed = configFields.parse({
      clientId: 'client_1',
      secret: { $secret: 'PLAID_SECRET' },
      accessToken: { $secret: 'PLAID_ACCESS_TOKEN' },
    });
    expect(parsed.environment).toBe('production');
    expect(parsed.secret).toEqual({ $secret: 'PLAID_SECRET' });
  });
});
