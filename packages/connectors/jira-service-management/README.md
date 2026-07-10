<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-jira-service-management

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-jira-service-management)](https://www.npmjs.com/package/@rawdash/connector-jira-service-management)
[![license](https://img.shields.io/npm/l/@rawdash/connector-jira-service-management)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync service desks, customer requests, request status-change events, and SLA breach events from a Jira Service Management site for request volume, MTTR, and SLA-attainment dashboards.

## Install

```sh
npm install @rawdash/connector-jira-service-management
```

## Authentication

Authenticates over HTTP Basic auth using your Atlassian account email and an API token (the same auth as the Jira connector). The token must belong to an account with agent access to the service desks you want to sync.

1. Open id.atlassian.com -> Security -> Create and manage API tokens.
2. Create an API token and copy its value.
3. Store the token as a secret and reference it from the connector config as `apiToken: secret("JIRA_API_TOKEN")`, alongside your account email and site host (e.g. yourorg.atlassian.net).
4. The account needs agent (or admin) access to the service desks; a read-only customer account cannot list requests via the Jira search API.

## Configuration

| Field         | Type   | Required | Description                                                                                                                                                                                                                                                             |
| ------------- | ------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `email`       | string | Yes      | Atlassian account email paired with the API token for Basic auth.                                                                                                                                                                                                       |
| `apiToken`    | secret | Yes      | Atlassian API token. Create one at id.atlassian.com → Security → API tokens.                                                                                                                                                                                            |
| `host`        | string | Yes      | Your Jira Cloud host, e.g. yourorg.atlassian.net (no protocol, no trailing slash).                                                                                                                                                                                      |
| `projectKeys` | array  | No       | Restrict the sync to specific service desk project keys (e.g. IT, HELP). Omit to sync every service desk the account can see.                                                                                                                                           |
| `resources`   | array  | No       | Which Jira Service Management resources to sync. Omit to sync all of them. 'request_events' and 'sla_breaches' share the requests query - enabling either without 'requests' still fetches requests (with changelog and SLA fields) but skips writing request entities. |

## Resources

- **`jsm_service_desk`** _(entity)_ - Service desks on the site, with the backing project id, key, and name.
  - Endpoint: `GET /rest/servicedeskapi/servicedesk`
  - `projectId`: Id of the backing Jira project.
  - `projectKey`: Key of the backing Jira project.
  - `projectName`: Name of the service desk project.
- **`jsm_request`** _(entity)_ - Service desk requests with status, priority, request/issue type, assignee, reporter, project, created and resolution timestamps.
  - Endpoint: `GET /rest/api/3/search/jql`
  - Service desk requests are Jira issues; the sync is scoped to service desk projects.
  - `key`: Human-readable request key (e.g. IT-42).
  - `summary`: Request summary.
  - `statusName`: Current workflow status name.
  - `statusCategory`: Status category key (new, indeterminate, done) for open/closed grouping.
  - `priority`: Priority name (null if unset).
  - `requestType`: Customer request type name when a request-type field is present (null otherwise).
  - `issueType`: Underlying Jira issue type name.
  - `assigneeId`: Account id of the assignee (null if unassigned).
  - `reporterId`: Account id of the reporter.
  - `projectKey`: Key of the owning service desk project.
  - `createdAt`: When the request was created (Unix ms).
  - `resolvedAt`: When the request was resolved (Unix ms, null if unresolved).
- **`jsm_request_status_change`** _(event)_ - Request status transition events derived from request changelogs, capturing the from/to status, author, and project.
  - Endpoint: `GET /rest/api/3/search/jql (expand=changelog)`
  - start_ts is the changelog entry time, end_ts is null. Timestamps are Unix epoch milliseconds.
  - `historyId`: Changelog history id.
  - `requestId`: Issue id of the request.
  - `requestKey`: Human-readable request key.
  - `projectKey`: Key of the owning service desk project.
  - `authorId`: Account id of the transition author.
  - `fromStatus`: Status the request moved from.
  - `toStatus`: Status the request moved to.
- **`jsm_sla_cycle`** _(event)_ - SLA cycle completion events derived from completed SLA cycles on each request; each event flags whether the SLA goal was breached.
  - Endpoint: `GET /rest/api/3/search/jql (SLA custom fields)`
  - start_ts is the cycle stop time, end_ts is null. `breached` is 1 when the SLA goal was missed. Aggregate breach rate as an average of `breached` in the widget definition.
  - `requestId`: Issue id of the request.
  - `requestKey`: Human-readable request key.
  - `projectKey`: Key of the owning service desk project.
  - `slaName`: Name of the SLA (e.g. Time to resolution).
  - `breached`: 1 when the SLA goal was breached, 0 when it was met.
  - `startedAt`: When the SLA cycle started (Unix ms).
  - `goalMs`: SLA goal duration in milliseconds.
  - `elapsedMs`: Elapsed working time in milliseconds.

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const jsm = {
  name: 'jira-service-management',
  connectorId: 'jira-service-management',
  config: {
    email: 'you@yourorg.com',
    apiToken: secret('JIRA_API_TOKEN'),
    host: 'yourorg.atlassian.net',
  },
};

export default defineConfig({
  connectors: [jsm],
  dashboards: {
    servicedesk: defineDashboard({
      widgets: {
        open_requests: {
          kind: 'stat',
          title: 'Open requests',
          metric: defineMetric({
            connector: jsm,
            shape: 'entity',
            entityType: 'jsm_request',
            fn: 'count',
            filter: [
              { field: 'statusCategory', op: 'eq', value: 'indeterminate' },
            ],
          }),
        },
        requests_opened: {
          kind: 'timeseries',
          title: 'Request status changes',
          window: '30d',
          metric: defineMetric({
            connector: jsm,
            shape: 'event',
            name: 'jsm_request_status_change',
            fn: 'count',
          }),
        },
        sla_breach_rate: {
          kind: 'stat',
          title: 'SLA breach rate',
          metric: defineMetric({
            connector: jsm,
            shape: 'event',
            name: 'jsm_sla_cycle',
            fn: 'avg',
            field: 'breached',
          }),
        },
      },
    }),
  },
});
```

## Rate limits

Jira Cloud uses cost-based rate limiting; 429 responses with Retry-After are honored by the shared HTTP client.

## Limitations

- Service desks are enumerated via the Service Desk API; requests are read via the Jira Cloud REST v3 issue search (service desk requests are Jira issues).
- Request status-change events are derived from each request changelog; only `status` field transitions are written.
- SLA breach events are derived from completed SLA cycles on each request; SLA field IDs are auto-discovered per site, and ongoing (unfinished) cycles are skipped. When the account cannot see any SLA fields, no SLA events are written.
- Targets Jira Service Management Cloud; Jira Service Management Data Center / Server is out of scope.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors)
- [Atlassian API docs](https://developer.atlassian.com/cloud/jira/service-desk/rest/intro/)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
