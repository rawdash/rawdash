# @rawdash/connector-stripe

Rawdash connector for Stripe — syncs customers, subscriptions, invoices, charges, payment intents, products, prices, disputes, and refunds into the six-shape storage model.

## Auth setup

### Creating a Restricted API key

1. Log in to your Stripe Dashboard and navigate to **Developers → API keys**.
2. Click **+ Create restricted key**.
3. Give it a name (e.g. `rawdash-readonly`).
4. Enable **Read** access only for the resources you want to sync. The connector supports any subset of:
   - Customers
   - Subscriptions
   - Invoices
   - Charges
   - Payment Intents
   - Products
   - Prices
   - Disputes
   - Refunds
5. Click **Create key** and copy the key value starting with `rk_live_…` (or `rk_test_…` for test mode).

> **Note:** Never use your full Secret key — a Restricted key with only the scopes above is safer and sufficient.

### Stripe Connect platforms

If you are a platform and want to sync data for a connected account, supply the `accountId` field (format: `acct_…`). The connector will send the `Stripe-Account` header on every request.

## Configuration

```ts
import { secret } from '@rawdash/core';

const stripe = {
  name: 'stripe',
  connectorId: 'stripe',
  config: {
    apiKey: secret('STRIPE_API_KEY'),
    // accountId: 'acct_…', // optional, Stripe Connect only
    // resources: ['customers', 'subscriptions', 'invoices'], // optional, defaults to all
  },
};
```

Register the connector class when mounting the engine:

```ts
import { StripeConnector } from '@rawdash/connector-stripe';
import { mountEngine } from '@rawdash/hono';

mountEngine(config, { connectorRegistry: { stripe: StripeConnector } });
```

### Choosing resources

By default the connector syncs every supported resource. To sync only a subset, pass `resources` with any combination of:

`customers`, `products`, `prices`, `subscriptions`, `invoices`, `charges`, `payment_intents`, `disputes`, `refunds`

Each name is a Stripe API resource. The list you choose should match the Read scopes on your Restricted API key — picking only what you need also reduces API calls during full syncs.

Then pass it to `defineConfig`:

```ts
import { defineConfig, defineDashboard, defineMetric } from '@rawdash/core';

export default defineConfig({
  connectors: [stripe],
  dashboards: {
    billing: defineDashboard({
      widgets: {
        mrr: {
          kind: 'stat',
          title: 'MRR',
          metric: defineMetric({
            connector: stripe,
            shape: 'entity',
            entityType: 'stripe_subscription',
            field: 'mrrAmount',
            fn: 'sum',
            filter: [{ field: 'status', op: 'eq', value: 'active' }],
          }),
        },
        active_subscriptions: {
          kind: 'stat',
          title: 'Active subscriptions',
          metric: defineMetric({
            connector: stripe,
            shape: 'entity',
            entityType: 'stripe_subscription',
            fn: 'count',
            filter: [{ field: 'status', op: 'eq', value: 'active' }],
          }),
        },
        failed_charges_today: {
          kind: 'stat',
          title: 'Failed charges today',
          metric: defineMetric({
            connector: stripe,
            shape: 'event',
            name: 'stripe_charge',
            fn: 'count',
            window: '1d',
            filter: [{ field: 'status', op: 'eq', value: 'failed' }],
          }),
        },
        daily_revenue: {
          kind: 'timeseries',
          title: 'Daily revenue',
          window: '30d',
          metric: defineMetric({
            connector: stripe,
            shape: 'event',
            name: 'stripe_charge',
            field: 'amount',
            fn: 'sum',
            window: '30d',
            filter: [{ field: 'status', op: 'eq', value: 'succeeded' }],
            groupBy: { field: 'start_ts', granularity: 'day' },
          }),
        },
      },
    }),
  },
});
```

## Data model

All monetary amounts are in the **smallest currency unit** (e.g. cents for USD).

| Storage shape | Entity/event type       | Key attributes                                                                                                                 |
| ------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| entity        | `stripe_customer`       | email, name, created, currency, delinquent, livemode                                                                           |
| entity        | `stripe_product`        | name, active, created                                                                                                          |
| entity        | `stripe_price`          | productId, unitAmount, currency, interval, intervalCount, active, created                                                      |
| entity        | `stripe_subscription`   | customerId, status, planId, currentPeriodStart, currentPeriodEnd, cancelAtPeriodEnd, canceledAt, trialEnd, mrrAmount, currency |
| entity        | `stripe_invoice`        | customerId, subscriptionId, status, amountDue, amountPaid, currency, created, dueDate, hostedInvoiceUrl                        |
| event         | `stripe_charge`         | id, customerId, amount, currency, status, failureCode, paymentIntentId                                                         |
| event         | `stripe_payment_intent` | id, customerId, amount, currency, status                                                                                       |
| event         | `stripe_dispute`        | id, chargeId, amount, currency, reason, status                                                                                 |
| event         | `stripe_refund`         | id, chargeId, amount, currency, reason, status                                                                                 |

### `mrrAmount`

Pre-computed monthly-equivalent revenue for each subscription in the smallest currency unit. Formula: `unit_amount × quantity`, normalised to a monthly cadence (yearly ÷ 12, weekly × 52 ÷ 12, etc.).

## Schemas

`StripeConnector.schemas` declares the Zod schema for each resource's raw API response (one key per `GET /v1/{resource}` list endpoint). Used by the cloud shape-drift pipeline to populate `connector_baselines`, and by the package's property tests.

| Resource          | Represents                     |
| ----------------- | ------------------------------ |
| `customers`       | `GET /v1/customers` page       |
| `products`        | `GET /v1/products` page        |
| `prices`          | `GET /v1/prices` page          |
| `subscriptions`   | `GET /v1/subscriptions` page   |
| `invoices`        | `GET /v1/invoices` page        |
| `charges`         | `GET /v1/charges` page         |
| `payment_intents` | `GET /v1/payment_intents` page |
| `disputes`        | `GET /v1/disputes` page        |
| `refunds`         | `GET /v1/refunds` page         |

## Sync behaviour

- **Backfill** (`mode: 'full'`): fetches all records via `starting_after` cursor pagination (`limit=100`).
- **Incremental** (`mode: 'latest'`): entity phases use a 7-day lookback (`created[gte]`) to catch status mutations; event phases use `created[gt]` to fetch only new records.
- **Rate limits**: Stripe's 429 responses carry a `Retry-After` header. The built-in HTTP client retries automatically with exponential back-off.
- **Resumable**: if a sync is interrupted (signal abort), the connector returns a cursor so the engine can resume from the same page.

## Aggregates

No aggregates yet — `count` / `latest` widgets fall back to evaluating against synced storage rows. Tracking as a follow-up: Stripe's list endpoints (`/v1/subscriptions?status=active&limit=1`, `/v1/charges?limit=1`, etc.) plus the `?ending_before=` cursor can serve `count` and `latest` for most resources without touching the full backfill.

## Registering in the MCP server

To make the connector available via the `add_connector` MCP tool, include it in `connectorFactories`:

```ts
import { StripeConnector, configFields } from '@rawdash/connector-stripe';

createMcpServer({
  // ...
  connectorFactories: [
    {
      id: 'stripe',
      configFields,
      create: StripeConnector.create,
    },
  ],
});
```

## Property tests

Resources in this connector have fast-check property tests under `src/property.test.ts` that:

1. Generate N≥50 synthetic API payloads from a Zod schema mirroring the upstream API response.
2. Pipe them through `connector.sync()` against an `InMemoryStorage` instance.
3. Assert universal invariants — non-empty entity ids, finite event timestamps, no `undefined` leaking into storage, no thrown errors on any valid input — plus per-resource counts.

The helper lives in `@rawdash/connector-test-utils`. When adding a new resource, add a Zod schema for its payload and a test wired up via `runPropertySyncTest`.
