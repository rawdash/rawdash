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
import { GitHubConnector } from '@rawdash/connector-github';
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const github = new GitHubConnector(
  {
    owner: 'my-org',
    repo: 'my-repo',
  },
  {
    token: secret('GITHUB_TOKEN'), // optional for public repos
  },
);

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

## Duplicate handling

The GitHub REST API can return the same item more than once within a single sync — for example when cursor pagination overlaps as the underlying collection mutates mid-fetch, when a retried request re-introduces items already seen, or when the same entity appears via more than one endpoint.

Per resource (`workflow_runs`, `pull_requests`, `issues`, `deployments`, `releases`, `contributors`), the connector dedupes by stable id before writing to storage. The strategy is **keep last**: when two copies share an id, the later copy in the API response wins. `workflow_runs` additionally tracks ids across paginated pages within a single sync so the same run can't be written as two separate events. When duplicates are dropped, the connector emits a `console.warn` with the count so the behavior is observable. `repo_stats` is a single-document resource so dedupe doesn't apply.

## Property tests

Every resource in this connector has a fast-check property test under `src/property.test.ts` that:

1. Generates N≥100 synthetic API payloads from a Zod schema mirroring the GitHub API response.
2. Pipes them through `connector.sync()` against an `InMemoryStorage` instance.
3. Asserts universal invariants — non-empty entity ids, finite event timestamps, no `undefined` leaking into storage, no thrown errors on any valid input — plus per-resource counts.

The helper lives in `@rawdash/connector-test-utils`. When extending the connector with a new resource, add a Zod schema for its payload and a test wired up via `runPropertySyncTest`.

## Links

- [rawdash docs](https://rawdash.dev)
- [GitHub](https://github.com/rawdash/rawdash)
- [Issues](https://github.com/rawdash/rawdash/issues)

## License

Apache-2.0
