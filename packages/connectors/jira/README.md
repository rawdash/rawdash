# @rawdash/connector-jira

Rawdash connector for [Jira Cloud](https://www.atlassian.com/software/jira) — syncs issues, issue status-change events, sprints, projects, and users into the six-shape storage model. Extends the engineering vertical beyond Linear-native shops.

> **Cloud only.** This connector targets the Jira Cloud REST API v3 and Agile API. Jira Data Center / Server are out of scope for v1.

## Auth setup

The connector authenticates with **Basic auth** using an Atlassian account email and an API token (Atlassian Cloud's recommended pattern for server-to-server access).

1. Sign in to [id.atlassian.com](https://id.atlassian.com) with the account that should own the integration (a service account is recommended so the sync survives staff changes).
2. Go to **Security → API tokens → Create API token**.
3. Give it a label (e.g. `rawdash`) and copy the token — you won't see it again.
4. Store the token wherever your rawdash deployment resolves secrets from (e.g. the `JIRA_API_TOKEN` env var).

The account only needs read access (Browse Projects permission) to the projects you want to sync. No webhook or app installation is required.

> The token's permissions cap what the connector can see. To sync sprints you also need the account to have access to the relevant Scrum boards.

## Configuration

```ts
import { secret } from '@rawdash/core';

const jira = {
  name: 'jira',
  connectorId: 'jira',
  config: {
    email: 'bot@yourorg.com',
    apiToken: secret('JIRA_API_TOKEN'),
    host: 'yourorg.atlassian.net', // no protocol, no trailing slash
    // projectKeys: ['ENG', 'OPS'],                 // optional — restrict to specific project keys
    // resources: ['issues', 'issue_events'],        // optional — defaults to all five
    // storyPointsField: 'customfield_10016',        // optional — story points custom field id
    // sprintField: 'customfield_10020',             // optional — sprint custom field id
  },
};
```

Register the connector class when mounting the engine:

```ts
import { JiraConnector } from '@rawdash/connector-jira';
import { mountEngine } from '@rawdash/hono';

mountEngine(config, { connectorRegistry: { jira: JiraConnector } });
```

### Custom field IDs vary per site

Story points and the sprint association live on **custom fields** whose IDs differ between Jira sites. The defaults (`customfield_10016` for story points, `customfield_10020` for sprint) match most company-managed Scrum projects, but if your numbers come up empty, find the right IDs at **`https://<host>/rest/api/3/field`** and set `storyPointsField` / `sprintField`.

### Choosing resources

The connector exposes five resources, written across four internal sync phases:

| Resource       | Phase    | What gets written                                                                      |
| -------------- | -------- | -------------------------------------------------------------------------------------- |
| `projects`     | projects | `jira_project` entities, one per project                                               |
| `users`        | users    | `jira_user` entities, one per Atlassian account                                        |
| `sprints`      | sprints  | `jira_sprint` entities, one per sprint across every Scrum board the account can see    |
| `issues`       | issues   | `jira_issue` entities, one per issue                                                   |
| `issue_events` | issues   | `jira_issue_status_change` events, one per status transition in each issue's changelog |

`issue_events` shares the `issues` phase because the events are derived from the changelog returned alongside each issue (`expand=changelog`). Enabling `issue_events` without `issues` still runs the issue search (so the events have data) but skips writing the issue entities themselves.

### Example dashboard

```ts
import { defineConfig, defineDashboard, defineMetric } from '@rawdash/core';

export default defineConfig({
  connectors: [jira],
  dashboards: {
    delivery: defineDashboard({
      widgets: {
        completed_7d: {
          kind: 'stat',
          title: 'Issues completed (7d)',
          metric: defineMetric({
            connector: jira,
            shape: 'event',
            name: 'jira_issue_status_change',
            field: 'start_ts',
            fn: 'count',
            window: '7d',
            filter: [{ field: 'toStatus', op: 'eq', value: 'Done' }],
          }),
        },
        issues_by_status: {
          kind: 'distribution',
          title: 'Open issues by status',
          metric: defineMetric({
            connector: jira,
            shape: 'entity',
            type: 'jira_issue',
            fn: 'count',
            groupBy: { field: 'statusName' },
          }),
        },
        transitions_per_day: {
          kind: 'timeseries',
          title: 'Status transitions per day',
          window: '14d',
          metric: defineMetric({
            connector: jira,
            shape: 'event',
            name: 'jira_issue_status_change',
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

| Storage shape | Entity/event type          | Key attributes                                                                                                                                  |
| ------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| entity        | `jira_project`             | key, name, projectTypeKey, leadAccountId, leadDisplayName                                                                                       |
| entity        | `jira_user`                | displayName, emailAddress, accountType, active                                                                                                  |
| entity        | `jira_sprint`              | name, state, boardId, originBoardId, startDate, endDate, completeDate                                                                           |
| entity        | `jira_issue`               | key, summary, statusName, statusCategory, priority, issueType, assigneeId, reporterId, projectKey, sprintId, storyPoints, createdAt, resolvedAt |
| event         | `jira_issue_status_change` | historyId, issueId, issueKey, projectKey, authorId, fromStatus, toStatus. `start_ts` = changelog entry time, `end_ts` = null.                   |

Timestamps are stored as Unix epoch milliseconds. `sprintId` is taken from the most recent sprint on the issue's sprint custom field. `jira_project` / `jira_user` have no source-side update timestamp, so their `updated_at` is the sync time.

## Schemas

`JiraConnector.schemas` declares the Zod schema for each resource's raw API response. Used by the cloud shape-drift pipeline to populate `connector_baselines`, and by the package's property tests.

| Resource   | Represents                                     |
| ---------- | ---------------------------------------------- |
| `projects` | `GET /rest/api/3/project/search` page          |
| `users`    | `GET /rest/api/3/users/search` page            |
| `sprints`  | `GET /rest/agile/1.0/board/{id}/sprint` values |
| `issues`   | `GET /rest/api/3/search/jql` page              |

## Sync behaviour

- **Backfill** (`mode: 'full'`): paginates each phase and clears the phase's entity/event scope on the first page so deletions in Jira converge.
  - **projects** — `GET /rest/api/3/project/search?expand=lead`, `startAt` pagination via the response's `isLast` flag.
  - **users** — `GET /rest/api/3/users/search`, `startAt` pagination (terminates when a short page is returned).
  - **sprints** — lists Scrum boards via `GET /rest/agile/1.0/board`, then pulls each board's sprints from `GET /rest/agile/1.0/board/{id}/sprint`. Non-Scrum boards (kanban) are skipped because they don't support sprints.
  - **issues** — `GET /rest/api/3/search/jql` with `expand=changelog`, paginated via the response's `nextPageToken`.
- **Incremental** (`mode: 'latest'`): the issues query adds a `updated >= "<UTC yyyy-MM-dd HH:mm>"` JQL clause so only issues changed since the last sync are pulled, ordered by `updated ASC`. Changelog entries at or before the `since` cutoff are dropped so status-change events aren't re-emitted. Projects, users, and sprints are small, so they are fully refreshed on every sync.
- **Rate limits**: Jira applies cost-based rate limiting and returns `429` with a `Retry-After` header — the shared HTTP client surfaces these as `RateLimitError` and the host backs off.
- **Resumable**: every paginated phase yields a `{ phase, page }` cursor (`ChunkedSyncCursor`). For `startAt`-based phases `page` is the numeric offset; for issues it is the opaque `nextPageToken`.

## Errors

`@rawdash/connector-shared` maps Jira's HTTP responses to typed errors automatically:

- `401` / `403` → `AuthError` — host stops syncing until the credentials are replaced.
- `429` → `RateLimitError` — host backs off and reschedules.
- `5xx` → `TransientError` — host retries on the next tick.

## Out of scope (post-v0.1)

- **Jira Data Center / Server** — Cloud only for v1.
- **Confluence** — a separate connector if needed.
- **Worklogs / time tracking** — not dashboard-shaped for the initial release.

## Property tests

Resources in this connector have fast-check property tests under `src/property.test.ts` that:

1. Generate synthetic API payloads from a Zod schema mirroring Jira's response shape.
2. Pipe them through `connector.sync()` against an `InMemoryStorage` instance.
3. Assert universal invariants — non-empty entity ids, finite event timestamps, no `undefined` reaching storage, no thrown errors on any valid input — plus per-resource counts.

The helper lives in `@rawdash/connector-test-utils`. When adding a new resource, add a Zod schema for its payload and a test wired up via `runPropertySyncTest`.
