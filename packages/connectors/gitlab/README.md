<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-gitlab

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-gitlab)](https://www.npmjs.com/package/@rawdash/connector-gitlab)
[![license](https://img.shields.io/npm/l/@rawdash/connector-gitlab)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync projects, merge requests, pipelines, issues, and releases from GitLab.com or a self-hosted GitLab instance.

## Install

```sh
npm install @rawdash/connector-gitlab
```

## Authentication

A GitLab Personal Access Token (PAT) with the `read_api` scope is required. The PAT must belong to an account with read access to the projects and groups you want to sync. Self-hosted GitLab is supported by overriding the `host` field.

1. Open GitLab -> User Preferences -> Access Tokens (or the equivalent on your self-hosted instance).
2. Create a Personal Access Token with the `read_api` scope.
3. Store it as a secret and reference it from the connector config as `apiToken: secret("GITLAB_API_TOKEN")`.
4. Set `projectIds` to a list of numeric project IDs, or `groupIds` to a list of numeric group IDs (or both). At least one must be set.
5. For self-hosted GitLab, set `host` to your instance hostname (no protocol or path), e.g. `gitlab.example.com`.

## Configuration

| Field        | Type   | Required | Description                                                                                                                                                                                         |
| ------------ | ------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apiToken`   | secret | Yes      | GitLab Personal Access Token with `read_api` scope. Create one at GitLab -> Preferences -> Access Tokens.                                                                                           |
| `host`       | string | No       | Your GitLab host. Defaults to `gitlab.com`. For self-hosted, supply the hostname only (e.g. `gitlab.example.com`).                                                                                  |
| `projectIds` | array  | No       | Numeric project IDs to sync directly (find one in Project -> Settings -> General). Combined with any projects discovered via `groupIds`.                                                            |
| `groupIds`   | array  | No       | Numeric group IDs whose projects (including subgroups) will be discovered and synced.                                                                                                               |
| `resources`  | array  | No       | Which GitLab resources to sync. Omit to sync all of them. 'pipeline_event' rides the 'pipeline' phase - enabling it without 'pipeline' still fetches pipelines but skips writing pipeline entities. |

## Resources

- **`project`** _(entity)_ - GitLab projects (repositories) with namespace path, default branch, and archived/visibility flags.
  - Endpoint: `GET /api/v4/projects/{id}`
  - Discovered from configured `projectIds` and from `groupIds` via GET /api/v4/groups/{id}/projects?include_subgroups=true.
- **`merge_request`** _(entity)_ - Open, merged, and closed merge requests with author, source/target branches, and merge timestamps.
  - Endpoint: `GET /api/v4/projects/{id}/merge_requests`
- **`pipeline`** _(entity)_ - CI/CD pipelines with status, ref, commit sha, source, duration, and start/finish timestamps.
  - Endpoint: `GET /api/v4/projects/{id}/pipelines`
- **`pipeline_event`** _(event)_ - Pipeline lifecycle events. One event per pipeline covering created_at to finished_at (or updated_at if not yet finished), tagged with the terminal status.
  - Endpoint: `GET /api/v4/projects/{id}/pipelines`
  - Derived from the same pipelines response that builds the `pipeline` resource; the GitLab API does not expose an intermediate state-transition history endpoint.
- **`issue`** _(entity)_ - Open and closed issues with labels, author, assignees, and close timestamp.
  - Endpoint: `GET /api/v4/projects/{id}/issues`
- **`release`** _(entity)_ - Project releases keyed by tag name, including released_at and the publishing author.
  - Endpoint: `GET /api/v4/projects/{id}/releases`

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const gitlab = {
  name: 'gitlab',
  connectorId: 'gitlab',
  config: {
    apiToken: secret('GITLAB_API_TOKEN'),
    host: 'gitlab.com',
    projectIds: [278964],
  },
};

export default defineConfig({
  connectors: [gitlab],
  dashboards: {
    engineering: defineDashboard({
      widgets: {
        open_merge_requests: {
          kind: 'stat',
          title: 'Open MRs',
          metric: defineMetric({
            connector: gitlab,
            shape: 'entity',
            entityType: 'merge_request',
            fn: 'count',
            filter: [{ field: 'state', op: 'eq', value: 'opened' }],
          }),
        },
      },
    }),
  },
});
```

## Rate limits

GitLab returns standard `RateLimit-Remaining` / `RateLimit-Reset` headers (reset is a Unix timestamp in seconds); list pagination uses the Link header (page size 100).

## Limitations

- Container Registry, Packages, and GitLab Duo / AI features are out of scope.
- Pipeline state-transition events are synthesized: one `pipeline_event` is emitted per pipeline lifecycle (created_at to finished_at/updated_at), not one per intermediate state change.
- Group project discovery walks each group with `include_subgroups=true`; very large groups may take multiple sync chunks to enumerate.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors/)
- [GitLab API docs](https://docs.gitlab.com/ee/api/)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
