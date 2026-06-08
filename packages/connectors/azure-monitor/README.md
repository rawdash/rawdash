<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-azure-monitor

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-azure-monitor)](https://www.npmjs.com/package/@rawdash/connector-azure-monitor)
[![license](https://img.shields.io/npm/l/@rawdash/connector-azure-monitor)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Pull declared Azure Monitor metric time series and resource alerts into the six-shape storage model.

## Install

```sh
npm install @rawdash/connector-azure-monitor
```

## Authentication

Authenticates with a Microsoft Entra ID (Azure AD) service principal (tenant ID + client ID + client secret) scoped to the target subscription. The principal needs the built-in Monitoring Reader role at the subscription (or resource group) level.

1. In the Azure portal open Microsoft Entra ID → App registrations → New registration and create an app for rawdash.
2. Under Certificates & secrets, generate a client secret and copy its value (it is only shown once).
3. In the target subscription open Access control (IAM) → Add role assignment and grant the new service principal the built-in Monitoring Reader role (Reader is also sufficient).
4. Store the client secret as a secret and reference it from config as `clientSecret: secret("AZ_CLIENT_SECRET")`, alongside `tenantId`, `clientId`, and `subscriptionId`.
5. Each entry in `metricQueries` needs the full ARM resource URI (`/subscriptions/<sub>/resourceGroups/<rg>/providers/...`) of the resource the metric belongs to.

## Configuration

| Field             | Type   | Required | Description                                                                                                                                                                                                                                                                                               |
| ----------------- | ------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tenantId`        | string | Yes      | Microsoft Entra ID (Azure AD) tenant ID - the directory that hosts the app registration.                                                                                                                                                                                                                  |
| `clientId`        | string | Yes      | Application (client) ID of the Entra ID app registration / service principal used for authentication.                                                                                                                                                                                                     |
| `clientSecret`    | secret | Yes      | Client secret of the Entra ID app registration. Generate one under App registrations → Certificates & secrets.                                                                                                                                                                                            |
| `subscriptionId`  | string | Yes      | Azure subscription ID that scopes every metric query and alert listing. Resource URIs in `metricQueries` must live inside this subscription.                                                                                                                                                              |
| `metricQueries`   | array  | Yes      | Azure Monitor is too broad to mirror wholesale; declare the specific resource+metric combinations to pull. Each query needs an id, the full resource URI, the metric namespace, the metric name, an aggregation (Average / Minimum / Maximum / Total / Count), and an ISO 8601 interval (e.g. PT1H, P1D). |
| `resources`       | array  | No       | Which Azure Monitor resources to sync. Omit to sync all of them.                                                                                                                                                                                                                                          |
| `lookbackMinutes` | number | No       | How far back to pull metric data points on a full sync when the host does not supply a since bound. Defaults to 180.                                                                                                                                                                                      |

## Resources

- **`<metricNamespace>/<metric>`** _(metric)_ - One metric series per declared Azure Monitor metric query. The series name is the query metric namespace/metric (e.g. `Microsoft.Compute/virtualMachines/Percentage CPU`), so the actual keys depend on the configured `metricQueries`. Each sample carries the query aggregation, interval, query id, the metric unit, and any series metadata as attributes.
  - Endpoint: `GET {resourceUri}/providers/Microsoft.Insights/metrics`
  - Granularity: Per query interval
  - Dimensions: `aggregation`, `interval`, `queryId`, `resourceUri`, `unit`
  - Each sync replaces the full set of samples for the metric names it owns (idempotent).
- **`azure_alert`** _(entity)_ - Azure Monitor alerts at subscription scope. Upserted by alert id.
  - Endpoint: `GET /subscriptions/{subId}/providers/Microsoft.AlertsManagement/alerts`
  - `name`: Alert display name.
  - `severity`: Alert severity (Sev0 - Sev4).
  - `state`: Alert state (New, Acknowledged, Closed).
  - `monitorCondition`: Monitor condition (Fired, Resolved).
  - `monitorService`: Source service (e.g. Platform, ApplicationInsights).
  - `signalType`: Signal type (Metric, Log, Activity Log).
  - `targetResource`: Full ARM resource id the alert is scoped to.
  - `targetResourceType`: ARM type of the target resource.
  - `targetResourceGroup`: Resource group of the target resource.
  - `alertRule`: ARM id of the alert rule that fired this alert.
  - `startedAt`: When the alert first fired (Unix ms).
  - `resolvedAt`: When the alert was resolved (Unix ms), if it was.

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const azureMonitor = {
  name: 'azure-monitor',
  connectorId: 'azure-monitor',
  config: {
    tenantId: '00000000-0000-0000-0000-000000000000',
    clientId: '00000000-0000-0000-0000-000000000000',
    clientSecret: secret('AZ_CLIENT_SECRET'),
    subscriptionId: '00000000-0000-0000-0000-000000000000',
    metricQueries: [
      {
        id: 'vm_cpu',
        resourceUri:
          '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/prod/providers/Microsoft.Compute/virtualMachines/web-01',
        metricNamespace: 'Microsoft.Compute/virtualMachines',
        metric: 'Percentage CPU',
        aggregation: 'Average' as const,
        interval: 'PT1H' as const,
      },
    ],
  },
};

export default defineConfig({
  connectors: [azureMonitor],
  dashboards: {
    infrastructure: defineDashboard({
      widgets: {
        vm_cpu: {
          kind: 'timeseries',
          title: 'VM CPU (avg, 1h)',
          window: '24h',
          metric: defineMetric({
            connector: azureMonitor,
            shape: 'metric',
            name: 'Microsoft.Compute/virtualMachines/Percentage CPU',
            fn: 'avg',
          }),
        },
      },
    }),
  },
});
```

## Rate limits

Azure Resource Manager enforces per-tenant and per-subscription read throttling and signals it via 429 responses with Retry-After; the shared HTTP client honors Retry-After and backs off on 429.

## Limitations

- Azure Monitor is too broad to mirror wholesale; only the metrics declared in `metricQueries` are synced; there is no automatic resource discovery.
- Only the standard Metrics REST API is supported; Log Analytics (KQL) and Application Insights queries are out of scope for v1.
- A single metric query pulls one aggregation per call; declare a second query with a different `aggregation` if you need both (e.g. Average and Maximum).
- Alerts are pulled from the Alerts Management API at subscription scope; classic alert rules and the legacy Activity Log alerts are not synced.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors/)
- [Microsoft Azure API docs](https://learn.microsoft.com/en-us/rest/api/monitor/)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
