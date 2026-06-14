<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-circleci

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-circleci)](https://www.npmjs.com/package/@rawdash/connector-circleci)
[![license](https://img.shields.io/npm/l/@rawdash/connector-circleci)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync CircleCI pipelines, workflows, jobs, and workflow state-transition events so build success rate and duration land on dashboards.

## Install

```sh
npm install @rawdash/connector-circleci
```

## Authentication

A CircleCI personal API token is required. Tokens authenticate against the v2 REST API and inherit the creating user permissions on the configured projects.

1. Open CircleCI -> User Settings -> Personal API Tokens (https://app.circleci.com/settings/user/tokens).
2. Create a token with a descriptive name (e.g. "rawdash sync") and copy the value.
3. Store it as a secret and reference it from the connector config as `apiToken: secret("CIRCLECI_API_TOKEN")`.
4. Set `projectSlugs` to the projects you want to sync, e.g. ['gh/my-org/my-repo'].

## Configuration

| Field                   | Type   | Required | Description                                                                                                                                                                                                                                      |
| ----------------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apiToken`              | secret | Yes      | CircleCI personal API token (read-only is sufficient). Create one at CircleCI -> User Settings -> Personal API Tokens.                                                                                                                           |
| `projectSlugs`          | array  | Yes      | CircleCI project slugs to sync, e.g. 'gh/my-org/my-repo' or 'circleci/<orgId>/<projectId>'.                                                                                                                                                      |
| `branch`                | string | No       | Restrict pipeline sync to a single branch. Omit to sync all branches.                                                                                                                                                                            |
| `resources`             | array  | No       | Which CircleCI resources to sync. Omit to sync pipelines, workflows, and pipeline_events (jobs are off by default because they add a per-workflow API call). Workflows must be fetched whenever workflows, jobs, or pipeline_events are enabled. |
| `pipelinesLookbackDays` | number | No       | How many days back to fetch pipelines on a full sync. Defaults to 30. CircleCI does not expose a server-side since filter, so the connector paginates newest-first and stops once it crosses this window.                                        |

## Resources

- **`circleci_pipeline`** _(entity)_ - CircleCI pipelines with state, trigger, git ref, project slug, and created_at. Pipelines are immutable: CircleCI sets updated_at once at creation (always equal to created_at), so the entity carries only created_at.
  - Endpoint: `GET /api/v2/project/{project_slug}/pipeline`
  - Pipelines are paginated newest-first by created_at; the connector cuts off and watermarks on created_at and stops once it crosses `pipelinesLookbackDays`. A page is only treated as the last when its oldest (final) item crosses the cutoff, so an out-of-order old pipeline mid-page never halts pagination.
- **`circleci_workflow`** _(entity)_ - Workflows belonging to each pipeline, including status, name, and start/stop timestamps. Fetched per pipeline with one extra API call.
  - Endpoint: `GET /api/v2/pipeline/{pipeline_id}/workflow`
- **`circleci_job`** _(entity)_ - Jobs belonging to each workflow, including status, type, and start/stop timestamps. Off by default; enable via `resources` because it adds an API call per workflow.
  - Endpoint: `GET /api/v2/workflow/{workflow_id}/job`
- **`circleci_pipeline_event`** _(event)_ - Each workflow emitted as a time-bounded event spanning its created_at to stopped_at, carrying the same status, project, and pipeline attributes.
  - Endpoint: `GET /api/v2/pipeline/{pipeline_id}/workflow`

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const circleci = {
  name: 'circleci',
  connectorId: 'circleci',
  config: {
    apiToken: secret('CIRCLECI_API_TOKEN'),
    projectSlugs: ['gh/my-org/my-repo'],
    branch: 'main',
    pipelinesLookbackDays: 30,
  },
};

export default defineConfig({
  connectors: [circleci],
  dashboards: {
    engineering: defineDashboard({
      widgets: {
        builds: {
          kind: 'stat',
          title: 'Pipelines run',
          metric: defineMetric({
            connector: circleci,
            shape: 'event',
            name: 'circleci_pipeline_event',
            fn: 'count',
          }),
        },
      },
    }),
  },
});
```

## Rate limits

CircleCI v2 rate-limits per token at roughly 1,000 requests per minute and surfaces the budget via `X-RateLimit-*` response headers (and `Retry-After` on a 429). The shared HTTP layer backs off and retries on 429. The connector paginates pipelines newest-first and fans out one extra request per pipeline for workflows (and one more per workflow for jobs when enabled), so cap `projectSlugs` and `pipelinesLookbackDays` accordingly.

## Limitations

- CircleCI v2 has no server-side since filter for pipelines, so the connector paginates newest-first by `created_at` and stops once it crosses `pipelinesLookbackDays` (default 30).
- CircleCI pipelines are immutable once created: `updated_at` is set at creation and never changes (it always equals `created_at`), and a re-run surfaces as a new pipeline with a new id and `created_at`. The connector therefore cuts off and watermarks on `created_at`; no completed-pipeline updates are lost.
- The `jobs` resource is off by default because it adds an extra API call per workflow. Enable it explicitly in `resources` if you need per-job entities.
- Insights API (pre-aggregated workflow stats) and the self-hosted CircleCI Server are out of scope for v1.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors)
- [CircleCI API docs](https://circleci.com/docs/api/v2/)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
