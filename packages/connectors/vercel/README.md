# @rawdash/connector-vercel

Rawdash connector for [Vercel](https://vercel.com) — syncs projects, deployments, and deployment state-transition events into the six-shape storage model. Pairs with `@rawdash/connector-github` for "is this deploy healthy" widgets.

## Auth setup

The connector authenticates with a Vercel access token. Two flavours work:

- **Personal access token** (recommended for single-user installs): Vercel → **Account Settings → Tokens → Create**. Scope it to the team you want to sync, or leave it user-scoped.
- **Team access token**: Vercel → **Team Settings → Security → Tokens → Create**. You must set `teamId` in the config for the token to read team resources.

The token only needs read permissions for projects and deployments. No webhook configuration is required.

## Configuration

```ts
import { secret } from '@rawdash/core';

const vercel = {
  name: 'vercel',
  connectorId: 'vercel',
  config: {
    apiToken: secret('VERCEL_API_TOKEN'),
    // teamId: 'team_abc123',                       // optional — needed for team tokens
    // projects: ['prj_one', 'prj_two'],            // optional — restrict deployments to specific projects
    // resources: ['projects', 'deployments'],      // optional — defaults to all three
    // deploymentsLookbackDays: 30,                 // optional — backfill window for full sync (default 30)
  },
};
```

Register the connector class when mounting the engine:

```ts
import { VercelConnector } from '@rawdash/connector-vercel';
import { mountEngine } from '@rawdash/hono';

mountEngine(config, { connectorRegistry: { vercel: VercelConnector } });
```

### Choosing resources

The connector exposes three resources, written across two internal sync phases:

| Resource            | Phase       | What gets written                                                                                        |
| ------------------- | ----------- | -------------------------------------------------------------------------------------------------------- |
| `projects`          | projects    | `vercel_project` entities, one per Vercel project                                                        |
| `deployments`       | deployments | `vercel_deployment` entities, one per deployment, with build duration and git ref attributes             |
| `deployment_events` | deployments | `vercel_deployment_event` events, one per deployment with `start_ts=createdAt`, `end_ts=ready` (or null) |

`deployment_events` shares the `deployments` phase because each event is derived from the same payload as its parent deployment entity. Enabling `deployment_events` without `deployments` still runs the deployments query (so the events have data to emit) but skips writing the deployment entities themselves.

### Example dashboard

```ts
import { defineConfig, defineDashboard, defineMetric } from '@rawdash/core';

export default defineConfig({
  connectors: [vercel],
  dashboards: {
    deploys: defineDashboard({
      widgets: {
        deploys_today: {
          kind: 'stat',
          title: 'Deploys today',
          metric: defineMetric({
            connector: vercel,
            shape: 'event',
            name: 'vercel_deployment_event',
            field: 'start_ts',
            fn: 'count',
            window: '24h',
          }),
        },
        deploy_failure_rate_7d: {
          kind: 'stat',
          title: 'Failure rate (7d)',
          metric: defineMetric({
            connector: vercel,
            shape: 'event',
            name: 'vercel_deployment_event',
            field: 'start_ts',
            fn: 'count',
            window: '7d',
            filter: [{ field: 'state', op: 'eq', value: 'ERROR' }],
          }),
        },
        deploys_by_project: {
          kind: 'distribution',
          title: 'Deploys by project',
          metric: defineMetric({
            connector: vercel,
            shape: 'event',
            name: 'vercel_deployment_event',
            fn: 'count',
            window: '7d',
            groupBy: { field: 'projectId' },
          }),
        },
        deploys_per_day: {
          kind: 'timeseries',
          title: 'Daily deploys',
          window: '14d',
          metric: defineMetric({
            connector: vercel,
            shape: 'event',
            name: 'vercel_deployment_event',
            field: 'start_ts',
            fn: 'count',
            window: '14d',
            groupBy: { field: 'start_ts', granularity: 'day' },
          }),
        },
      },
    }),
  },
});
```

## Data model

| Storage shape | Entity/event type         | Key attributes                                                                                                                                          |
| ------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| entity        | `vercel_project`          | name, framework, accountId, createdAt, updatedAt                                                                                                        |
| entity        | `vercel_deployment`       | deploymentId, name, url, state, target, projectId, creatorUid, creatorUsername, source, gitRef, gitSha, createdAt, buildingAt, readyAt, buildDurationMs |
| event         | `vercel_deployment_event` | same attribute set as `vercel_deployment`. `start_ts = createdAt`, `end_ts = ready` (or `null` for in-flight builds).                                   |

Timestamps are stored as Unix epoch milliseconds. `buildDurationMs` is computed as `ready - buildingAt` when both are present, otherwise `null`. The `gitRef` attribute prefers `meta.githubCommitRef`, falling back to `gitlabCommitRef`, `bitbucketCommitRef`, then `meta.branch`.

## Schemas

`VercelConnector.schemas` declares the Zod schema for each resource's raw API response. Used by the cloud shape-drift pipeline to populate `connector_baselines`, and by the package's property tests.

| Resource      | Represents                 |
| ------------- | -------------------------- |
| `projects`    | `GET /v9/projects` page    |
| `deployments` | `GET /v6/deployments` page |

## Sync behaviour

- **Backfill** (`mode: 'full'`): paginates `/v9/projects` and `/v6/deployments` via Vercel's `pagination.next` cursor (page size 100), passing the returned millisecond timestamp back as the `until` query param. Project and deployment entity scopes (plus the `vercel_deployment_event` event scope) are cleared at the start of their phase so deletions in Vercel converge. Deployments are bounded by `deploymentsLookbackDays` (default 30) — the connector sets `since` on the first page to cap the backfill window.
- **Incremental** (`mode: 'latest'`): applies `since={ms}` to the deployments endpoint so only deployments newer than the last sync are pulled. Projects are still refreshed on every sync since the list is small.
- **Rate limits**: Vercel sends `X-RateLimit-Remaining` and `X-RateLimit-Reset` (Unix seconds) — the connector reports the parsed state back to the host so the engine can budget future requests. 429 responses are surfaced as `RateLimitError` by the shared HTTP client.
- **Resumable**: every paginated phase yields a `{ phase, page }` cursor (`ChunkedSyncCursor<TPhase, TPage>`) where `page` is the sanitized pagination URL. Pagination URLs are validated on the way in — only `https://api.vercel.com/v9/projects` and `https://api.vercel.com/v6/deployments` are accepted — to prevent a malicious or corrupted cursor from steering a follow-up request elsewhere.

## Aggregates

No aggregates yet — `count` / `latest` widgets fall back to evaluating against synced storage rows. Tracking as a follow-up: Vercel's `/v6/deployments?limit=1&state=READY` could serve `count(vercel_deployment, filter)` plus `latest(vercel_deployment, ...)` directly, since the deployments list response carries `pagination.count` and an ordered first row.

## Errors

`@rawdash/connector-shared` maps Vercel's HTTP responses to typed errors automatically:

- `401` / `403` → `AuthError` — host stops syncing until the token is replaced.
- `429` → `RateLimitError` — host backs off and reschedules.
- `5xx` → `TransientError` — host retries on the next tick.

## Out of scope (post-v0.1)

- **Web Vitals / Speed Insights** — Vercel does not expose aggregated p75 metrics via the public REST API; the dashboard surface and Insights API require a different access pattern (per-page-view event ingest). Tracking as a follow-up.
- **Edge function logs** — high volume, low signal for a dashboard widget. Use the Vercel log drain integration instead.
- **DNS / Domain APIs** — not dashboard-shaped.

## Registering in the MCP server

```ts
import { VercelConnector, configFields } from '@rawdash/connector-vercel';

createMcpServer({
  // ...
  connectorFactories: [
    {
      id: 'vercel',
      configFields,
      create: VercelConnector.create,
    },
  ],
});
```

## Property tests

Resources in this connector have fast-check property tests under `src/property.test.ts` that:

1. Generate synthetic API payloads from a Zod schema mirroring Vercel's response shape.
2. Pipe them through `connector.sync()` against an `InMemoryStorage` instance.
3. Assert universal invariants — non-empty entity ids, finite event timestamps, no `undefined` reaching storage, no thrown errors on any valid input — plus per-resource counts.

The helper lives in `@rawdash/connector-test-utils`. When adding a new resource, add a Zod schema for its payload and a test wired up via `runPropertySyncTest`.
