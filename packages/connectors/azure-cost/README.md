<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-azure-cost

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-azure-cost)](https://www.npmjs.com/package/@rawdash/connector-azure-cost)
[![license](https://img.shields.io/npm/l/@rawdash/connector-azure-cost)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Track daily Azure spend over time, optionally broken down by resource group, service, or tag, via the Cost Management query API.

> **Cost & frequency.** Azure Cost Management queries are throttled aggressively per subscription; avoid syncing more often than necessary. Recommended sync interval: **1 day**. Minimum sensible interval: **1 hour**.

## Install

```sh
npm install @rawdash/connector-azure-cost
```

## Authentication

Authenticates with a Microsoft Entra ID (Azure AD) service principal (tenant ID + client ID + client secret) scoped to the target subscription. The principal needs the built-in Cost Management Reader role at the subscription scope (or Reader).

1. In the Azure portal open Microsoft Entra ID → App registrations → New registration and create an app for rawdash.
2. Under Certificates & secrets, generate a client secret and copy its value (it is only shown once).
3. In the target subscription open Access control (IAM) → Add role assignment and grant the new service principal the built-in Cost Management Reader role.
4. Store the client secret as a secret and reference it from config as `clientSecret: secret("AZ_CLIENT_SECRET")`, alongside `tenantId`, `clientId`, and `subscriptionId`.
5. Cost Management must be enabled for the subscription; the first activation can take up to 24 hours before data is queryable.

## Configuration

| Field            | Type   | Required | Description                                                                                                                                 |
| ---------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `tenantId`       | string | Yes      | Microsoft Entra ID (Azure AD) tenant ID - the directory that hosts the app registration.                                                    |
| `clientId`       | string | Yes      | Application (client) ID of the Entra ID app registration / service principal used for authentication.                                       |
| `clientSecret`   | secret | Yes      | Client secret of the Entra ID app registration. Generate one under App registrations → Certificates & secrets.                              |
| `subscriptionId` | string | Yes      | Azure subscription ID the cost query is scoped to. The service principal needs Cost Management Reader (or Reader) on this subscription.     |
| `groupBy`        | array  | No       | Up to two Cost Management dimensions to break costs down by, e.g. ServiceName, ResourceGroup, or TAG:Environment. Omit for total cost only. |
| `lookbackDays`   | number | No       | How many days of history to fetch on a full sync. Defaults to 90.                                                                           |

## Resources

- **`azure_cost_daily`** _(metric)_ - Daily Azure actual cost per time bucket, optionally split across the configured group-by dimensions.
  - Endpoint: `POST /subscriptions/{subId}/providers/Microsoft.CostManagement/query`
  - Unit: currency reported by Azure
  - Granularity: daily
  - Dimensions: `unit`, `service_name`
  - Cost data can be revised for a couple of days after the fact, so incremental syncs refetch a short trailing window. Cost Management accepts at most two grouping dimensions per query.

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const azureCost = {
  name: 'azure-cost',
  connectorId: 'azure-cost',
  config: {
    tenantId: '00000000-0000-0000-0000-000000000000',
    clientId: '00000000-0000-0000-0000-000000000000',
    clientSecret: secret('AZ_CLIENT_SECRET'),
    subscriptionId: '00000000-0000-0000-0000-000000000000',
    groupBy: ['ServiceName'],
  },
};

export default defineConfig({
  connectors: [azureCost],
  dashboards: {
    finance: defineDashboard({
      widgets: {
        spend_30d: {
          kind: 'stat',
          title: 'Azure spend (30d)',
          window: '30d',
          metric: defineMetric({
            connector: azureCost,
            shape: 'metric',
            name: 'azure_cost_daily',
            fn: 'sum',
          }),
        },
      },
    }),
  },
});
```

## Rate limits

Cost Management throttles via 429 responses with Retry-After; the shared HTTP client honors Retry-After and backs off on 429.

## Limitations

- Cost data can be revised for a couple of days after the fact, so incremental syncs refetch a short trailing window.
- Daily granularity only (the most common dashboard slice). Monthly granularity is not exposed in v1.
- At most two grouping dimensions are accepted per query (Cost Management limit).
- Forecast (`forecast` endpoint) is not synced in v1; only historical actual cost.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors)
- [Microsoft Azure API docs](https://learn.microsoft.com/en-us/rest/api/cost-management/)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
