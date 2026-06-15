<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-launchdarkly

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-launchdarkly)](https://www.npmjs.com/package/@rawdash/connector-launchdarkly)
[![license](https://img.shields.io/npm/l/@rawdash/connector-launchdarkly)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync LaunchDarkly projects, feature flags, and audit-log events - including flag state per environment, kind, and recent rollout changes.

## Install

```sh
npm install @rawdash/connector-launchdarkly
```

## Authentication

A LaunchDarkly API access token with read access is required. Personal or service tokens both work; a reader-role service token is the recommended minimum.

1. Open LaunchDarkly -> Account settings -> Authorization -> Access tokens.
2. Create an access token with the Reader role (or a custom role that grants read access to projects, flags, and the audit log).
3. Copy the generated token and store it as a secret, referencing it from the connector config as `apiToken: secret("LD_API_TOKEN")`.

## Configuration

| Field                  | Type   | Required | Description                                                                                                                                                                                                       |
| ---------------------- | ------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apiToken`             | secret | Yes      | LaunchDarkly API access token with read access. Create one at LaunchDarkly -> Account settings -> Authorization -> Access tokens.                                                                                 |
| `projects`             | array  | No       | Restrict the sync to specific LaunchDarkly project keys. Omit to sync every project the token can see.                                                                                                            |
| `resources`            | array  | No       | Which LaunchDarkly resources to sync. Omit to sync all of them. feature_flags depends on projects being fetched - enabling it without projects still runs the projects query, but skips writing project entities. |
| `auditLogLookbackDays` | number | No       | How many days back to fetch audit-log events on a full sync. Defaults to 30. LaunchDarkly returns audit events newest-first; this caps the backfill window.                                                       |

## Resources

- **`launchdarkly_project`** _(entity)_ - LaunchDarkly projects, with their key, display name, and tags.
  - Endpoint: `GET /api/v2/projects`
  - `key`: Project key (stable identifier).
  - `name`: Project display name.
  - `tags`: Project tags.
- **`launchdarkly_feature_flag`** _(entity)_ - Feature flags across one or more projects, including kind (boolean | multivariate | other), archived state, tags, variations, and per-environment on/off + last-modified.
  - Endpoint: `GET /api/v2/flags/{projectKey}`
  - `key`: Flag key (stable identifier).
  - `name`: Flag display name.
  - `kind`: Flag kind: boolean | multivariate | other.
  - `projectKey`: Project key the flag belongs to.
  - `archived`: Whether the flag is archived.
  - `tags`: Flag tags.
  - `variationCount`: Number of variations on the flag.
  - `environments`: Map of envKey -> { on, archived, lastModified } summarizing flag state per environment.
  - `creationDate`: Flag creation timestamp (epoch ms).
- **`launchdarkly_flag_event`** _(event)_ - Audit-log entries for flag-related changes (flag created / modified / toggled / archived), with the acting member and target resources.
  - Endpoint: `GET /api/v2/auditlog`
  - Filtered to entries newer than the lookback window (default 30 days) and incrementally bounded by options.since on subsequent syncs. LaunchDarkly returns events newest-first.
  - `auditId`: LaunchDarkly audit-log entry id.
  - `kind`: Audit entry kind (e.g. flag, project, environment).
  - `titleVerb`: Verb describing the action (e.g. "updated", "created").
  - `memberEmail`: Email of the member who performed the action.
  - `targetName`: Name of the target resource (e.g. flag key).
  - `targetResources`: Resource paths the action touched (e.g. proj/<key>:env/<env>:flag/<key>).

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const launchdarkly = {
  name: 'launchdarkly',
  connectorId: 'launchdarkly',
  config: {
    apiToken: secret('LD_API_TOKEN'),
  },
};

export default defineConfig({
  connectors: [launchdarkly],
  dashboards: {
    engineering: defineDashboard({
      widgets: {
        active_flags: {
          kind: 'stat',
          title: 'Active feature flags',
          metric: defineMetric({
            connector: launchdarkly,
            shape: 'entity',
            entityType: 'launchdarkly_feature_flag',
            fn: 'count',
            filter: [{ field: 'archived', op: 'eq', value: false }],
          }),
        },
      },
    }),
  },
});
```

## Rate limits

LaunchDarkly defaults to 5 requests/second per token; X-Ratelimit-Global-Remaining and X-Ratelimit-Reset (Unix ms) headers are honored. Retry-After is honored on 429.

## Limitations

- Flag-level served counts (Data Export) and the Experimentation API are out of scope.
- Feature flags are fetched per project; the audit log is a single global stream filtered by created-after timestamp.
- Custom hosts / federal instances are out of scope (pagination URLs are pinned to app.launchdarkly.com).

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors)
- [LaunchDarkly API docs](https://apidocs.launchdarkly.com/)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
