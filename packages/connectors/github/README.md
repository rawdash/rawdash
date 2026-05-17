# @rawdash/connector-github

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-github)](https://www.npmjs.com/package/@rawdash/connector-github)
[![license](https://img.shields.io/npm/l/@rawdash/connector-github)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

GitHub connector for rawdash — sync pull requests, issues, deployments, releases, and CI runs into your dashboard.

## What it is

`@rawdash/connector-github` is a rawdash connector that pulls data from the GitHub REST API. It syncs workflow runs, pull requests, issues, deployments, releases, and contributor activity into the rawdash storage engine, where they become available to widgets defined in your `rawdash.config.ts`.

## Install

```sh
npm install @rawdash/connector-github
```

## Quick example

```ts
import { GitHubActionsConnector } from '@rawdash/connector-github';
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const github = new GitHubActionsConnector({
  owner: 'my-org',
  repo: 'my-repo',
  token: secret('GITHUB_TOKEN'), // optional for public repos
});

export default defineConfig({
  connectors: [{ connector: github }],
  dashboards: {
    engineering: defineDashboard({
      widgets: {
        open_prs: {
          kind: 'stat',
          title: 'Open PRs',
          metric: defineMetric({
            connector: github,
            shape: 'entity',
            field: 'id',
            fn: 'count',
            filter: [{ field: 'state', op: 'eq', value: 'open' }],
          }),
        },
        ci_status: {
          kind: 'status',
          title: 'CI',
          source: `${github.id}:workflow_runs`,
        },
      },
    }),
  },
});
```

## Configuration

| Field   | Type     | Required | Description                                                                       |
| ------- | -------- | -------- | --------------------------------------------------------------------------------- |
| `owner` | `string` | Yes      | GitHub username or organization name                                              |
| `repo`  | `string` | Yes      | Repository name                                                                   |
| `token` | `Secret` | No       | GitHub PAT with `repo` scope. Required for private repos and to avoid rate limits |

## Data synced

- **Workflow runs** — CI pipeline executions (shape: `event`)
- **Pull requests** — open and closed PRs with review state (shape: `entity`)
- **Issues** — open and closed issues with labels and assignees (shape: `entity`)
- **Deployments** — deployment events and statuses (shape: `event`)
- **Releases** — published GitHub releases (shape: `event`)
- **Contributors** — commit activity per author (shape: `metric`)

## Links

- [rawdash docs](https://rawdash.dev)
- [GitHub](https://github.com/rawdash/rawdash)
- [Issues](https://github.com/rawdash/rawdash/issues)

## License

Apache-2.0
