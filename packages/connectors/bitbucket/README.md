<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-bitbucket

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-bitbucket)](https://www.npmjs.com/package/@rawdash/connector-bitbucket)
[![license](https://img.shields.io/npm/l/@rawdash/connector-bitbucket)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync pull requests, pipelines, and pipeline lifecycle events from Bitbucket Cloud repositories.

## Install

```sh
npm install @rawdash/connector-bitbucket
```

## Authentication

Authenticates over HTTP Basic auth using an Atlassian account email as the username and an Atlassian API token as the password. The token grants access to the workspaces, repositories, and pipelines the account can already read.

1. Open https://id.atlassian.com/manage-profile/security/api-tokens and create an API token for your Atlassian account. If you create a scoped token, include read access to repositories and pipelines.
2. Store the token as a secret and reference it from the connector config as `apiToken: secret("BITBUCKET_API_TOKEN")`.
3. Set `email` to the Atlassian account email that owns the token, alongside your `workspace` and the list of `repoSlugs` to sync.

## Configuration

| Field       | Type   | Required | Description                                                                                                                                                                                            |
| ----------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `workspace` | string | Yes      | Bitbucket Cloud workspace slug (the segment shown in repo URLs after bitbucket.org/).                                                                                                                  |
| `email`     | string | Yes      | Email address of the Atlassian account that owns the API token. Used as the Basic auth username.                                                                                                       |
| `apiToken`  | secret | Yes      | Atlassian API token for the account, granting read access to the workspace repositories and pipelines you want to sync. Create one at https://id.atlassian.com/manage-profile/security/api-tokens.     |
| `repoSlugs` | array  | Yes      | Repositories to sync, named by their slug within the workspace (no `workspace/` prefix).                                                                                                               |
| `resources` | array  | No       | Which Bitbucket resources to sync. Omit to sync all of them. 'pipeline_event' rides the 'pipeline' phase - enabling it without 'pipeline' still fetches pipelines but skips writing pipeline entities. |

## Resources

- **`pull_request`** _(entity)_ - Open, merged, declined, and superseded pull requests with author, source/target branches, and close timestamp.
  - Endpoint: `GET /2.0/repositories/{workspace}/{repo_slug}/pullrequests?state=OPEN&state=MERGED&state=DECLINED&state=SUPERSEDED`
  - Paginated newest-first by `updated_on`; the connector stops once a page is entirely older than `options.since`.
- **`pipeline`** _(entity)_ - Bitbucket Pipelines runs with state, result, target ref/commit, trigger, duration, and create/complete timestamps.
  - Endpoint: `GET /2.0/repositories/{workspace}/{repo_slug}/pipelines/`
  - Paginated newest-first by `created_on`; the connector stops once a page is entirely older than `options.since`.
- **`pipeline_event`** _(event)_ - Pipeline lifecycle events. One event per pipeline covering created_on to completed_on (or updated_on if not yet finished), tagged with the terminal state and result.
  - Endpoint: `GET /2.0/repositories/{workspace}/{repo_slug}/pipelines/`
  - Derived from the same pipelines response that builds the `pipeline` resource; the Bitbucket API does not expose an intermediate state-transition history endpoint.

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const bitbucket = {
  name: 'bitbucket',
  connectorId: 'bitbucket',
  config: {
    workspace: 'my-workspace',
    email: 'jane@example.com',
    apiToken: secret('BITBUCKET_API_TOKEN'),
    repoSlugs: ['my-repo'],
  },
};

export default defineConfig({
  connectors: [bitbucket],
  dashboards: {
    engineering: defineDashboard({
      widgets: {
        open_pull_requests: {
          kind: 'stat',
          title: 'Open PRs',
          metric: defineMetric({
            connector: bitbucket,
            shape: 'entity',
            entityType: 'pull_request',
            fn: 'count',
            filter: [{ field: 'state', op: 'eq', value: 'OPEN' }],
          }),
        },
      },
    }),
  },
});
```

## Rate limits

Bitbucket Cloud applies hourly per-IP and per-user limits (around 1,000 requests/hour for API-token Basic auth). Pagination uses a `next` URL in each response and a configurable `pagelen` (capped at 50 here).

## Limitations

- Bitbucket Server / Data Center are out of scope; this connector targets Bitbucket Cloud only.
- Pipeline state-transition events are synthesized: one `pipeline_event` is emitted per pipeline lifecycle (created_on to completed_on/updated_on), not one per intermediate state change.
- Repository discovery is not automatic - configure each repository slug explicitly via `repoSlugs`.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors)
- [Atlassian API docs](https://developer.atlassian.com/cloud/bitbucket/rest/intro/)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
