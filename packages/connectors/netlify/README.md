<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-netlify

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-netlify)](https://www.npmjs.com/package/@rawdash/connector-netlify)
[![license](https://img.shields.io/npm/l/@rawdash/connector-netlify)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync Netlify sites and deploys - including build state, branch, commit ref, and deploy duration - across your team.

## Install

```sh
npm install @rawdash/connector-netlify
```

## Authentication

A Netlify personal access token is required. The token must belong to an account with read access to the sites you want to sync.

1. Open Netlify -> User Settings -> Applications -> Personal access tokens.
2. Click "New access token", give it a name, and copy the token value.
3. Store it as a secret and reference it from the connector config as `apiToken: secret("NETLIFY_API_TOKEN")`.
4. Optionally set `siteIds` to a list of site IDs to limit the sync scope.

## Configuration

| Field                 | Type   | Required | Description                                                                                                                                                                                                                                                                                                      |
| --------------------- | ------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apiToken`            | secret | Yes      | Netlify personal access token. Create one at Netlify -> User Settings -> Applications -> Personal access tokens.                                                                                                                                                                                                 |
| `siteIds`             | array  | No       | Restrict the sync to specific Netlify site IDs (the UUID-style id from the site Admin panel). Omit to sync every site the token can see.                                                                                                                                                                         |
| `resources`           | array  | No       | Which Netlify resources to sync. Omit to sync all of them. 'deploy_events' rides the 'deploys' phase - enabling it without 'deploys' still fetches deploys but skips writing deploy entities.                                                                                                                    |
| `deploysLookbackDays` | number | No       | Cap the deploy backfill window to this many days. If unset, the connector fetches every deploy the API returns (newest-first). Netlify has no server-side date filter on the deploys endpoint, so the cutoff is applied client-side and short-circuits pagination once a page is entirely older than the cutoff. |

## Resources

- **`netlify_site`** _(entity)_ - Netlify sites with name, primary URL, owning account, linked git repo, and create/update timestamps.
  - Endpoint: `GET /api/v1/sites`
- **`netlify_deploy`** _(entity)_ - Deploys with build state, branch, commit ref, deploy context (production/branch-deploy/deploy-preview), and build duration.
  - Endpoint: `GET /api/v1/sites/{site_id}/deploys`
  - deployTimeMs comes from the API `deploy_time` field (seconds) when present, otherwise null. gitRef prefers `commit_ref`, falling back to `branch`.
- **`netlify_deploy_event`** _(event)_ - Each deploy emitted as a time-bounded event spanning creation to publish, carrying the same attributes as the deploy entity.
  - Endpoint: `GET /api/v1/sites/{site_id}/deploys`

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const netlify = {
  name: 'netlify',
  connectorId: 'netlify',
  config: {
    apiToken: secret('NETLIFY_API_TOKEN'),
    deploysLookbackDays: 30,
  },
};

export default defineConfig({
  connectors: [netlify],
  dashboards: {
    infrastructure: defineDashboard({
      widgets: {
        deploys: {
          kind: 'stat',
          title: 'Deploys',
          metric: defineMetric({
            connector: netlify,
            shape: 'event',
            name: 'netlify_deploy_event',
            fn: 'count',
          }),
        },
      },
    }),
  },
});
```

## Rate limits

Netlify returns standard `X-RateLimit-Remaining` / `X-RateLimit-Reset` headers (reset is a Unix timestamp in seconds); list pagination uses the Link header (page size 100).

## Limitations

- Netlify has no server-side date filter on the deploys endpoint - the connector paginates newest-first and applies `deploysLookbackDays` (if set) as a client-side cutoff that short-circuits pagination once a full page is older than the cutoff.
- Enabling `deploy_events` without `deploys` still runs the deploys query but skips writing deploy entities.
- Netlify Analytics (paid add-on), function invocation logs, and DNS/domain APIs are out of scope.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors)
- [Netlify API docs](https://open-api.netlify.com/)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
