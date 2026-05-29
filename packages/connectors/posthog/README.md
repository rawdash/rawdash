# @rawdash/connector-posthog

Rawdash connector for [PostHog](https://posthog.com) — syncs event volume, active users (DAU/WAU/MAU), feature flags, feature-flag usage, and declared funnels into the six-shape storage model. Built for the product-analytics vertical: engineering and product teams that already run PostHog can chart adoption, rollout exposure, and conversion alongside the rest of their dashboards.

## Auth setup

The connector authenticates with a **personal API key** (read access to the project).

1. In PostHog, open **Settings → Personal API keys** (under your account menu).
2. Click **Create personal API key**, give it a name (e.g. `rawdash`).
3. Scope it to **read** access for the project's analytics and feature-flag resources (`query:read`, `feature_flag:read`). A personal API key is required — project keys and organization keys are not supported.
4. Copy the key (starts with `phx_`) — it's shown only once.

You also need your **Project ID** (a number), found in **Settings → Project → Project ID**, and your instance **host**:

- PostHog Cloud US: `https://us.posthog.com`
- PostHog Cloud EU: `https://eu.posthog.com`
- Self-hosted: your own origin, e.g. `https://posthog.internal.example.com`

## Configuration

```ts
import { secret } from '@rawdash/core';

const posthog = {
  name: 'posthog',
  connectorId: 'posthog',
  config: {
    apiKey: secret('POSTHOG_API_KEY'),
    projectId: '12345',
    host: 'https://us.posthog.com', // defaults to https://us.posthog.com
    // events: ['$pageview', 'signed_up'],          // optional, defaults to all events
    // funnels: [{ name: 'Signup', steps: ['$pageview', 'signed_up'] }],
    // resources: ['events_per_day', 'feature_flags'], // optional, defaults to all
  },
};
```

Register the connector class when mounting the engine:

```ts
import { PostHogConnector } from '@rawdash/connector-posthog';
import { mountEngine } from '@rawdash/hono';

mountEngine(config, { connectorRegistry: { posthog: PostHogConnector } });
```

### Choosing resources

By default the connector syncs every supported resource. Pass `resources` to sync only a subset:

`feature_flags`, `events_per_day`, `feature_flag_usage`, `active_users`, `funnels`

### Configuration reference

| Field          | Required | Description                                                                                        |
| -------------- | -------- | -------------------------------------------------------------------------------------------------- |
| `apiKey`       | yes      | Personal API key (secret). Bearer-authenticated.                                                   |
| `projectId`    | yes      | Numeric PostHog project ID.                                                                        |
| `host`         | no       | Instance base URL. Defaults to `https://us.posthog.com`. No trailing slash.                        |
| `events`       | no       | Event names to roll up in `events_per_day`. Omit to roll up every event.                           |
| `funnels`      | no       | Funnel definitions: `{ name, steps: [event, …], windowDays? }`. `steps` needs at least two events. |
| `lookbackDays` | no       | Days of history to roll up on a full sync. Defaults to 30.                                         |
| `resources`    | no       | Subset of resources to sync. Omit for all.                                                         |

### Example dashboard

```ts
import { defineConfig, defineDashboard, defineMetric } from '@rawdash/core';

export default defineConfig({
  connectors: [posthog],
  dashboards: {
    product: defineDashboard({
      widgets: {
        active_flags: {
          kind: 'stat',
          title: 'Active feature flags',
          metric: defineMetric({
            connector: posthog,
            shape: 'entity',
            entityType: 'posthog_feature_flag',
            fn: 'count',
            filter: [{ field: 'active', op: 'eq', value: true }],
          }),
        },
        dau: {
          kind: 'timeseries',
          title: 'Daily active users',
          window: '30d',
          metric: defineMetric({
            connector: posthog,
            shape: 'metric',
            name: 'posthog_active_users',
            field: 'value',
            fn: 'latest',
            window: '30d',
            filter: [{ field: 'window', op: 'eq', value: 'dau' }],
            groupBy: { field: 'ts', granularity: 'day' },
          }),
        },
        events_by_name: {
          kind: 'distribution',
          title: 'Events by name (30d)',
          metric: defineMetric({
            connector: posthog,
            shape: 'metric',
            name: 'posthog_events_per_day',
            field: 'count',
            fn: 'sum',
            groupBy: { field: 'event' },
          }),
        },
        checkout_funnel: {
          kind: 'funnel',
          title: 'Checkout conversion',
          metric: defineMetric({
            connector: posthog,
            shape: 'metric',
            name: 'posthog_funnel',
            field: 'conversionRate',
            fn: 'latest',
            filter: [{ field: 'funnel', op: 'eq', value: 'Checkout' }],
            groupBy: { field: 'step' },
          }),
        },
      },
    }),
  },
});
```

## Data model

Timestamps stored in attributes are Unix milliseconds. Rollup metrics are stamped at UTC midnight of the day they cover.

| Storage shape | Type                         | Key attributes                                        |
| ------------- | ---------------------------- | ----------------------------------------------------- |
| entity        | `posthog_feature_flag`       | key, name, active, rolloutPercentage, filters (JSON)  |
| metric        | `posthog_events_per_day`     | event, count, distinctUsers (value = count)           |
| metric        | `posthog_feature_flag_usage` | flagKey, callCount, uniqueUsers (value = callCount)   |
| metric        | `posthog_active_users`       | window (`dau` / `wau` / `mau`) (value = active users) |
| metric        | `posthog_funnel`             | funnel, step, stepName, users, conversionRate         |

- **`posthog_events_per_day`** is a HogQL rollup grouped by `(day, event)`. Restrict it to specific events with the `events` config field.
- **`posthog_active_users`** runs one Trends query with `dau` / `weekly_active` / `monthly_active` series; each series is written under the matching `window` attribute so a single metric drives all three.
- **`posthog_feature_flag_usage`** counts `$feature_flag_called` events grouped by `(day, flag key)`.
- **`posthog_funnel`** evaluates each declared funnel over the sync window and writes one sample per step; `conversionRate` is the step's users relative to the first step.

## Schemas

`PostHogConnector.schemas` declares the Zod schema for each resource's raw API payload — the feature-flag record array, the positional HogQL result rows, the Trends series, and the funnel step results. Used by the cloud shape-drift pipeline to populate `connector_baselines`, and by the package's property tests.

## Sync behaviour

- **Backfill** (`mode: 'full'`): rolls up the last `lookbackDays` (default 30) of analytics and rewrites every metric scope; feature flags are enumerated in full.
- **Incremental** (`mode: 'latest'`): the rollup window starts at `options.since` (capped to `lookbackDays`), so analytics queries scan only the changed window. Feature flags upsert by id on every run.
- **Resumable**: `feature_flags` yields an offset cursor and `funnels` yields a per-funnel index cursor, so an interrupted sync resumes from the same page. The single-shot query phases re-run from scratch (their scope is cleared first, so the rewrite is idempotent).
- **Rate limits**: PostHog enforces ~1200 requests/min per personal key and returns `429` when exceeded. The shared HTTP client retries automatically with exponential back-off and honours `Retry-After`.

## Aggregates

No aggregates yet. PostHog's `query` endpoint could serve `count(...)` widgets server-side (a HogQL `count()` over the events table), which would let stat widgets skip a rollup backfill; the hook is left for a follow-up once the count-filter translation surface is defined.

## Property tests

`feature_flags`, `events_per_day`, `feature_flag_usage`, and `active_users` have fast-check property tests under `src/property.test.ts` that generate synthetic API payloads from each resource's Zod schema, run them through `connector.sync()` against an `InMemoryStorage`, and assert universal invariants (non-empty ids, finite timestamps, no `undefined` in storage, no thrown errors). Funnels and the HogQL/Trends mapping details are covered by example-driven unit tests in `src/posthog.test.ts`.

## Out of scope

Session recordings / replays and cohorts are intentionally not synced — they aren't dashboard-shaped. Open an issue if you need them.
