# @rawdash/connector-sentry

Rawdash connector for [Sentry](https://sentry.io) — syncs issues, per-issue events, releases, and hourly error counts into the six-shape storage model.

## Auth setup

The connector authenticates with a Sentry auth token. Two flavours work; pick whichever fits how you administer Sentry:

- **Internal Integration token** (recommended for org-wide installs): Sentry → **Settings → Custom Integrations → New Internal Integration**. Give it `event:read`, `project:read`, and `org:read` scopes. The integration page surfaces a token starting with `sntrys_`.
- **User Auth Token**: Sentry → **Settings → Account → API → Auth Tokens**. Tied to a specific user — fine for personal use, but rotate it when the user leaves.

You also need your organization **slug** (the segment in your Sentry URL, e.g. `acme` in `https://sentry.io/organizations/acme/`).

## Configuration

```ts
import { SentryConnector } from '@rawdash/connector-sentry';
import { secret } from '@rawdash/core';

const sentry = new SentryConnector(
  {
    organization: 'acme',
    // projects: ['web', 'api'],            // optional — restrict to specific project slugs or IDs
    // resources: ['issues', 'issue_events'], // optional — defaults to all four
    // eventsPerIssueCap: 100,              // optional — max events sampled per issue (default 100)
    // statsLookbackHours: 24,              // optional — hours of hourly stats refreshed per sync (default 24)
  },
  {
    authToken: secret('SENTRY_AUTH_TOKEN'),
  },
);
```

Or via `SentryConnector.create` (validates the input with the `configFields` Zod schema):

```ts
const sentry = SentryConnector.create({
  authToken: { $secret: 'SENTRY_AUTH_TOKEN' },
  organization: 'acme',
  // projects: ['web'],
  // resources: ['issues', 'errors_per_hour'],
});
```

### Choosing resources

The connector exposes four resources, written across three internal sync phases:

| Resource          | Phase       | What gets written                                                                 |
| ----------------- | ----------- | --------------------------------------------------------------------------------- |
| `issues`          | issues      | `sentry_issue` entities, one per Sentry group                                     |
| `issue_events`    | issues      | `sentry_issue_event` events, sampled per issue (`eventsPerIssueCap`, default 100) |
| `releases`        | releases    | `sentry_release` entities                                                         |
| `errors_per_hour` | error_stats | `sentry_errors_per_hour` metric samples, hourly, per project                      |

`issue_events` shares the `issues` phase because each event is fetched against its parent issue. Enabling `issue_events` without `issues` still runs the issues query (so each issue's events can be located) but skips writing the issue entities themselves.

### Example dashboard

```ts
import { defineConfig, defineDashboard, defineMetric } from '@rawdash/core';

export default defineConfig({
  connectors: [{ connector: sentry }],
  dashboards: {
    errors: defineDashboard({
      widgets: {
        unresolved_issues: {
          kind: 'stat',
          title: 'Unresolved issues',
          metric: defineMetric({
            connector: sentry,
            shape: 'entity',
            entityType: 'sentry_issue',
            fn: 'count',
            filter: [{ field: 'status', op: 'eq', value: 'unresolved' }],
          }),
        },
        errors_per_hour: {
          kind: 'timeseries',
          title: 'Errors per hour',
          window: '24h',
          metric: defineMetric({
            connector: sentry,
            shape: 'metric',
            name: 'sentry_errors_per_hour',
            fn: 'sum',
            window: '24h',
            groupBy: { field: 'ts', granularity: 'hour' },
          }),
        },
        issues_by_level: {
          kind: 'distribution',
          title: 'Issues by level',
          metric: defineMetric({
            connector: sentry,
            shape: 'entity',
            entityType: 'sentry_issue',
            fn: 'count',
            groupBy: { field: 'level' },
          }),
        },
      },
    }),
  },
});
```

## Data model

| Storage shape | Entity/event/metric type | Key attributes                                                                                          |
| ------------- | ------------------------ | ------------------------------------------------------------------------------------------------------- |
| entity        | `sentry_issue`           | shortId, title, level, status, firstSeen, lastSeen, count, userCount, projectSlug                       |
| event         | `sentry_issue_event`     | eventId, issueId, issueShortId, projectSlug, level, platform, environment, message                      |
| entity        | `sentry_release`         | version, projects, dateCreated, dateReleased, lastEvent                                                 |
| metric        | `sentry_errors_per_hour` | value = error count for the hour; attributes = `{ project }`; one sample per (project, hour-aligned ts) |

Timestamps are stored as Unix epoch milliseconds. `sentry_issue_event` rows are sampled — the connector fetches at most `eventsPerIssueCap` recent events per issue per sync (Sentry caps a single `/events` page at 100), so the events shape is a representative sample, not a full audit trail.

## Sync behaviour

- **Backfill** (`mode: 'full'`): paginates `/api/0/organizations/{org}/issues/` and `/releases/` via Sentry's Link header (page size 100), respecting `results="true"` to stop cleanly. Issue and release entity scopes (plus the `sentry_issue_event` event scope) are cleared at the start of their phase so deletions in Sentry converge.
- **Incremental** (`mode: 'latest'`): applies `query=lastSeen:>{since}` to the issues endpoint so only issues with new occurrences are pulled. Releases and stats are still refreshed on every sync, since both are small and benefit from a fresh snapshot.
- **Rate limits**: Sentry sends `X-Sentry-Rate-Limit-Remaining` and `X-Sentry-Rate-Limit-Reset` on every response — the connector reports the parsed state back to the host via the shared `sentryRateLimit` policy so the engine can budget future requests. 429 responses are surfaced as `RateLimitError` by the shared HTTP client.
- **Resumable**: every paginated phase yields a `(phase, pageUrl)` cursor. Pagination URLs are sanitized on the way in — only `https://sentry.io/api/0/...` is accepted — to prevent a malicious or corrupted cursor from steering a follow-up request elsewhere.

## Errors

`@rawdash/connector-shared` maps Sentry's HTTP responses to typed errors automatically:

- `401` / `403` → `AuthError` — host stops syncing until the token is replaced.
- `429` → `RateLimitError` — host backs off and reschedules.
- `5xx` → `TransientError` — host retries on the next tick.

## Out of scope (post-MVP)

- Performance / Trace data — high cost, low signal for the launch dashboard set.
- Per-event payloads (stack traces, breadcrumbs) — the connector counts events but does not store their payloads.
- Self-hosted Sentry instances on custom hosts — pagination URLs are pinned to `sentry.io`.

## Registering in the MCP server

```ts
import { SentryConnector, configFields } from '@rawdash/connector-sentry';

createMcpServer({
  // ...
  connectorFactories: [
    {
      id: 'sentry',
      configFields,
      create: SentryConnector.create,
    },
  ],
});
```

## Property tests

Resources in this connector have fast-check property tests under `src/property.test.ts` that:

1. Generate synthetic API payloads from a Zod schema mirroring Sentry's response shape.
2. Pipe them through `connector.sync()` against an `InMemoryStorage` instance.
3. Assert universal invariants — non-empty entity ids, finite event timestamps, no `undefined` reaching storage, no thrown errors on any valid input — plus per-resource counts.

The helper lives in `@rawdash/connector-test-utils`. When adding a new resource, add a Zod schema for its payload and a test wired up via `runPropertySyncTest`.
