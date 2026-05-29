# @rawdash/connector-mixpanel

Rawdash connector for [Mixpanel](https://mixpanel.com) — syncs daily/weekly/monthly active users, per-event volume, declared funnel conversion data, and cohort retention into the six-shape storage model via the [Mixpanel Query API](https://developer.mixpanel.com/reference/query-api).

## Auth setup

The connector authenticates with a Mixpanel **service account** (recommended for server-to-server use). Service account credentials are project-scoped and survive user offboarding.

1. Open your Mixpanel project and navigate to **Settings → Project Settings → Service Accounts** (Mixpanel docs: [Creating a Service Account](https://developer.mixpanel.com/reference/service-accounts)).
2. Click **Add Service Account**.
3. Give it a descriptive name (e.g. `rawdash-reader`).
4. Choose a role of **Consumer** (read-only is sufficient for query access).
5. Set an expiration (a long-lived secret is fine for server use; pick a date that fits your rotation policy).
6. Click **Create**. Mixpanel will display the **Username** and **Secret** once; copy both before closing the dialog.
7. Store the secret in your secrets manager under (for example) `MIXPANEL_SECRET`. The username is not sensitive and can live in plain configuration.
8. Note your **Project ID** under **Settings → Project Settings → Overview**.

The connector calls the API with HTTP Basic auth (`Authorization: Basic base64(<username>:<secret>)`) and includes `project_id=<id>` on every request, which is the contract Mixpanel requires for service-account access.

## Configuration

```ts
import { secret } from '@rawdash/core';

const mixpanel = {
  name: 'mixpanel',
  connectorId: 'mixpanel',
  config: {
    projectId: '1234567',
    username: 'rawdash-reader.abcdef.mp-service-account',
    secret: secret('MIXPANEL_SECRET'),
    region: 'us', // 'us' (default) or 'eu' for EU residency
    events: ['Signed Up', 'Purchase'],
    funnels: [
      { id: 42, name: 'Activation' },
      { id: 99, name: 'Checkout' },
    ],
    retentionEvent: 'Signed Up',
    activeUserEvent: 'Signed Up',
    lookbackDays: 90,
  },
};
```

Register the connector class when mounting the engine:

```ts
import { MixpanelConnector } from '@rawdash/connector-mixpanel';
import { mountEngine } from '@rawdash/hono';

mountEngine(config, {
  connectorRegistry: { mixpanel: MixpanelConnector },
});
```

Then wire it into `defineConfig`:

```ts
import { defineConfig, defineDashboard, defineMetric } from '@rawdash/core';

export default defineConfig({
  connectors: [mixpanel],
  dashboards: {
    product: defineDashboard({
      widgets: {
        dau: {
          kind: 'stat',
          title: 'DAU',
          metric: defineMetric({
            connector: mixpanel,
            shape: 'metric',
            name: 'mixpanel_dau',
            field: 'value',
            fn: 'latest',
          }),
        },
        dau_trend: {
          kind: 'timeseries',
          title: 'DAU over time',
          window: '30d',
          metric: defineMetric({
            connector: mixpanel,
            shape: 'metric',
            name: 'mixpanel_dau',
            field: 'value',
            fn: 'sum',
            window: '30d',
            groupBy: { field: 'ts', granularity: 'day' },
          }),
        },
        signups_per_day: {
          kind: 'timeseries',
          title: 'Sign-ups per day',
          window: '30d',
          metric: defineMetric({
            connector: mixpanel,
            shape: 'metric',
            name: 'mixpanel_events_per_day',
            field: 'count',
            fn: 'sum',
            window: '30d',
            filter: [{ field: 'event', op: 'eq', value: 'Signed Up' }],
            groupBy: { field: 'ts', granularity: 'day' },
          }),
        },
        events_distribution: {
          kind: 'distribution',
          title: 'Top events (last 30d)',
          metric: defineMetric({
            connector: mixpanel,
            shape: 'metric',
            name: 'mixpanel_events_per_day',
            field: 'count',
            fn: 'sum',
            window: '30d',
            groupBy: { field: 'event' },
          }),
        },
      },
    }),
  },
});
```

## Configuration reference

| Field             | Required | Type              | Default | Notes                                                                                                                                                         |
| ----------------- | -------- | ----------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projectId`       | yes      | `string` (digits) | —       | Mixpanel numeric project ID.                                                                                                                                  |
| `username`        | yes      | `string`          | —       | Service-account username.                                                                                                                                     |
| `secret`          | yes      | `Secret`          | —       | Service-account secret. Use `secret('MIXPANEL_SECRET')`.                                                                                                      |
| `region`          | no       | `'us' \| 'eu'`    | `'us'`  | Switches the API host between `mixpanel.com` and `eu.mixpanel.com`.                                                                                           |
| `events`          | no       | `string[]`        | —       | Event names to fetch per-day volume + unique-user counts for. Skips the phase when empty/unset.                                                               |
| `funnels`         | no       | `{ id, name? }[]` | —       | Mixpanel funnel IDs to track. Each entry produces daily funnel-step samples. Skips when empty/unset.                                                          |
| `retentionEvent`  | no       | `string`          | —       | Event used for the retention cohort phase. Skips when unset.                                                                                                  |
| `activeUserEvent` | no       | `string`          | —       | Event used for the DAU/WAU/MAU `unique`-type segmentation queries. Defaults to the first `events` entry. Both DAU/WAU/MAU phases skip when no event resolves. |
| `lookbackDays`    | no       | `number`          | `90`    | Window in days fetched on a full sync. Incremental syncs (`mode: 'latest'`) refetch the trailing 3 days regardless.                                           |

## Data model

All resources are stored as **metric samples** (`shape: 'metric'`). The `ts` field is the bucket date in Unix milliseconds. Mixpanel returns aggregated data, so the connector writes pre-aggregated metric rows — no event-stream backfill.

| Metric name               | Bucket             | `value`                 | Attributes                                                                                      |
| ------------------------- | ------------------ | ----------------------- | ----------------------------------------------------------------------------------------------- |
| `mixpanel_dau`            | day                | unique users that day   | `unit='day'`, `event`                                                                           |
| `mixpanel_wau`            | week               | unique users that week  | `unit='week'`, `event`                                                                          |
| `mixpanel_mau`            | month              | unique users that month | `unit='month'`, `event`                                                                         |
| `mixpanel_events_per_day` | day                | total event count       | `event`, `count`, `uniqueUsers`                                                                 |
| `mixpanel_funnel_results` | day, step          | users at the step       | `funnelId`, `funnelName?`, `step`, `stepLabel`, `users`, `conversionRate`, `stepConversionRate` |
| `mixpanel_retention`      | cohort day, period | retained users          | `event`, `period` (days since cohort), `cohortSize`, `retentionRate`                            |

## Sync behaviour

- **Backfill** (`mode: 'full'`): fetches the rolling `lookbackDays` window (default 90 days) for every configured resource.
- **Incremental** (`mode: 'latest'`): refetches the trailing 3 days for every configured resource. Mixpanel can re-attribute late-arriving events, so a small overlap keeps the metrics accurate without re-syncing the full backfill.
- **Idempotency**: each phase writes via a single `storage.metrics(samples, { names: [<metric>] })` call, which replaces all prior samples for that metric. Re-running the sync against the same window converges on the same storage state.
- **Resumable**: the cursor captures `(phase, dateRange)` so an interrupted sync resumes at the next phase using the originally-computed window.
- **Resource allowlist**: `options.resources` filters which phases run. A resource not in the allowlist is skipped entirely, including its API calls.
- **Rate limits**: Mixpanel's Query API quota is 60 queries/hour per project (default). The connector batches each event/funnel into one query and reuses the result across active-user phases where possible. 429 responses fall through to the shared HTTP client's retry-with-backoff path.

## Schemas

`MixpanelConnector.schemas` exposes the Zod schema for each `request()` resource — used by the cloud shape-drift pipeline to populate `connector_baselines` and by the package's property tests.

| Resource              | Represents                                                                          |
| --------------------- | ----------------------------------------------------------------------------------- |
| `dau` / `wau` / `mau` | `GET /api/2.0/segmentation?type=unique&unit={day,week,month}` per active-user event |
| `events_per_day`      | `GET /api/2.0/segmentation?type={general,unique}&unit=day` per configured event     |
| `funnel_results`      | `GET /api/2.0/funnels?funnel_id=…&unit=day` per configured funnel                   |
| `retention`           | `GET /api/2.0/retention?retention_type=birth&unit=day&born_event=…&event=…`         |

## Aggregates

No aggregates yet — `count` / `latest` widgets fall back to evaluating against synced storage rows. Mixpanel's Query API doesn't expose a cheaper single-scalar endpoint than the segmentation/funnel queries the connector already runs, so a future `aggregate()` implementation wouldn't materially shorten the round-trip. The metric rows the connector writes are already daily aggregates, which keeps local `count` / `latest` cheap.

## Property tests

Resources in this connector have fast-check property tests under `src/property.test.ts` that:

1. Generate N≥50 synthetic API payloads from a Zod schema mirroring the upstream API response.
2. Pipe them through `connector.sync()` against an `InMemoryStorage` instance.
3. Assert universal invariants (finite timestamps, no `undefined` leaking, no thrown errors) plus per-resource cardinality (one sample per unique date, one funnel sample per `(date, step)`, one retention sample per `(cohort, period)`).
