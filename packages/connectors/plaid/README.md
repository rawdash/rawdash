<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-plaid

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-plaid)](https://www.npmjs.com/package/@rawdash/connector-plaid)
[![license](https://img.shields.io/npm/l/@rawdash/connector-plaid)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync account balances and transactions for a linked Plaid Item so finance teams can watch cash position and spend across every account in one place.

## Install

```sh
npm install @rawdash/connector-plaid
```

## Authentication

Authenticates with a Plaid client_id and secret plus a per-Item access_token. Each connector instance covers one linked institution (Item); the Item itself may expose several accounts.

1. In the Plaid Dashboard → Team Settings → Keys, copy your client_id and the secret for the environment you want to sync (sandbox, development, or production).
2. Link an institution with Plaid Link and exchange the resulting public_token for a long-lived access_token via POST /item/public_token/exchange.
3. Store the secret and the access_token as secrets and reference them from the connector config as `secret: secret("PLAID_SECRET")` and `accessToken: secret("PLAID_ACCESS_TOKEN")`.
4. Add one connector instance per Item you want on the dashboard.

## Configuration

| Field         | Type                                       | Required | Description                                                                                                                                                   |
| ------------- | ------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clientId`    | string                                     | Yes      | Plaid client_id from the Dashboard → Team Settings → Keys. Not secret, but pairs with the secret below.                                                       |
| `secret`      | secret                                     | Yes      | Plaid API secret for the selected environment. Create or reveal it under Dashboard → Team Settings → Keys.                                                    |
| `accessToken` | secret                                     | Yes      | Per-Item access_token returned by /item/public_token/exchange. One connector instance syncs one Item (one linked institution); add another instance per Item. |
| `environment` | `sandbox` \| `development` \| `production` | No       | Which Plaid environment the secret and access token belong to.                                                                                                |
| `resources`   | array                                      | No       | Which Plaid resources to sync. Omit to sync all of them (accounts and transactions).                                                                          |

## Resources

- **`plaid_account`** _(entity)_ - Accounts under the linked Item with current and available balances, type, subtype, and mask.
  - Endpoint: `POST /accounts/balance/get`
  - `itemId`: Item the account belongs to.
  - `name`: Account name.
  - `officialName`: Official account name, if any.
  - `mask`: Last 2-4 digits of the account number.
  - `type`: Account type (depository, credit, ...).
  - `subtype`: Account subtype (checking, savings, ...).
  - `currentBalance`: Current balance in the account currency.
  - `availableBalance`: Available balance in the account currency, if provided.
  - `limit`: Credit or overdraft limit, if any.
  - `currency`: ISO (or unofficial) currency code.
- **`plaid_transaction`** _(event)_ - Transactions timestamped at their posted (or authorized) date, with amount, currency, category, and merchant.
  - Endpoint: `POST /transactions/get`
  - Amount sign follows Plaid: positive is money out of the account, negative is money in. Category prefers personal_finance_category.primary and falls back to the first legacy category.
  - `id`: Plaid transaction_id.
  - `accountId`: Account the transaction belongs to.
  - `amount`: Transaction amount (positive = outflow, negative = inflow).
  - `currency`: ISO (or unofficial) currency code.
  - `category`: Primary category, if resolved.
  - `merchantName`: Merchant name, if resolved.
  - `name`: Raw transaction description.
  - `pending`: Whether the transaction is still pending.
  - `date`: Posted or authorized date (YYYY-MM-DD).

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const plaid = {
  name: 'plaid',
  connectorId: 'plaid',
  config: {
    clientId: '5f1a2b3c4d5e6f0011223344',
    secret: secret('PLAID_SECRET'),
    accessToken: secret('PLAID_ACCESS_TOKEN'),
    environment: 'production' as const,
    resources: ['accounts', 'transactions'] as const,
  },
};

export default defineConfig({
  connectors: [plaid],
  dashboards: {
    cash: defineDashboard({
      widgets: {
        accounts_tracked: {
          kind: 'stat',
          title: 'Accounts tracked',
          metric: defineMetric({
            connector: plaid,
            shape: 'entity',
            entityType: 'plaid_account',
            fn: 'count',
          }),
        },
        spend_this_month: {
          kind: 'stat',
          title: 'Spend this month',
          metric: defineMetric({
            connector: plaid,
            shape: 'event',
            name: 'plaid_transaction',
            fn: 'sum',
            field: 'amount',
          }),
        },
      },
    }),
  },
});
```

## Rate limits

Requests are POSTed with credentials in the JSON body. Plaid enforces per-product rate limits (e.g. /transactions/get) and returns 429s that are retried with exponential backoff. /transactions/get is paginated with the count/offset options (500 per page).

## Limitations

- One connector instance syncs a single Item (one linked institution). Link several institutions by adding one instance per access_token.
- Transaction amounts follow the Plaid sign convention: positive amounts are money leaving the account, negative amounts are money coming in.
- Monetary values are in the account’s native currency (iso_currency_code, or unofficial_currency_code when Plaid cannot resolve an ISO code).
- Incremental syncs re-request transactions from a 14-day lookback so that pending transactions are updated once they post.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors)
- [Plaid API docs](https://plaid.com/docs/api/)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
