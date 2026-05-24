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

const github = {
  name: 'github',
  connectorId: 'github-actions',
  config: {
    owner: 'my-org',
    repo: 'my-repo',
    token: secret('GITHUB_TOKEN'), // optional for public repos
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
            field: 'id',
            fn: 'count',
            filter: [{ field: 'state', op: 'eq', value: 'open' }],
          }),
        },
        ci_status: {
          kind: 'status',
          title: 'CI',
          source: `${github.name}:workflow_runs`,
        },
      },
    }),
  },
});

// Wire the registry separately when mounting:
//   mountEngine(config, { connectorRegistry: { 'github-actions': GitHubConnector } });
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

## Schemas

`GitHubConnector.schemas` declares the Zod schema for each resource's raw API response. The cloud shape-drift pipeline reads these at deploy time to populate `connector_baselines`, and the package's property tests fuzz against them.

| Resource               | Represents                                            |
| ---------------------- | ----------------------------------------------------- |
| `repo`                 | `GET /repos/{owner}/{repo}` — top-level repo stats    |
| `workflow_runs`        | `GET /repos/{owner}/{repo}/actions/runs` page         |
| `pull_requests`        | `GET /repos/{owner}/{repo}/pulls` page                |
| `pull_request_reviews` | `GET /repos/{owner}/{repo}/pulls/{n}/reviews`         |
| `issues`               | `GET /repos/{owner}/{repo}/issues` page               |
| `deployments`          | `GET /repos/{owner}/{repo}/deployments` page          |
| `deployment_statuses`  | `GET /repos/{owner}/{repo}/deployments/{id}/statuses` |
| `releases`             | `GET /repos/{owner}/{repo}/releases` page             |
| `contributors`         | `GET /repos/{owner}/{repo}/stats/contributors`        |

## Aggregates

The connector implements `aggregate()` so the runner can serve `stat` and `status` widgets without first syncing the underlying rows into storage. Each call is one upstream request, regardless of how many objects the answer covers.

| `fn`     | Resource       | Upstream endpoint                                                            | Supported filters / fields                                                                                                                     |
| -------- | -------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `count`  | `pull_request` | `GET /search/issues?q=repo:{owner}/{repo} is:pr ...`                         | `state=eq:open\|closed`, `draft=eq:bool`, `label=eq:str`, `author=eq:str`, `assignee=eq:str`, `milestone=eq:str`, `head=eq:str`, `base=eq:str` |
| `count`  | `issue`        | `GET /search/issues?q=repo:{owner}/{repo} is:issue ...`                      | same filter set as `pull_request` (except `head`/`base`)                                                                                       |
| `count`  | `contributor`  | `GET /repos/{owner}/{repo}/contributors?per_page=1` (parses `Link rel=last`) | no filters                                                                                                                                     |
| `latest` | `repo`         | `GET /repos/{owner}/{repo}`                                                  | `field=stars\|forks\|watchers`                                                                                                                 |
| `latest` | `workflow_run` | `GET /repos/{owner}/{repo}/actions/runs?per_page=1`                          | `field=conclusion\|status\|branch\|actor`                                                                                                      |
| `latest` | `release`      | `GET /repos/{owner}/{repo}/releases/latest`                                  | `field=tag_name\|name\|author\|published_at`                                                                                                   |

`count` filter conditions are translated to GitHub Search API qualifiers (`is:open`, `label:"needs review"`, `author:octocat`, etc.). Only `op: 'eq'` is supported for now; the connector throws a descriptive error on unsupported ops, fields, or combinations, which causes the runner to fall back to evaluating the metric against synced storage rows.

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
