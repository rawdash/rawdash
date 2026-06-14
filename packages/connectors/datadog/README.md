<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-datadog

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-datadog)](https://www.npmjs.com/package/@rawdash/connector-datadog)
[![license](https://img.shields.io/npm/l/@rawdash/connector-datadog)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync monitor health, monitor state-change events, incidents, SLOs, and user-declared metric queries from a Datadog org.

## Install

```sh
npm install @rawdash/connector-datadog
```

## Authentication

A Datadog API key and Application key are required, scoped to the org and site you want to read from. Both are stored as secrets.

1. Open Datadog → Organization Settings → API Keys and create (or copy) an API key.
2. Open Datadog → Organization Settings → Application Keys and create an Application key with read access to monitors, incidents, SLOs, and metrics.
3. Store both as secrets and reference them from the connector config as `apiKey: secret("DD_API_KEY")` and `appKey: secret("DD_APP_KEY")`.
4. Set `site` to your Datadog site host (e.g. `datadoghq.com`, `datadoghq.eu`, `us3.datadoghq.com`); it defaults to `datadoghq.com`.

## Configuration

| Field                  | Type   | Required | Description                                                                                                                                                                                                        |
| ---------------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apiKey`               | secret | Yes      | Datadog API key. Create at Datadog → Organization Settings → API Keys.                                                                                                                                             |
| `appKey`               | secret | Yes      | Datadog Application key. Create at Datadog → Organization Settings → Application Keys. Used in tandem with the API key to authenticate REST calls.                                                                 |
| `site`                 | string | No       | Datadog site host (e.g. `datadoghq.com`, `datadoghq.eu`, `us3.datadoghq.com`). Defaults to `datadoghq.com`.                                                                                                        |
| `metricQueries`        | array  | No       | User-declared metric timeseries queries. Each entry produces `datadog_metric` samples named `<name>` from the Datadog Metrics Query API.                                                                           |
| `resources`            | array  | No       | Which Datadog resources to sync. Omit to sync all of them. 'monitor_events' depends on 'monitors' being fetched - enabling it without 'monitors' still runs the monitors query but skips writing monitor entities. |
| `metricsLookbackHours` | number | No       | Window of metric samples to pull on each sync, in hours. Defaults to 24.                                                                                                                                           |

## Resources

- **`datadog_monitor`** _(entity)_ - Datadog monitors with name, type, current status (OK / Alert / Warn / No Data), priority, and tags.
  - Endpoint: `GET /api/v1/monitor/search`
- **`datadog_monitor_event`** _(event)_ - Monitor state-transition events, emitted whenever a monitor's status changes from its previously-stored value.
  - Derived by diffing each monitor's current status against the last-synced status, so it depends on the monitors phase running and on prior monitor state being stored.
- **`datadog_incident`** _(entity)_ - Datadog incidents with title, severity, state, and created / resolved timestamps.
  - Endpoint: `GET /api/v2/incidents`
- **`datadog_slo`** _(entity)_ - Service Level Objectives with type, thresholds, primary target, and latest SLI value.
  - Endpoint: `GET /api/v1/slo`
- **`datadog_slo_sli`** _(metric)_ - SLI value samples per SLO, one per overall_status snapshot reported by Datadog.
  - Unit: percent
  - Dimensions: `sloId`, `sloType`
- **`datadog_metric`** _(metric)_ - User-declared metric timeseries samples, stored as `datadog_metric.<query name>`, from the Datadog Metrics Query API.
  - Endpoint: `POST /api/v2/query/timeseries`
  - Dimensions: `queryName`, `query`, `tags`

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const datadog = {
  name: 'datadog',
  connectorId: 'datadog',
  config: {
    apiKey: secret('DD_API_KEY'),
    appKey: secret('DD_APP_KEY'),
    site: 'datadoghq.com',
  },
};

export default defineConfig({
  connectors: [datadog],
  dashboards: {
    observability: defineDashboard({
      widgets: {
        monitors_in_alert: {
          kind: 'stat',
          title: 'Monitors in Alert',
          metric: defineMetric({
            connector: datadog,
            shape: 'entity',
            entityType: 'datadog_monitor',
            fn: 'count',
            filter: [{ field: 'status', op: 'eq', value: 'Alert' }],
          }),
        },
      },
    }),
  },
});
```

## Rate limits

Datadog returns X-RateLimit-Remaining / X-RateLimit-Reset headers (reset in seconds) on the v2 endpoints, wired through the standard rate-limit policy so the host scheduler backs off on near-empty windows.

## Limitations

- Logs and RUM session data are out of scope (high volume, low dashboard signal).
- Synthetic monitor results are out of scope.
- Monitor entities are not cleared on a full sync - the monitor_events diff depends on the prior status being stored.
- Pagination URLs are pinned to the configured `api.<site>` host.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors)
- [Datadog API docs](https://docs.datadoghq.com/api/latest/)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
