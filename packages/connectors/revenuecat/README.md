<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-revenuecat

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-revenuecat)](https://www.npmjs.com/package/@rawdash/connector-revenuecat)
[![license](https://img.shields.io/npm/l/@rawdash/connector-revenuecat)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync products, entitlements, customers, and subscriptions from RevenueCat alongside overview metrics (MRR, active subscribers, trial conversion).

## Install

```sh
npm install @rawdash/connector-revenuecat
```

## Authentication

Authenticates with a RevenueCat v2 REST API key scoped to a single project. The key only needs read access to the resources being synced.

1. Open the RevenueCat dashboard -> Project Settings -> API Keys.
2. Create a v2 Secret API key with read access; copy the key value.
3. Copy the Project ID from Project Settings -> General.
4. Store the API key as a secret and reference it from the connector config as `apiKey: secret("REVENUECAT_API_KEY")`. Set `projectId` to the project identifier.

## Configuration

| Field       | Type   | Required | Description                                                                                                                                                                 |
| ----------- | ------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apiKey`    | secret | Yes      | RevenueCat v2 REST API key (read-only). Create one in the RevenueCat dashboard under Project Settings -> API Keys -> Public app-specific or Secret API Key (V2).            |
| `projectId` | string | Yes      | RevenueCat project identifier. Find it in Project Settings -> General.                                                                                                      |
| `resources` | array  | No       | Which RevenueCat resources to sync. Omit to sync all. Customer syncs also emit each customer’s subscription entities, fetched from the per-customer subscriptions endpoint. |

## Resources

- **`revenuecat_product`** _(entity)_ - Products configured in RevenueCat, including their store identifier (App Store / Play Store SKU), type, and display name.
  - Endpoint: `GET /v2/projects/{project_id}/products`
  - `storeIdentifier`: Store-specific product SKU.
  - `type`: Product type (subscription, non_consumable, ...).
  - `appId`: RevenueCat app id the product belongs to.
  - `displayName`: Human-readable product name.
  - `createdAt`: Unix seconds when the product was created.
- **`revenuecat_entitlement`** _(entity)_ - Entitlements (logical features) configured in the project, keyed by lookup_key.
  - Endpoint: `GET /v2/projects/{project_id}/entitlements`
  - `lookupKey`: Stable lookup key used by client SDKs.
  - `displayName`: Human-readable entitlement name.
  - `createdAt`: Unix seconds when the entitlement was created.
- **`revenuecat_customer`** _(entity)_ - RevenueCat customers (app users) with first-seen / last-seen timestamps and a list of currently active entitlement ids.
  - Endpoint: `GET /v2/projects/{project_id}/customers`
  - The customers list returns only base fields; each customer’s active entitlements are fetched from GET /v2/projects/{project_id}/customers/{customer_id}/active_entitlements, and its subscriptions are written separately as `revenuecat_subscription` entities.
  - `firstSeenAt`: Unix seconds the customer was first seen.
  - `lastSeenAt`: Unix seconds of the most recent activity.
  - `activeEntitlements`: Array of entitlement_id strings currently granting access.
- **`revenuecat_subscription`** _(entity)_ - Subscriptions, one row per (customer, subscription). Fetched from each customer’s subscriptions collection.
  - Endpoint: `GET /v2/projects/{project_id}/customers/{customer_id}/subscriptions`
  - `customerId`: RevenueCat customer (app user) id.
  - `productId`: Product the subscription is for.
  - `store`: Originating store (app_store, play_store, ...).
  - `status`: Subscription status (active, expired, refunded, ...).
  - `startsAt`: Unix seconds the subscription started.
  - `currentPeriodEndsAt`: Unix seconds the current paid period ends.
  - `givesAccess`: Whether the subscription currently grants access.
  - `autoRenewalStatus`: Auto-renew status reported by the store (will_renew, will_not_renew, ...).
- **`revenuecat_metric_snapshot`** _(metric)_ - Point-in-time snapshot of RevenueCat overview metrics (MRR, active subscriptions, active trials, trial conversion rate, etc.). Each metric is emitted as one sample per sync, tagged with the metric id under the `metric` dimension.
  - Endpoint: `GET /v2/projects/{project_id}/metrics/overview`
  - Granularity: minute
  - Dimensions: `metric`, `unit`
  - The unit varies by metric id (currency minor units for revenue metrics, count for subscriber metrics, ratio for conversion metrics) and is recorded in the `unit` dimension.

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const revenuecat = {
  name: 'revenuecat',
  connectorId: 'revenuecat',
  config: {
    apiKey: secret('REVENUECAT_API_KEY'),
    projectId: 'proj1ab2cd3',
    resources: ['products', 'customers', 'metrics'],
  },
};

export default defineConfig({
  connectors: [revenuecat],
  dashboards: {
    mobile_revenue: defineDashboard({
      widgets: {
        active_subscriptions: {
          kind: 'stat',
          title: 'Active subscriptions',
          metric: defineMetric({
            connector: revenuecat,
            shape: 'entity',
            entityType: 'revenuecat_subscription',
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

RevenueCat applies per-domain rate limits and returns 429 with a Retry-After header on overrun; requests are retried with exponential backoff. List endpoints page via the `starting_after` cursor and return up to 100 items per page. Each customer’s active entitlements and subscriptions are fetched with a separate request per customer.

## Limitations

- Monetary amounts (e.g. MRR) are emitted in the smallest currency unit reported by the upstream API (typically cents).
- The overview metrics resource emits a point-in-time snapshot per sync rather than a backfilled timeseries; query timeseries widgets group these by `metric` and aggregate over time.
- Subscriptions and active entitlements are not returned by the customers list endpoint; they are fetched per customer, so customer syncs make additional requests proportional to the customer count.
- RevenueCat does not expose a REST endpoint for listing subscription lifecycle events; those are delivered only via webhooks and are therefore not synced.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors)
- [RevenueCat API docs](https://www.revenuecat.com/docs/api-v2)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
