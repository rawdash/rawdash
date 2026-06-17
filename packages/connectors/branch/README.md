<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-branch

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-branch)](https://www.npmjs.com/package/@rawdash/connector-branch)
[![license](https://img.shields.io/npm/l/@rawdash/connector-branch)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync Branch install attribution metrics (installs, opens, conversions) and deep-link click events from the Query API for mobile attribution dashboards.

## Install

```sh
npm install @rawdash/connector-branch
```

## Authentication

A Branch app key and secret, sent together in the Query API request body to authenticate each call.

1. In the Branch dashboard, open Account Settings -> Profile and copy the Branch Key (starts with `key_live_`).
2. On the same screen, reveal and copy the Branch Secret (starts with `secret_live_`). Both values are app-scoped; keep them in a secret store.
3. Reference them from the connector config as `branchKey: secret("BRANCH_KEY")` and `branchSecret: secret("BRANCH_SECRET")`.

## Configuration

| Field          | Type   | Required | Description                                                                                                       |
| -------------- | ------ | -------- | ----------------------------------------------------------------------------------------------------------------- |
| `branchKey`    | secret | Yes      | Your Branch app key (starts with `key_live_`). Find it in the Branch dashboard under Account Settings -> Profile. |
| `branchSecret` | secret | Yes      | Your Branch app secret (starts with `secret_live_`). Find it next to the key in the Branch dashboard.             |
| `lookbackDays` | number | No       | How many calendar days of metrics/events to fetch on a full sync. Defaults to 90.                                 |
| `resources`    | array  | No       | Which Branch resources to sync. Omit to sync all of them.                                                         |

## Resources

- **`branch_install_metrics`** _(metric)_ - Daily Branch attribution metrics bucketed by channel and campaign. The canonical value is attributed `installs`; `opens` and `conversions` are carried as measures.
  - Endpoint: `POST /v1/query/analytics`
  - Unit: installs
  - Granularity: day
  - Dimensions: `date`, `channel`, `campaign`
  - Measures: `opens`, `conversions`
  - Merges three Query API calls (data_source=eo_install, eo_open, eo_custom_event) keyed by (date, channel, campaign). Rows with missing channel or campaign are recorded as `null` for that attribute.
- **`branch_deep_link_event`** _(event)_ - Daily aggregated Branch deep-link click events bucketed by channel, campaign, and feature. One event per (date, channel, campaign, feature) row carrying the daily click count.
  - Endpoint: `POST /v1/query/analytics`
  - Sourced from data_source=eo_click. Event id encodes the bucket so resyncs are idempotent.
  - `date`: Calendar day of the click bucket (UTC).
  - `channel`: Branch last-attributed channel.
  - `campaign`: Branch last-attributed campaign.
  - `feature`: Branch last-attributed feature (e.g. `sharing`).
  - `clicks`: Click count for the bucket.

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const branch = {
  name: 'branch',
  connectorId: 'branch',
  config: {
    branchKey: secret('BRANCH_KEY'),
    branchSecret: secret('BRANCH_SECRET'),
    lookbackDays: 90,
  },
};

export default defineConfig({
  connectors: [branch],
  dashboards: {
    mobile: defineDashboard({
      widgets: {
        installs_30d: {
          kind: 'stat',
          title: 'Branch installs (30d)',
          window: '30d',
          metric: defineMetric({
            connector: branch,
            shape: 'metric',
            name: 'branch_install_metrics',
            field: 'value',
            fn: 'sum',
          }),
        },
        daily_installs: {
          kind: 'timeseries',
          title: 'Daily installs by channel',
          window: '30d',
          metric: defineMetric({
            connector: branch,
            shape: 'metric',
            name: 'branch_install_metrics',
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

The Branch Query API allows roughly 5 requests/second, 20/minute, and 150/hour per app. Because each sync splits its window into <=7-day segments and paginates, a wide window fans out to many requests; the connector relies on the shared HTTP client to honor 429 responses and the `Retry-After` header with backoff.

## Limitations

- Daily granularity only - the connector requests `granularity=day` from the Branch Query API to keep result cardinality bounded.
- Branch rejects windows wider than 7 days, so each requested range is split into <=7-day segments and fetched one segment at a time.
- Deep-link events are aggregated daily click counts per (date, channel, campaign, feature). Individual click-level records require the Branch Daily Export API which is intentionally out of scope.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors)
- [Branch API docs](https://help.branch.io/developers-hub/reference)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
