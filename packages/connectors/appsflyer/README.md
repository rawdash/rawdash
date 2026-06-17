<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-appsflyer

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-appsflyer)](https://www.npmjs.com/package/@rawdash/connector-appsflyer)
[![license](https://img.shields.io/npm/l/@rawdash/connector-appsflyer)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync AppsFlyer install attribution metrics (installs, cost, revenue, loyal users) and retention from the Master API for mobile paid-acquisition dashboards.

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

- **`appsflyer_install_metrics`** _(metric)_ - Daily AppsFlyer install metrics bucketed by media source and campaign. Primary value is attributed installs; cost, revenue, and loyal users are carried as measures.
  - Endpoint: `GET /api/master-agg-data/v4/app/{app_id}`
  - Unit: installs
  - Granularity: day
  - Dimensions: `date`, `mediaSource`, `campaign`
  - Measures: `cost`, `revenue`, `loyalUsers`
  - Master API request uses `groupings=af_date,pid,c` (`pid` is the media source, `c` the campaign) and `kpis=installs,cost,revenue,loyal_users`. Rows with missing media source or campaign are recorded as `null` for that attribute.
- **`appsflyer_retention_metrics`** _(metric)_ - Install-day cohort retention from AppsFlyer, bucketed by install date and media source for retention day 1, 7, and 30. Primary value is the number of users from the cohort still active on the retention day.
  - Endpoint: `GET /api/master-agg-data/v4/app/{app_id}`
  - Unit: users
  - Granularity: day
  - Dimensions: `cohortDate`, `mediaSource`, `period`
  - Master API request uses `groupings=af_date,pid` and `kpis=retention_day_1,retention_day_7,retention_day_30` (the Master API treats the install day as the cohort and caps retention at day 30). One sample per (install date, media source, retention period).

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
            field: 'value',
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
            field: 'value',
            fn: 'sum',
          }),
        },
      },
    }),
  },
});
```

## Rate limits

The AppsFlyer Master/aggregate API quota is window-dependent: short date ranges (<=2 days) allow roughly 1 request per minute per app per report, while ranges of 3 days or more are capped at roughly 120 requests/day per account and 24/day per app. The connector issues one request per resource per sync and backs off on HTTP 429 via the shared HTTP client (honoring Retry-After when the response provides it).

## Limitations

- Daily granularity only - the AppsFlyer Master API does not expose sub-daily buckets.
- Re-attribution and re-engagement KPIs are out of scope (the connector only requests install KPIs to keep the cardinality bounded). Add them in a follow-up if you need them.
- Retention uses the Master API install-day cohort (grouped by install date and media source) for retention days 1, 7, and 30 (the Master API caps retention at day 30). True acquisition-date cohorts would require the separate Cohort reporting API, which is out of scope here.
- AppsFlyer finalizes attribution data 24-48h after the fact. The connector re-fetches a trailing lookback window on every incremental sync and overwrites the metric scope, so late-finalized days are corrected on the next run.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors)
- [AppsFlyer API docs](https://dev.appsflyer.com/hc/reference/master-api)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
