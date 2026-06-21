<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-shopify

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-shopify)](https://www.npmjs.com/package/@rawdash/connector-shopify)
[![license](https://img.shields.io/npm/l/@rawdash/connector-shopify)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync orders, customers, products, and refund events from a Shopify store via the Admin GraphQL API.

## Install

```sh
npm install @rawdash/connector-shopify
```

## Authentication

A Custom App Admin API access token authenticates every GraphQL request. The token scopes the sync to the store it was created in and the read scopes granted to the app.

1. In the Shopify admin, open Settings -> Apps and sales channels -> Develop apps.
2. Create a new app (or open an existing custom app) and open the Configuration tab.
3. Under Admin API integration, grant the read_orders, read_customers, and read_products scopes and save.
4. Open the API credentials tab and install the app to reveal the Admin API access token (starts with shpat\_).
5. Store the token as a secret and reference it from the connector config as `accessToken: secret("SHOPIFY_ACCESS_TOKEN")`, and set `shopDomain` to your yourshop.myshopify.com domain.

## Configuration

| Field         | Type   | Required | Description                                                                                                                                     |
| ------------- | ------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `shopDomain`  | string | Yes      | Your store myshopify.com domain, without protocol, e.g. yourshop.myshopify.com.                                                                 |
| `accessToken` | secret | Yes      | Custom App Admin API access token with read_orders, read_customers, and read_products scopes.                                                   |
| `resources`   | array  | No       | Which Shopify resources to sync. Omit to sync all resources. The `orders` phase also emits a refund event for each refund attached to an order. |

## Resources

- **`shopify_product`** _(entity)_ - Store products with their title, vendor, status, and total inventory.
  - Endpoint: `GraphQL query: products { nodes { ... } }`
- **`shopify_customer`** _(entity)_ - Store customers with their email, lifetime order count, and total amount spent.
  - Endpoint: `GraphQL query: customers { nodes { ... } }`
- **`shopify_order`** _(entity)_ - Orders with their total price, currency, financial and fulfillment status, customer, and lifecycle timestamps.
  - Endpoint: `GraphQL query: orders { nodes { ... } }`
- **`shopify_refund`** _(event)_ - Refund events derived from each order, carrying the refunded amount and currency.
  - Endpoint: `GraphQL query: orders { nodes { refunds { ... } } }`
  - Derived from the `refunds` list on each synced order. Each refund becomes one append-only event keyed by its refund id; refunds attached to orders outside the current incremental window are not revisited.

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const shopify = {
  name: 'shopify',
  connectorId: 'shopify',
  config: {
    shopDomain: 'yourshop.myshopify.com',
    accessToken: secret('SHOPIFY_ACCESS_TOKEN'),
  },
};

export default defineConfig({
  connectors: [shopify],
  dashboards: {
    sales: defineDashboard({
      widgets: {
        paid_orders: {
          kind: 'stat',
          title: 'Paid orders',
          metric: defineMetric({
            connector: shopify,
            shape: 'entity',
            entityType: 'shopify_order',
            fn: 'count',
            filter: [{ field: 'financialStatus', op: 'eq', value: 'PAID' }],
          }),
        },
      },
    }),
  },
});
```

## Rate limits

The Admin GraphQL API uses a cost-based leaky-bucket limit per access token; this connector pages 250 records at a time and relies on standard HTTP 429 retry/backoff.

## Limitations

- Custom App access token auth only (OAuth app distribution not supported).
- Order status-transition history and inventory-level resources are out of scope; refund events are derived from each order.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors)
- [Shopify API docs](https://shopify.dev/docs/api/admin-graphql)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
