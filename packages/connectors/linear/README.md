<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-linear

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-linear)](https://www.npmjs.com/package/@rawdash/connector-linear)
[![license](https://img.shields.io/npm/l/@rawdash/connector-linear)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync teams, members, cycles, issues, and issue state-transition events from a Linear workspace.

## Install

```sh
npm install @rawdash/connector-linear
```

## Authentication

A Linear Personal API Key is required. It authenticates all GraphQL requests and scopes the sync to the workspaces and teams the key can access.

1. Open Linear → Settings → API → Personal API keys.
2. Create a new personal API key.
3. Store it as a secret and reference it from the connector config as `apiKey: secret("LINEAR_API_KEY")`.

## Configuration

| Field             | Type   | Required | Description                                                                                                                                                                                                                                                 |
| ----------------- | ------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apiKey`          | secret | Yes      | Linear Personal API Key. Create one at Linear → Settings → API → Personal API keys.                                                                                                                                                                         |
| `teamIds`         | array  | No       | Restrict the sync to specific Linear team IDs. Omit to sync all teams the API key can see.                                                                                                                                                                  |
| `resources`       | array  | No       | Which Linear resources to sync. Omit to sync all resources. The `issues` phase also emits state-transition events derived from each issue's history.                                                                                                        |
| `historyPerIssue` | number | No       | How many history entries to pull per issue (newest first). State transitions inside this window become events. Defaults to 8. Higher values pull deeper history but lower the effective issues-per-page, since Linear scores the combined query complexity. |

## Resources

- **`linear_team`** _(entity)_ - Workspace teams with their name and key.
  - Endpoint: `GraphQL query: teams { nodes { ... } }`
- **`linear_user`** _(entity)_ - Workspace members, including name, email, display name, and active state.
  - Endpoint: `GraphQL query: users { nodes { ... } }`
- **`linear_cycle`** _(entity)_ - Team cycles with their number, dates, progress, and final scope / completed-scope figures.
  - Endpoint: `GraphQL query: cycles { nodes { ... } }`
- **`linear_issue`** _(entity)_ - Issues with their state, priority, assignee, team, project, cycle, labels, estimate, and lifecycle timestamps.
  - Endpoint: `GraphQL query: issues { nodes { ... } }`
- **`linear_issue_state_change`** _(event)_ - State-transition events derived from each issue’s history (from-state to to-state), keyed by the originating actor.
  - Endpoint: `GraphQL query: issues { nodes { history { nodes { ... } } } }`
  - Only history entries with a non-null fromState and toState (where they differ) become events; these append-only events accumulate across incremental syncs.

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const linear = {
  name: 'linear',
  connectorId: 'linear',
  config: {
    apiKey: secret('LINEAR_API_KEY'),
  },
};

export default defineConfig({
  connectors: [linear],
  dashboards: {
    product: defineDashboard({
      widgets: {
        open_issues: {
          kind: 'stat',
          title: 'In-progress issues',
          metric: defineMetric({
            connector: linear,
            shape: 'entity',
            entityType: 'linear_issue',
            fn: 'count',
            filter: [{ field: 'stateType', op: 'eq', value: 'started' }],
          }),
        },
      },
    }),
  },
});
```

## Rate limits

Linear returns X-RateLimit-Requests-Remaining / X-RateLimit-Requests-Reset headers (reset in ms); flat resources are paged 250 at a time, issues up to 150 (capped by GraphQL query complexity against the nested history depth).

## Limitations

- API key auth only (OAuth not yet supported).
- Webhooks and roadmap/initiative resources are out of scope.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors)
- [Linear API docs](https://developers.linear.app/docs)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
