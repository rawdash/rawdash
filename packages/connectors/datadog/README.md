# @rawdash/connector-datadog

Rawdash connector for [Datadog](https://www.datadoghq.com/) — syncs monitors, monitor state transitions, incidents, SLOs, and user-declared metric timeseries into the six-shape storage model.

## Auth setup

Datadog REST endpoints require **both** an API key and an Application key:

1. **API key** — Datadog → **Organization Settings → API Keys → New Key**. Name it (e.g. `rawdash`) and copy the value.
2. **Application key** — Datadog → **Organization Settings → Application Keys → New Key**. Application keys are bound to the user who creates them; pick a service user with a scope that covers everything you want to read (Monitors, Incidents, SLOs).
3. Store both in your environment (`DD_API_KEY` and `DD_APP_KEY`), then reference them via `secret()`.

You'll also need your **site host**. If you sign in at `app.datadoghq.com`, your site is `datadoghq.com`. EU customers use `datadoghq.eu`; US3 uses `us3.datadoghq.com`. The connector targets `https://api.<site>` for every request.

The connector authenticates by sending the keys as the `DD-API-KEY` and `DD-APPLICATION-KEY` HTTP headers on every request, per Datadog's published convention.

## Configuration

```ts
import { secret } from '@rawdash/core';

const datadog = {
  name: 'datadog',
  connectorId: 'datadog',
  config: {
    apiKey: secret('DD_API_KEY'),
    appKey: secret('DD_APP_KEY'),
    // site: 'datadoghq.com',                   // optional — defaults to 'datadoghq.com'
    // resources: ['monitors', 'incidents'],    // optional — defaults to all of them
    // metricsLookbackHours: 24,                // optional — defaults to 24
    metricQueries: [
      { name: 'cpu_user', query: 'avg:system.cpu.user{*}', interval: '1h' },
      { name: 'p95_latency', query: 'p95:trace.web.request.duration{*}' },
    ],
  },
};
```

Register the connector class when mounting the engine:

```ts
import { DatadogConnector } from '@rawdash/connector-datadog';
import { mountEngine } from '@rawdash/hono';

mountEngine(config, { connectorRegistry: { datadog: DatadogConnector } });
```

### Choosing resources

The connector exposes five resources, written across four internal sync phases:

| Resource         | Phase     | What gets written                                                                                                   |
| ---------------- | --------- | ------------------------------------------------------------------------------------------------------------------- |
| `monitors`       | monitors  | `datadog_monitor` entities, one per Datadog monitor                                                                 |
| `monitor_events` | monitors  | `datadog_monitor_event` events, emitted when a monitor's `status` changes from its previously-stored value          |
| `incidents`      | incidents | `datadog_incident` entities, cursor-paginated                                                                       |
| `slos`           | slos      | `datadog_slo` entities + `datadog_slo_sli` metric samples (one per (slo, indexed_at) in the SLO's `overall_status`) |
| `metric_queries` | metrics   | `datadog_metric.<name>` metric samples for each declared query                                                      |

`monitor_events` shares the `monitors` phase because each event is diffed against the parent monitor. Enabling `monitor_events` without `monitors` still runs the monitor search query (so each monitor's prior state can be inspected) but skips writing the standalone monitor entity — internally the connector still upserts the monitor row so the next sync's diff has a baseline.

### Example dashboard

```ts
import { defineConfig, defineDashboard, defineMetric } from '@rawdash/core';

export default defineConfig({
  connectors: [datadog],
  dashboards: {
    ops: defineDashboard({
      widgets: {
        alerting_monitors: {
          kind: 'stat',
          title: 'Monitors in alert',
          metric: defineMetric({
            connector: datadog,
            shape: 'entity',
            entityType: 'datadog_monitor',
            fn: 'count',
            filter: [{ field: 'status', op: 'eq', value: 'Alert' }],
          }),
        },
        open_incidents: {
          kind: 'stat',
          title: 'Open incidents',
          metric: defineMetric({
            connector: datadog,
            shape: 'entity',
            entityType: 'datadog_incident',
            fn: 'count',
            filter: [{ field: 'state', op: 'neq', value: 'resolved' }],
          }),
        },
        cpu_user: {
          kind: 'timeseries',
          title: 'CPU user (avg)',
          window: '24h',
          metric: defineMetric({
            connector: datadog,
            shape: 'metric',
            name: 'datadog_metric.cpu_user',
            fn: 'avg',
            window: '24h',
            groupBy: { field: 'ts', granularity: 'hour' },
          }),
        },
      },
    }),
  },
});
```

## Data model

| Storage shape | Entity/event/metric type | Key attributes                                                                                                      |
| ------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| entity        | `datadog_monitor`        | monitorId, name, monitorType, status, priority, tags, createdAt, modifiedAt, stateModifiedAt                        |
| event         | `datadog_monitor_event`  | monitorId, name, monitorType, fromStatus, toStatus, priority, tags                                                  |
| entity        | `datadog_incident`       | incidentId, title, severity, state, customerImpactScope, createdAt, modifiedAt, resolvedAt                          |
| entity        | `datadog_slo`            | sloId, name, sloType, thresholds, target, latestSliValue, createdAt, modifiedAt                                     |
| metric        | `datadog_slo_sli`        | value = the SLI percentage from the SLO's `overall_status[].sli_value`; attributes = `{ sloId, sloType }`           |
| metric        | `datadog_metric.<name>`  | value = the query's evaluated point; attributes = `{ queryName, query, tags }`; one sample per (series, time) tuple |

Timestamps are stored as Unix epoch milliseconds. The Datadog API returns timestamps in mixed formats (ISO strings for monitors/incidents, Unix seconds for SLOs, Unix milliseconds for metric timeseries) — the connector normalizes them all to milliseconds via `parseEpoch`.

## Schemas

`DatadogConnector.schemas` declares the Zod schema for each resource's raw API response. Used by the cloud shape-drift pipeline to populate `connector_baselines`, and by the package's property tests.

| Resource         | Represents                                                           |
| ---------------- | -------------------------------------------------------------------- |
| `monitors`       | `GET /api/v1/monitor/search` page                                    |
| `incidents`      | `GET /api/v2/incidents` page                                         |
| `slos`           | `GET /api/v1/slo` response                                           |
| `metric_queries` | `POST /api/v2/query/timeseries` response (per declared metric query) |

## Sync behaviour

- **Backfill** (`mode: 'full'`): pages the monitor search by `page` / `page_count`, pages incidents by `next_offset`, fetches all SLOs in one call, and POSTs once per declared metric query to `/api/v2/query/timeseries`. Incident, SLO, and metric scopes are cleared at the start of their phase; **monitor entities are intentionally not cleared** because the next-sync `monitor_event` diff depends on the prior status being stored.
- **Incremental** (`mode: 'latest'`): applies `filter[created.from]={since}` to incidents and `from={since}` to metric queries. Monitors and SLOs are small lists and refresh fully on every sync.
- **Rate limits**: Datadog sends `X-RateLimit-Remaining` and `X-RateLimit-Reset` headers on most endpoints — the connector reports the parsed state back to the host via `standardRateLimitPolicy` so the engine can budget future requests. 429 responses are surfaced as `RateLimitError` by the shared HTTP client.
- **Resumable**: every paginated phase yields a `(phase, pageUrl)` cursor. Pagination URLs are sanitized on the way in — only `https://api.<site>/...` matching the expected path is accepted — to prevent a malicious or corrupted cursor from steering a follow-up request elsewhere.

## Errors

`@rawdash/connector-shared` maps Datadog's HTTP responses to typed errors automatically:

- `401` / `403` → `AuthError` — host stops syncing until the key is replaced.
- `429` → `RateLimitError` — host backs off and reschedules.
- `5xx` → `TransientError` — host retries on the next tick.

## Out of scope (post-MVP)

- Logs and RUM session data — high volume; tracked as follow-ups on RAW-176.
- Synthetic monitor results — tracked as follow-up.
- Custom dashboards / notebooks — surfaced as Datadog UI links rather than synced state.

## Registering in the MCP server

```ts
import { DatadogConnector, configFields } from '@rawdash/connector-datadog';

createMcpServer({
  // ...
  connectorFactories: [
    {
      id: 'datadog',
      configFields,
      create: DatadogConnector.create,
    },
  ],
});
```

## Property tests

Resources in this connector have fast-check property tests under `src/property.test.ts` that:

1. Generate synthetic API payloads from the resource's Zod schema.
2. Pipe them through `connector.sync()` against an `InMemoryStorage` instance.
3. Assert universal invariants — non-empty entity ids, finite event timestamps, no `undefined` reaching storage, no thrown errors on any valid input — plus a per-resource uniqueness count.
