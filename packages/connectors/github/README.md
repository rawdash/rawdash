<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-github

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-github)](https://www.npmjs.com/package/@rawdash/connector-github)
[![license](https://img.shields.io/npm/l/@rawdash/connector-github)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync pull requests, issues, deployments, releases, CI runs, and contributor activity from a GitHub repository.

## Install

```sh
npm install @rawdash/connector-github
```

## Authentication

A personal access token is optional for public repositories but required for private repos and to avoid the low unauthenticated rate limit.

1. Open GitHub → Settings → Developer settings → Personal access tokens.
2. Generate a token with the `repo` scope (read access is sufficient).
3. Store it as a secret and reference it from the connector config as `token: secret("GITHUB_TOKEN")`.

## Configuration

| Field   | Type   | Required | Description                           |
| ------- | ------ | -------- | ------------------------------------- |
| `owner` | string | Yes      | GitHub username or organization name. |
| `repo`  | string | Yes      | Repository name.                      |
| `token` | secret | No       | GitHub PAT with `repo` scope.         |

## Resources

- **`repo`** _(entity)_ - Top-level repository stats (stars, forks, and watchers) as a single entity.
  - Endpoint: `GET /repos/{owner}/{repo}`
- **`workflow_run`** _(event)_ - GitHub Actions CI pipeline executions.
  - Endpoint: `GET /repos/{owner}/{repo}/actions/runs`
- **`pull_request`** _(entity)_ - Open and closed pull requests, including draft state, author, and review state.
  - Endpoint: `GET /repos/{owner}/{repo}/pulls`
  - Review state is folded in from GET /repos/{owner}/{repo}/pulls/{number}/reviews per PR.
- **`issue`** _(entity)_ - Open and closed issues with labels, assignees, and author (pull requests excluded).
  - Endpoint: `GET /repos/{owner}/{repo}/issues`
- **`deployment`** _(entity)_ - Deployments with their latest status, keyed by environment and ref.
  - Endpoint: `GET /repos/{owner}/{repo}/deployments`
  - The latest status is folded in from GET /repos/{owner}/{repo}/deployments/{id}/statuses.
- **`release`** _(entity)_ - Published, draft, and prerelease GitHub releases.
  - Endpoint: `GET /repos/{owner}/{repo}/releases`
- **`contributor`** _(entity)_ - Per-author commit activity (commits, additions, deletions) for the repository.
  - Endpoint: `GET /repos/{owner}/{repo}/stats/contributors`

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const github = {
  name: 'github',
  connectorId: 'github-actions',
  config: {
    owner: 'my-org',
    repo: 'my-repo',
    token: secret('GITHUB_TOKEN'),
  },
};

export default defineConfig({
  connectors: [github],
  dashboards: {
    engineering: defineDashboard({
      widgets: {
        open_prs: {
          kind: 'stat',
          title: 'Open PRs',
          metric: defineMetric({
            connector: github,
            shape: 'entity',
            entityType: 'pull_request',
            fn: 'count',
            filter: [{ field: 'state', op: 'eq', value: 'open' }],
          }),
        },
      },
    }),
  },
});
```

## Rate limits

Unauthenticated requests share GitHub’s low 60 requests/hour limit; an authenticated token raises it to 5,000 requests/hour.

## Limitations

- The GitHub REST API can return the same item more than once within a sync (cursor pagination overlapping a mutating collection, retried requests, or an item surfaced via multiple endpoints). Each resource dedupes by stable id before writing, keeping the last copy seen.
- Public repositories without a token are subject to GitHub’s low unauthenticated rate limit.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors)
- [GitHub API docs](https://docs.github.com/rest)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
