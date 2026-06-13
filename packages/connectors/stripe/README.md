<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-stripe

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-stripe)](https://www.npmjs.com/package/@rawdash/connector-stripe)
[![license](https://img.shields.io/npm/l/@rawdash/connector-stripe)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync customers, products, prices, subscriptions, and invoices alongside charge, payment, dispute, and refund events from your Stripe account.

## Install

```sh
npm install @rawdash/connector-stripe
```

## Authentication

Authenticates with a Stripe restricted API key that has read-only access to the resources you want to sync.

1. Open the Stripe Dashboard → Developers → API keys.
2. Create a restricted key with Read access for the resources you plan to sync (customers, products, prices, subscriptions, invoices, charges, payment intents, disputes, refunds).
3. Store the key as a secret and reference it from the connector config as `apiKey: secret("STRIPE_API_KEY")`.

## Configuration

| Field       | Type   | Required | Description                                                                                                                  |
| ----------- | ------ | -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `apiKey`    | secret | Yes      | Stripe Restricted API key with read-only access. Create one at Dashboard → Developers → API keys.                            |
| `accountId` | string | No       | Stripe Connect account ID. Only needed if you are a platform accessing a connected account.                                  |
| `resources` | array  | No       | Which Stripe resources to sync. Omit to sync all resources. The API key only needs Read scope for the resources listed here. |

## Resources

- **`stripe_customer`** _(entity)_ - Customers with email, name, default currency, and delinquency state.
  - Endpoint: `GET /v1/customers`
- **`stripe_product`** _(entity)_ - Products in your catalog, including active state.
  - Endpoint: `GET /v1/products`
- **`stripe_price`** _(entity)_ - Prices with unit amount, currency, and recurring interval, linked to their product.
  - Endpoint: `GET /v1/prices`
- **`stripe_subscription`** _(entity)_ - Subscriptions with status, current period, cancellation state, and computed monthly recurring revenue (mrrAmount, in the smallest currency unit).
  - Endpoint: `GET /v1/subscriptions`
  - mrrAmount is computed as unit_amount x quantity, normalized to a monthly cadence (yearly / 12, weekly x 52 / 12, etc.).
  - `customerId`: Customer the subscription belongs to.
  - `status`: Subscription status (active, canceled, ...).
  - `planId`: Price id of the first subscription item.
  - `currentPeriodStart`: Current period start (unix seconds).
  - `currentPeriodEnd`: Current period end (unix seconds).
  - `cancelAtPeriodEnd`: Whether the subscription cancels at period end.
  - `canceledAt`: Cancellation time (unix seconds), if canceled.
  - `trialEnd`: Trial end time (unix seconds), if any.
  - `mrrAmount` _(cents)_: Monthly recurring revenue in the smallest currency unit.
  - `currency`: ISO currency code.
  - `created`: Creation time (unix seconds).
- **`stripe_invoice`** _(entity)_ - Invoices with amount due, amount paid, status, and due date, linked to their customer and subscription.
  - Endpoint: `GET /v1/invoices`
  - `customerId`: Customer the invoice belongs to.
  - `subscriptionId`: Subscription the invoice belongs to, if any.
  - `status`: Invoice status (draft, open, paid, ...).
  - `amountDue` _(cents)_: Amount due in the smallest currency unit.
  - `amountPaid` _(cents)_: Amount paid in the smallest currency unit.
  - `currency`: ISO currency code.
  - `created`: Creation time (unix seconds).
  - `dueDate`: Due date (unix seconds), if any.
  - `hostedInvoiceUrl`: Hosted invoice URL, if any.
- **`stripe_charge`** _(event)_ - Charge attempts with amount, currency, status, and failure code, timestamped at creation.
  - Endpoint: `GET /v1/charges`
  - `id`: Stripe charge id.
  - `customerId`: Customer charged, if any.
  - `amount` _(cents)_: Charge amount in the smallest currency unit.
  - `currency`: ISO currency code.
  - `status`: Charge status (succeeded, failed, ...).
  - `failureCode`: Failure code, if the charge failed.
  - `paymentIntentId`: Associated payment intent id, if any.
- **`stripe_payment_intent`** _(event)_ - Payment intents with amount, currency, and status, timestamped at creation.
  - Endpoint: `GET /v1/payment_intents`
  - `id`: Stripe payment intent id.
  - `customerId`: Customer, if any.
  - `amount` _(cents)_: Intent amount in the smallest currency unit.
  - `currency`: ISO currency code.
  - `status`: Payment intent status.
- **`stripe_dispute`** _(event)_ - Disputes with amount, currency, reason, and status, linked to the disputed charge.
  - Endpoint: `GET /v1/disputes`
  - `id`: Stripe dispute id.
  - `chargeId`: Disputed charge id.
  - `amount` _(cents)_: Disputed amount in the smallest currency unit.
  - `currency`: ISO currency code.
  - `reason`: Dispute reason.
  - `status`: Dispute status.
- **`stripe_refund`** _(event)_ - Refunds with amount, currency, reason, and status, linked to the refunded charge.
  - Endpoint: `GET /v1/refunds`
  - `id`: Stripe refund id.
  - `chargeId`: Refunded charge id, if any.
  - `amount` _(cents)_: Refunded amount in the smallest currency unit.
  - `currency`: ISO currency code.
  - `reason`: Refund reason, if any.
  - `status`: Refund status, if any.

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const stripe = {
  name: 'stripe',
  connectorId: 'stripe',
  config: {
    apiKey: secret('STRIPE_API_KEY'),
    resources: ['customers', 'subscriptions', 'invoices', 'charges'],
  },
};

export default defineConfig({
  connectors: [stripe],
  dashboards: {
    revenue: defineDashboard({
      widgets: {
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
      },
    }),
  },
});
```

## Rate limits

Stripe 429 responses carry a Retry-After header; requests are retried with exponential backoff. List pagination uses the starting_after cursor (limit 100).

## Limitations

- Monetary amounts are stored in the smallest currency unit (e.g. cents), matching the Stripe API.
- The set of synced resources is controlled by the `resources` config field; omit it to sync all of them.
- Incremental syncs use a 7-day lookback for entities and created[gt] for events.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors/)
- [Stripe API docs](https://stripe.com/docs/api)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
