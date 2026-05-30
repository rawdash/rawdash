<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-sentry

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-sentry)](https://www.npmjs.com/package/@rawdash/connector-sentry)
[![license](https://img.shields.io/npm/l/@rawdash/connector-sentry)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync issues, issue events, releases, and hourly error rates from a Sentry organization.

## Install

```sh
npm install @rawdash/connector-sentry
```

## Authentication

A Sentry auth token is required. Use an organization-level Internal Integration token or a User Auth Token with read access to issues, events, and releases.

1. Open Sentry → Settings → Custom Integrations → New Internal Integration (or Settings → Auth Tokens for a personal token).
2. Grant read access to Issues & Events and Releases.
3. Copy the generated token and store it as a secret, referencing it from the connector config as `authToken: secret("SENTRY_AUTH_TOKEN")`.
4. Set the `organization` slug as it appears in your Sentry URL.

## Configuration

| Field                | Type   | Required | Description                                                                                                                                                                                              |
| -------------------- | ------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `authToken`          | secret | Yes      | Sentry Internal Integration token or User Auth Token. Create one at Sentry → Settings → Auth Tokens (or for an org, Settings → Custom Integrations → New Internal Integration).                          |
| `organization`       | string | Yes      | Your Sentry organization's slug, as it appears in the URL.                                                                                                                                               |
| `projects`           | array  | No       | Restrict the sync to specific Sentry project slugs (or numeric IDs). Omit to sync every project the token can see.                                                                                       |
| `resources`          | array  | No       | Which Sentry resources to sync. Omit to sync all of them. 'issue_events' depends on 'issues' being fetched - enabling it without 'issues' still runs the issues query, but skips writing issue entities. |
| `eventsPerIssueCap`  | number | No       | Maximum number of recent events (occurrences) to sample per issue on each sync. Defaults to 100 (the max page size Sentry allows for the issue events endpoint).                                         |
| `statsLookbackHours` | number | No       | How many hours of hourly error-rate data to refresh on each sync. Defaults to 24.                                                                                                                        |

## Resources

- **`sentry_issue`** _(entity)_ - Sentry issues (error groups) with level, status, occurrence count, affected user count, and first/last seen timestamps.
  - Endpoint: `GET /api/0/organizations/{organization}/issues/`
- **`sentry_issue_event`** _(event)_ - Individual event occurrences sampled per issue, with platform, environment, level, and message.
  - Endpoint: `GET /api/0/issues/{issueId}/events/`
  - Events are sampled: at most eventsPerIssueCap recent events per issue per sync (Sentry caps a single events page at 100), so this is a representative sample, not a full audit trail.
- **`sentry_release`** _(entity)_ - Releases with their versions, associated project slugs, and creation/release/last-event timestamps.
  - Endpoint: `GET /api/0/organizations/{organization}/releases/`
- **`sentry_errors_per_hour`** _(metric)_ - Hourly count of error events, broken down by project, over the configured lookback window.
  - Endpoint: `GET /api/0/organizations/{organization}/stats_v2/`
  - Unit: errors
  - Granularity: 1h
  - Dimensions: `project`

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const sentry = {
  name: 'sentry',
  connectorId: 'sentry',
  config: {
    authToken: secret('SENTRY_AUTH_TOKEN'),
    organization: 'my-org',
    projects: ['my-project'],
  },
};

export default defineConfig({
  connectors: [sentry],
  dashboards: {
    engineering: defineDashboard({
      widgets: {
        unresolved_issues: {
          kind: 'stat',
          title: 'Unresolved Issues',
          metric: defineMetric({
            connector: sentry,
            shape: 'entity',
            entityType: 'sentry_issue',
            fn: 'count',
            filter: [{ field: 'status', op: 'eq', value: 'unresolved' }],
          }),
        },
      },
    }),
  },
});
```

## Rate limits

Sentry returns X-Sentry-Rate-Limit-Remaining / X-Sentry-Rate-Limit-Reset headers (reset in seconds); list pagination uses the Link header (page size 100).

## Limitations

- Performance / trace data is out of scope (high cost, low signal for dashboards).
- Self-hosted Sentry on custom hosts is out of scope (pagination URLs are pinned to sentry.io).

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors/)
- [Sentry API docs](https://docs.sentry.io/api/)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
