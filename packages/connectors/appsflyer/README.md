<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-appsflyer

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-appsflyer)](https://www.npmjs.com/package/@rawdash/connector-appsflyer)
[![license](https://img.shields.io/npm/l/@rawdash/connector-appsflyer)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync AppsFlyer install attribution metrics (installs, cost, revenue, conversions) and cohort retention from the Master API for mobile paid-acquisition dashboards.

## Install

```sh
npm install @rawdash/connector-appsflyer
```

## Authentication

An AppsFlyer V2.0 API token with Pull/Master API access scoped to the target app.

1. In AppsFlyer, open Settings → API tokens and create a V2.0 token (or reuse one). Grant it access to the app you intend to sync.
2. Copy the generated token. AppsFlyer V2.0 tokens are long-lived bearer tokens; rotate them on your normal cadence.
3. Find the app ID: iOS apps use `id<numericAppStoreId>` and Android apps use the package name (e.g. `com.example.app`). The same identifier is shown at the top of every AppsFlyer dashboard page.
4. Store the token as a secret and reference it from the connector config as `apiToken: secret("APPSFLYER_API_TOKEN")` alongside `appId: "id<id>"` or `appId: "com.example.app"`.

## Configuration

| Field          | Type   | Required | Description                                                                                                                                                |
| -------------- | ------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `appId`        | string | Yes      | AppsFlyer app identifier: iOS apps use `id<numericId>` (the App Store ID with an `id` prefix); Android apps use the package name (e.g. `com.example.app`). |
| `apiToken`     | secret | Yes      | AppsFlyer V2.0 API token with Pull/Master API permissions for the app. Generate it in AppsFlyer → Settings → API tokens.                                   |
| `lookbackDays` | number | No       | How many calendar days of metrics to fetch on a full sync. Defaults to 90.                                                                                 |
| `timezone`     | string | No       | IANA timezone to use for daily bucketing (e.g. `America/New_York`). Defaults to AppsFlyer’s preferred timezone on the app.                                 |
| `currency`     | string | No       | ISO currency code for cost/revenue KPIs. Defaults to AppsFlyer’s preferred currency on the app.                                                            |
| `resources`    | array  | No       | Which AppsFlyer resources to sync. Omit to sync all of them.                                                                                               |

## Resources

- **`appsflyer_install_metrics`** _(metric)_ - Daily AppsFlyer install metrics bucketed by media source and campaign. Primary value is `installs`; cost, revenue, and conversions are carried as attributes.
  - Endpoint: `GET /api/master-agg-data/v4/app/{app_id}`
  - Unit: installs
  - Granularity: day
  - Dimensions: `date`, `mediaSource`, `campaign`, `installs`, `cost`, `revenue`, `conversions`
  - Master API request uses `groupings=af_date,af_media_source,af_campaign` and `kpis=installs,cost,revenue,conversions`. Rows with missing media source or campaign are recorded as `null` for that attribute.
- **`appsflyer_retention_metrics`** _(metric)_ - Cohort retention from AppsFlyer, bucketed by cohort date and media source for retention day 1, 7, and 30. Primary value is `retainedUsers`.
  - Endpoint: `GET /api/master-agg-data/v4/app/{app_id}`
  - Unit: users
  - Granularity: day
  - Dimensions: `cohortDate`, `mediaSource`, `period`, `retainedUsers`
  - One sample per (cohort*date, media_source, retention period). The Master API exposes retained-users counts under `retained_users_day*<N>` KPIs.

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const appsflyer = {
  name: 'appsflyer',
  connectorId: 'appsflyer',
  config: {
    appId: 'id1234567890',
    apiToken: secret('APPSFLYER_API_TOKEN'),
    lookbackDays: 90,
  },
};

export default defineConfig({
  connectors: [appsflyer],
  dashboards: {
    mobile: defineDashboard({
      widgets: {
        installs_30d: {
          kind: 'stat',
          title: 'AppsFlyer installs (30d)',
          window: '30d',
          metric: defineMetric({
            connector: appsflyer,
            shape: 'metric',
            name: 'appsflyer_install_metrics',
            field: 'installs',
            fn: 'sum',
          }),
        },
        daily_installs: {
          kind: 'timeseries',
          title: 'Daily installs by media source',
          window: '30d',
          metric: defineMetric({
            connector: appsflyer,
            shape: 'metric',
            name: 'appsflyer_install_metrics',
            field: 'installs',
            fn: 'sum',
          }),
        },
      },
    }),
  },
});
```

## Rate limits

AppsFlyer enforces a per-token daily request budget for the Master/Pull APIs (60 requests/hour, 200/day by default). The connector issues one request per resource per sync and respects 429 + Retry-After backoff via the shared HTTP client.

## Limitations

- Daily granularity only - the AppsFlyer Master API does not expose sub-daily buckets.
- Re-attribution and re-engagement KPIs are out of scope (the connector only requests install KPIs to keep the cardinality bounded). Add them in a follow-up if you need them.
- Cohort retention is fetched at the (media_source, cohort_date) granularity for retention days 1, 7, and 30. Per-campaign cohort retention is intentionally omitted to keep the metric cardinality manageable.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors/)
- [AppsFlyer API docs](https://dev.appsflyer.com/hc/reference/master-api)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
