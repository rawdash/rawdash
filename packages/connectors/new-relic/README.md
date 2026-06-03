<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-new-relic

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-new-relic)](https://www.npmjs.com/package/@rawdash/connector-new-relic)
[![license](https://img.shields.io/npm/l/@rawdash/connector-new-relic)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync NRQL alert conditions, AI incidents, and user-declared NRQL metric queries from a New Relic account via NerdGraph.

## Install

```sh
npm install @rawdash/connector-new-relic
```

## Authentication

A New Relic User API key plus the numeric account ID are required. The key is stored as a secret and used to authenticate every NerdGraph GraphQL request.

1. Open New Relic -> API keys and create a `User` key. Ingest-keys are not accepted by NerdGraph.
2. Find the numeric account ID under New Relic -> Administration -> Access management. The User key must have access to that account.
3. Store the User key as a secret and reference it from the connector config as `apiKey: secret("NEWRELIC_USER_KEY")`.
4. Set `accountId` to the numeric account ID, and optionally `region: "EU"` if the data lives on the EU host (`api.eu.newrelic.com`); defaults to `US` (`api.newrelic.com`).

## Configuration

| Field                    | Type         | Required | Description                                                                                                                                                                                        |
| ------------------------ | ------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apiKey`                 | secret       | Yes      | New Relic User API key. Create at New Relic -> API keys (User key type, ingest-keys do not work for NerdGraph).                                                                                    |
| `accountId`              | number       | Yes      | New Relic account ID the User API key has access to. Find it under New Relic -> Administration -> Access management.                                                                               |
| `region`                 | `US` \| `EU` | No       | New Relic data region. Defaults to `US` (`api.newrelic.com`); set to `EU` to use `api.eu.newrelic.com`.                                                                                            |
| `nrqlQueries`            | array        | No       | User-declared NRQL queries. Each entry produces `newrelic_nrql_metric` samples named `<name>` from the NerdGraph NRQL API.                                                                         |
| `resources`              | array        | No       | Which New Relic resources to sync. Omit to sync all of them.                                                                                                                                       |
| `incidentsLookbackHours` | number       | No       | Window of NrAiIncident rows to pull on each sync, in hours. Defaults to 168 (7 days). Ignored when `since` is set by the host.                                                                     |
| `metricsLookbackHours`   | number       | No       | Window of NRQL metric samples to pull on each sync, in hours. Defaults to 24. Each user query gets `SINCE <lookback> hours ago` appended unless the query already declares its own `SINCE` clause. |

## Resources

- **`newrelic_alert_condition`** _(entity)_ - NRQL alert conditions with name, enabled state, policy id, type, and the underlying NRQL query string.
  - Endpoint: `GraphQL query: actor.account.alerts.nrqlConditionsSearch { nrqlConditions { ... } }`
- **`newrelic_alert_violation`** _(event)_ - AI alert violation events. Each row from the NrAiIncident event type becomes one event with openedAt / closedAt and the underlying condition / policy metadata.
  - Endpoint: `GraphQL nrql() against `SELECT ... FROM NrAiIncident WHERE openedAt > ...``
  - Append-only across syncs; the connector filters NrAiIncident by `openedAt` against `options.since` (or the configured lookback) to avoid re-emitting old incidents.
- **`newrelic_nrql_metric`** _(metric)_ - User-declared NRQL metric samples, stored as `newrelic_nrql_metric.<query name>`. Each NRQL result row is mapped to a single sample using the first numeric, non-timestamp/facet field as the value.
  - Endpoint: `GraphQL nrql() against the user-declared NRQL query`
  - Dimensions: `queryName`, `query`, `facets`

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const newRelic = {
  name: 'newrelic',
  connectorId: 'new-relic',
  config: {
    apiKey: secret('NEWRELIC_USER_KEY'),
    accountId: 1234567,
    region: 'US' as const,
    nrqlQueries: [
      {
        name: 'error_rate',
        query:
          'SELECT percentage(count(*), WHERE error IS true) FROM Transaction TIMESERIES 5 minutes',
      },
    ],
  },
};

export default defineConfig({
  connectors: [newRelic],
  dashboards: {
    observability: defineDashboard({
      widgets: {
        open_violations: {
          kind: 'stat',
          title: 'Open Alert Violations',
          metric: defineMetric({
            connector: newRelic,
            shape: 'event',
            name: 'newrelic_alert_violation',
            fn: 'count',
            filter: [{ field: 'state', op: 'eq', value: 'CREATED' }],
          }),
        },
      },
    }),
  },
});
```

## Rate limits

NerdGraph enforces per-account NRQL quotas; this connector retries on 429s through the standard HTTP retry policy.

## Limitations

- APM-trace deep inspection is out of scope (not dashboard-shaped).
- NRQL queries are single-shot per sync (NRQL does not support cursor pagination); large queries should narrow their `SINCE` window or use `LIMIT MAX`.
- Incidents are pulled via NRQL on the NrAiIncident event type, which depends on Applied Intelligence being enabled on the account.
- Only NRQL-based alert conditions are synced; legacy V1 condition types are not exposed.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors/)
- [New Relic API docs](https://docs.newrelic.com/docs/apis/nerdgraph/)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
