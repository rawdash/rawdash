<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-posthog

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-posthog)](https://www.npmjs.com/package/@rawdash/connector-posthog)
[![license](https://img.shields.io/npm/l/@rawdash/connector-posthog)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync feature flags, per-day event volume, feature flag usage, active users, and funnel conversion from a PostHog project.

## Install

```sh
npm install @rawdash/connector-posthog
```

## Authentication

A PostHog personal API key with read access to the project is required, along with the numeric project ID and the instance host.

1. Open PostHog → Settings → Personal API keys and create a key with read access to the project (it starts with `phx_`).
2. Find your numeric project ID in PostHog → Settings → Project → Project ID.
3. Set `host` to your instance base URL - `https://us.posthog.com` or `https://eu.posthog.com` for PostHog Cloud, or your self-hosted origin (no trailing slash).
4. Store the key as a secret and reference it from config as `apiKey: secret("POSTHOG_API_KEY")`.

## Configuration

| Field          | Type   | Required | Description                                                                                                                                                                          |
| -------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apiKey`       | secret | Yes      | PostHog personal API key with read access to the project. Create one at PostHog → Settings → Personal API keys (starts with `phx_`).                                                 |
| `projectId`    | string | Yes      | Numeric ID of your PostHog project. Find it in PostHog → Settings → Project → Project ID.                                                                                            |
| `host`         | string | No       | PostHog instance base URL. Use https://us.posthog.com or https://eu.posthog.com for PostHog Cloud, or your self-hosted origin. No trailing slash.                                    |
| `events`       | array  | No       | Event names to roll up in the `events_per_day` resource. Omit to roll up every event in the project.                                                                                 |
| `funnels`      | array  | No       | Funnel definitions to evaluate. Each funnel is an object with name, steps (an ordered list of event names), and an optional windowDays. Conversion is measured over the sync window. |
| `lookbackDays` | number | No       | How many calendar days of history to roll up on a full sync. Defaults to 30.                                                                                                         |
| `resources`    | array  | No       | Which PostHog resources to sync. Omit to sync all of them.                                                                                                                           |

## Resources

- **`posthog_feature_flag`** _(entity)_ - Feature flags in the project, keyed by flag id, with key, name, active state, rollout percentage, and a JSON snapshot of the flag filters.
  - Endpoint: `GET /api/projects/{projectId}/feature_flags/`
  - Feature flags upsert by id on every run.
- **`posthog_events_per_day`** _(metric)_ - Daily event volume rolled up by event name via HogQL. One sample per (day, event) over the lookback window. Restricted to the configured `events` list when provided, otherwise every event.
  - Endpoint: `POST /api/projects/{projectId}/query (HogQLQuery)`
  - Unit: events
  - Granularity: Daily (UTC)
  - Dimensions: `event`, `count`, `distinctUsers`
  - Rollup metrics are stamped at UTC midnight of the day they cover.
- **`posthog_feature_flag_usage`** _(metric)_ - Daily `$feature_flag_called` volume rolled up by flag key via HogQL. One sample per (day, flag) over the lookback window.
  - Endpoint: `POST /api/projects/{projectId}/query (HogQLQuery)`
  - Unit: calls
  - Granularity: Daily (UTC)
  - Dimensions: `flagKey`, `callCount`, `uniqueUsers`
  - Rollup metrics are stamped at UTC midnight of the day they cover.
- **`posthog_active_users`** _(metric)_ - Daily active-user counts from a TrendsQuery, with one sample per day per rolling window (daily, weekly, and monthly active users).
  - Endpoint: `POST /api/projects/{projectId}/query (TrendsQuery)`
  - Unit: users
  - Granularity: Daily (UTC)
  - Dimensions: `window`
  - Rollup metrics are stamped at UTC midnight of the day they cover.
- **`posthog_funnel`** _(metric)_ - Funnel conversion snapshot. One sample per declared funnel step, stamped at the start of the current UTC day, carrying the step user count and conversion rate relative to the first step. Only written when `funnels` are configured.
  - Endpoint: `POST /api/projects/{projectId}/query (FunnelsQuery)`
  - Unit: users
  - Granularity: Snapshot per sync (start of UTC day)
  - Dimensions: `funnel`, `step`, `stepName`, `users`, `conversionRate`
  - A single conversion snapshot measured over the lookback window, stamped at the start of the current UTC day, not a per-day time series.

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const posthog = {
  name: 'posthog',
  connectorId: 'posthog',
  config: {
    apiKey: secret('POSTHOG_API_KEY'),
    projectId: '12345',
    host: 'https://us.posthog.com',
    events: ['pageview', 'signup'],
  },
};

export default defineConfig({
  connectors: [posthog],
  dashboards: {
    product: defineDashboard({
      widgets: {
        daily_events: {
          kind: 'timeseries',
          title: 'Events per day',
          window: '30d',
          metric: defineMetric({
            connector: posthog,
            shape: 'metric',
            name: 'posthog_events_per_day',
            fn: 'sum',
          }),
        },
      },
    }),
  },
});
```

## Rate limits

PostHog allows roughly 1200 requests/min per personal API key; Retry-After is honored.

## Limitations

- Session recordings/replays and cohorts are not synced.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors)
- [PostHog API docs](https://posthog.com/docs/api)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
