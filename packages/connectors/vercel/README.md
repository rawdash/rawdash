<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-vercel

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-vercel)](https://www.npmjs.com/package/@rawdash/connector-vercel)
[![license](https://img.shields.io/npm/l/@rawdash/connector-vercel)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync Vercel projects and deployments - including build state, target, git ref, and build duration - across your team.

## Install

```sh
npm install @rawdash/connector-vercel
```

## Authentication

A Vercel access token is required. Use a team token (with the team ID) to sync a team scope, or a personal token for the token owner scope.

1. Open Vercel → Account Settings → Tokens.
2. Create an access token with read access to the projects and deployments you want to sync.
3. Store it as a secret and reference it from the connector config as `apiToken: secret("VERCEL_TOKEN")`.
4. If the token is a team token, set `teamId` to the team slug or `team_...` id.

## Configuration

| Field                     | Type   | Required | Description                                                                                                                                                                                                                       |
| ------------------------- | ------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apiToken`                | secret | Yes      | Vercel access token (Personal or Team). Create one at Vercel → Account Settings → Tokens.                                                                                                                                         |
| `teamId`                  | string | No       | Vercel team ID (slug or `team_...`). Omit to use the token owner scope. Required if the token is a team token.                                                                                                                    |
| `projects`                | array  | No       | Restrict deployment sync to specific Vercel project IDs (e.g. `prj_...`). Omit to sync every project the token can see.                                                                                                           |
| `resources`               | array  | No       | Which Vercel resources to sync. Omit to sync all of them. 'deployment_events' depends on 'deployments' being fetched - enabling it without 'deployments' still runs the deployments query, but skips writing deployment entities. |
| `deploymentsLookbackDays` | number | No       | How many days back to fetch deployments on a full sync. Defaults to 30. Vercel returns deployments newest-first; this caps the backfill window.                                                                                   |

## Resources

- **`vercel_project`** _(entity)_ - Vercel projects with name, framework, owning account, and create/update timestamps.
  - Endpoint: `GET /v9/projects`
- **`vercel_deployment`** _(entity)_ - Deployments with build state, target environment, git ref/sha, creator, and build duration.
  - Endpoint: `GET /v6/deployments`
  - buildDurationMs is ready minus buildingAt when both are present, otherwise null. gitRef prefers meta.githubCommitRef, falling back to gitlabCommitRef, bitbucketCommitRef, then meta.branch.
- **`vercel_deployment_event`** _(event)_ - Each deployment emitted as a time-bounded event spanning creation to ready, carrying the same attributes as the deployment entity.
  - Endpoint: `GET /v6/deployments`

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const vercel = {
  name: 'vercel',
  connectorId: 'vercel',
  config: {
    apiToken: secret('VERCEL_TOKEN'),
    teamId: 'team_abc123',
    deploymentsLookbackDays: 30,
  },
};

export default defineConfig({
  connectors: [vercel],
  dashboards: {
    infrastructure: defineDashboard({
      widgets: {
        deployments: {
          kind: 'stat',
          title: 'Deployments',
          metric: defineMetric({
            connector: vercel,
            shape: 'event',
            name: 'vercel_deployment_event',
            fn: 'count',
          }),
        },
      },
    }),
  },
});
```

## Rate limits

Vercel returns X-RateLimit-Remaining / X-RateLimit-Reset headers (Unix seconds).

## Limitations

- Deployments are fetched newest-first within the configured lookback window (`deploymentsLookbackDays`, default 30 days); older deployments are not backfilled.
- Enabling `deployment_events` without `deployments` still runs the deployments query but skips writing deployment entities.
- Web Vitals / Speed Insights, edge function logs, and DNS/domain APIs are out of scope.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors)
- [Vercel API docs](https://vercel.com/docs/rest-api)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
