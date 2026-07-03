import {
  type InvariantViolation,
  assertConnectorResourceShapes,
  connectorResourceShapeViolations,
  entityStoreFor,
  eventStoreFor,
  installFetchMock,
  runPropertySyncTest,
} from '@rawdash/connector-test-utils';
import { InMemoryStorage } from '@rawdash/core';
import { afterEach, describe, it, vi } from 'vitest';
import { z } from 'zod';

import { PlaidConnector } from './plaid';

const CONNECTOR_ID = 'plaid';

const docShapeExtra = (
  storage: InMemoryStorage,
  connectorId: string,
): InvariantViolation[] =>
  connectorResourceShapeViolations(
    PlaidConnector.resources,
    storage,
    connectorId,
  );

type AccountsSample = z.infer<typeof PlaidConnector.schemas.accounts>;
type TransactionsSample = z.infer<typeof PlaidConnector.schemas.transactions>;

function newConnector(
  resources: readonly ('accounts' | 'transactions')[],
): PlaidConnector {
  return new PlaidConnector(
    { clientId: 'client_1', environment: 'sandbox', resources },
    {
      secret: 'secret_1' as unknown as { $secret: string },
      accessToken: 'access_1' as unknown as { $secret: string },
    },
  );
}

describe('PlaidConnector property tests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('accounts: sync upholds universal invariants for any valid API payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: AccountsSample,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const unique = new Set(sample.map((a) => a.account_id)).size;
      const written =
        entityStoreFor(storage, CONNECTOR_ID).get('plaid_account')?.size ?? 0;
      if (written !== unique) {
        violations.push({
          invariant: 'one plaid_account entity per unique account id',
          location: 'accounts phase',
          detail: `expected ${unique} entities, got ${written}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest({
      connectorClass: PlaidConnector,
      resource: 'accounts',
      connectorId: CONNECTOR_ID,
      runs: 100,
      extraInvariants: [extra, docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock(() => ({
          accounts: sample,
          item: { item_id: 'item_1', institution_id: 'ins_1' },
          request_id: 'req',
        }));
        await newConnector(['accounts']).sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('transactions: sync upholds universal invariants for any valid API payload', async () => {
    const extra = (
      storage: InMemoryStorage,
      _connectorId: string,
      sample: TransactionsSample,
    ): InvariantViolation[] => {
      const violations: InvariantViolation[] = [];
      const written = eventStoreFor(storage, CONNECTOR_ID).length;
      if (written !== sample.length) {
        violations.push({
          invariant: 'one plaid_transaction event per returned transaction',
          location: 'transactions phase',
          detail: `expected ${sample.length} events, got ${written}`,
        });
      }
      return violations;
    };

    await runPropertySyncTest({
      connectorClass: PlaidConnector,
      resource: 'transactions',
      connectorId: CONNECTOR_ID,
      runs: 100,
      extraInvariants: [extra, docShapeExtra],
      run: async (sample, storage) => {
        installFetchMock(() => ({
          accounts: [],
          transactions: sample,
          total_transactions: sample.length,
          item: { item_id: 'item_1', institution_id: 'ins_1' },
          request_id: 'req',
        }));
        await newConnector(['transactions']).sync(
          { mode: 'full' },
          storage.getStorageHandle(CONNECTOR_ID),
        );
      },
    });
  });

  it('full sync writes match the documented resource shapes', async () => {
    installFetchMock((url) => {
      if (url.includes('/accounts/balance/get')) {
        return {
          accounts: [
            {
              account_id: 'acc_1',
              name: 'Checking',
              official_name: null,
              mask: '0000',
              type: 'depository',
              subtype: 'checking',
              balances: {
                available: 100,
                current: 110,
                limit: null,
                iso_currency_code: 'USD',
                unofficial_currency_code: null,
              },
            },
          ],
          item: { item_id: 'item_1', institution_id: 'ins_1' },
          request_id: 'req_1',
        };
      }
      return {
        accounts: [],
        transactions: [
          {
            transaction_id: 'txn_1',
            account_id: 'acc_1',
            amount: 12.5,
            iso_currency_code: 'USD',
            unofficial_currency_code: null,
            name: 'Coffee',
            merchant_name: 'Blue Bottle',
            pending: false,
            date: '2026-06-01',
            datetime: '2026-06-01T09:30:00Z',
            category: ['Food and Drink'],
            personal_finance_category: {
              primary: 'FOOD_AND_DRINK',
              detailed: 'FOOD_AND_DRINK_COFFEE',
            },
          },
        ],
        total_transactions: 1,
        item: { item_id: 'item_1', institution_id: 'ins_1' },
        request_id: 'req_2',
      };
    });

    const storage = new InMemoryStorage();
    await newConnector(['accounts', 'transactions']).sync(
      { mode: 'full' },
      storage.getStorageHandle(CONNECTOR_ID),
    );

    assertConnectorResourceShapes(
      PlaidConnector.resources,
      storage,
      CONNECTOR_ID,
    );
  });
});
