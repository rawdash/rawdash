# @rawdash/connector-linear

Rawdash connector for [Linear](https://linear.app) — syncs teams, users, cycles, and issues (plus state-transition events derived from each issue's history) into the six-shape storage model.

## Auth setup

The MVP uses a Linear **Personal API Key**:

1. Sign in to Linear and open **Settings → API → Personal API keys**.
2. Click **Create new** and give it a name like `rawdash`.
3. Copy the key (starts with `lin_api_…`). Linear shows it only once.

Personal API keys inherit the scopes of the user who created them. The connector only issues read queries, but use an account with appropriate visibility into the teams you want to sync.

OAuth-based auth is planned post-MVP — see the connector roadmap for details.

## Configuration

```ts
import { secret } from '@rawdash/core';

const linear = {
  name: 'linear',
  connectorId: 'linear',
  config: {
    apiKey: secret('LINEAR_API_KEY'),
    // teamIds: ['team-uuid'],     // optional — restrict to one or more teams
    // resources: ['issues'],       // optional — defaults to all four phases
    // historyPerIssue: 25,         // optional — how many history entries to fetch per issue
  },
};
```

Register the connector class when mounting the engine:

```ts
import { LinearConnector } from '@rawdash/connector-linear';
import { mountEngine } from '@rawdash/hono';

mountEngine(config, { connectorRegistry: { linear: LinearConnector } });
```

### Choosing resources

The connector exposes four sync phases, run in order:

`teams`, `users`, `cycles`, `issues`

Pass any non-empty subset as `resources` to sync only those phases. The `issues` phase also emits `linear_issue_state_change` events.

### Example dashboard

```ts
import { defineConfig, defineDashboard, defineMetric } from '@rawdash/core';

export default defineConfig({
  connectors: [linear],
  dashboards: {
    engineering: defineDashboard({
      widgets: {
        open_issues: {
          kind: 'stat',
          title: 'Open issues',
          metric: defineMetric({
            connector: linear,
            shape: 'entity',
            entityType: 'linear_issue',
            fn: 'count',
            filter: [
              { field: 'stateType', op: 'in', value: ['unstarted', 'started'] },
            ],
          }),
        },
        completed_this_week: {
          kind: 'timeseries',
          title: 'Issues completed per day',
          window: '7d',
          metric: defineMetric({
            connector: linear,
            shape: 'event',
            name: 'linear_issue_state_change',
            fn: 'count',
            window: '7d',
            filter: [{ field: 'toStateName', op: 'eq', value: 'Done' }],
            groupBy: { field: 'start_ts', granularity: 'day' },
          }),
        },
        issues_by_priority: {
          kind: 'distribution',
          title: 'Issues by priority',
          metric: defineMetric({
            connector: linear,
            shape: 'entity',
            entityType: 'linear_issue',
            fn: 'count',
            groupBy: { field: 'priority' },
          }),
        },
      },
    }),
  },
});
```

## Data model

| Storage shape | Entity/event type           | Key attributes                                                                                                                                                      |
| ------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| entity        | `linear_team`               | name, key, createdAt                                                                                                                                                |
| entity        | `linear_user`               | name, email, displayName, active, createdAt                                                                                                                         |
| entity        | `linear_cycle`              | number, name, teamId, startsAt, endsAt, completedAt, progress, scope, completedScope                                                                                |
| entity        | `linear_issue`              | identifier, title, stateId, stateName, stateType, priority, assigneeId, teamId, projectId, cycleId, labels, estimate, createdAt, completedAt, canceledAt, startedAt |
| event         | `linear_issue_state_change` | historyId, issueId, issueIdentifier, teamId, actorId, fromStateId, fromStateName, toStateId, toStateName                                                            |

Timestamps are stored as Unix epoch milliseconds. `linear_issue_state_change` events are derived from the `history(first: N)` window on each issue — only entries with a non-null `fromState` and `toState` (and where they differ) become events.

## Schemas

`LinearConnector.schemas` declares the Zod schema for each resource's raw GraphQL node shape. Used by the cloud shape-drift pipeline to populate `connector_baselines`, and by the package's property tests.

| Resource | Represents                                              |
| -------- | ------------------------------------------------------- |
| `teams`  | `teams(...)` connection nodes                           |
| `users`  | `users(...)` connection nodes                           |
| `cycles` | `cycles(...)` connection nodes                          |
| `issues` | `issues(...)` connection nodes (incl. nested `history`) |

## Sync behaviour

- **Backfill** (`mode: 'full'`): paginates each phase via Linear's `after`/`endCursor` GraphQL connection (page size 50). Issue and event scopes are cleared at the start of their phase so deletions in Linear converge.
- **Incremental** (`mode: 'latest'`): applies an `updatedAt > since` GraphQL filter on each connection, fetching only records that have changed since the last sync. Append-only state-transition events derived from issue history will accumulate over consecutive incremental syncs.
- **Rate limits**: Linear sends `X-RateLimit-Requests-Remaining` / `X-RateLimit-Requests-Reset` on every response — the connector reports the parsed state back to the host via the shared rate-limit policy so the engine can budget future requests.
- **Resumable**: every phase yields a `(phase, endCursor)` cursor — if the host aborts the sync, the next invocation picks up at the same page.

## Out of scope (post-MVP)

- Linear OAuth (currently API key only).
- Webhooks for live updates (Team-tier feature).
- Roadmap / Initiative resources (open a ticket if you need them).

## Registering in the MCP server

```ts
import { LinearConnector, configFields } from '@rawdash/connector-linear';

createMcpServer({
  // ...
  connectorFactories: [
    {
      id: 'linear',
      configFields,
      create: LinearConnector.create,
    },
  ],
});
```

## Property tests

Resources in this connector have fast-check property tests under `src/property.test.ts` that:

1. Generate N≥50 synthetic API payloads from a Zod schema mirroring the upstream API response.
2. Pipe them through `connector.sync()` against an `InMemoryStorage` instance.
3. Assert universal invariants — non-empty entity ids, finite event timestamps, no `undefined` leaking into storage, no thrown errors on any valid input — plus per-resource counts.

The helper lives in `@rawdash/connector-test-utils`. When adding a new resource, add a Zod schema for its payload and a test wired up via `runPropertySyncTest`.
