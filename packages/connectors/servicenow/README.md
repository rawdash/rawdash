<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-servicenow

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-servicenow)](https://www.npmjs.com/package/@rawdash/connector-servicenow)
[![license](https://img.shields.io/npm/l/@rawdash/connector-servicenow)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync incidents, incident state-change events, change requests, and problems from the ServiceNow Table API for incident volume, MTTR, and change-throughput analytics.

## Install

```sh
npm install @rawdash/connector-servicenow
```

## Authentication

HTTP Basic auth using a ServiceNow username and password. The account needs read access to the incident, change_request, and problem tables (the standard ITIL role covers these).

1. Create (or reuse) a ServiceNow user for the integration, ideally a dedicated service account.
2. Grant it a role with read access to the incident, change_request, and problem tables; the built-in `itil` role is sufficient.
3. Store the password as a secret and reference it from config as `password: secret("SERVICENOW_PASSWORD")`, alongside the username and your instance host (the "acme" in acme.service-now.com).

## Configuration

| Field         | Type   | Required | Description                                                                                                                                   |
| ------------- | ------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `instanceUrl` | string | Yes      | Your ServiceNow instance host; the "acme" part becomes acme.service-now.com. A bare host or a full https URL both work.                       |
| `username`    | string | Yes      | ServiceNow user with read access to the incident, change_request, and problem tables. A dedicated integration/service account is recommended. |
| `password`    | secret | Yes      | Password for the ServiceNow user, paired with the username for HTTP Basic auth.                                                               |
| `resources`   | array  | No       | Which ServiceNow tables to sync. Omit to sync all of them. The account only needs read access to the tables listed here.                      |

## Resources

- **`servicenow_incident`** _(entity)_ - Incidents with state, priority, urgency, impact, assignment, and open/resolve/close timestamps.
  - Endpoint: `GET /api/now/table/incident`
  - `number`: Human-readable incident number (INC…).
  - `shortDescription`: Incident short description.
  - `state`: Raw incident state code (1 New … 7 Closed, 8 Canceled).
  - `stateLabel`: Human-readable state derived from the standard codes.
  - `priority`: Raw priority code (1 Critical … 5).
  - `priorityLabel`: Human-readable priority derived from the standard codes.
  - `urgency`: Raw urgency code.
  - `impact`: Raw impact code.
  - `category`: Incident category.
  - `assignmentGroupId`: sys_id of the assignment group (null if unassigned).
  - `assignedToId`: sys_id of the assigned user (null if unassigned).
  - `callerId`: sys_id of the caller who reported the incident.
  - `active`: Whether the incident is still active.
  - `openedAt`: When the incident was opened (Unix ms).
  - `resolvedAt`: When the incident was resolved (Unix ms, null if open).
  - `closedAt`: When the incident was closed (Unix ms, null if open).
  - `createdAt`: When the record was created (Unix ms).
- **`servicenow_incident_state_change`** _(event)_ - Incident state-change events (opened / resolved / closed) derived from each incident.
  - Endpoint: `GET /api/now/table/incident`
  - Derived from each incident’s opened/resolved/closed timestamps; the scope is cleared and rewritten on every sync.
  - `incidentId`: sys_id of the incident the event belongs to.
  - `number`: Human-readable incident number.
  - `transition`: opened, resolved, or closed.
  - `state`: Incident state code at sync time.
  - `priority`: Incident priority code at sync time.
  - `assignmentGroupId`: sys_id of the assignment group at sync time.
- **`servicenow_change_request`** _(entity)_ - Change requests with state, priority, risk, type, assignment, and open/close timestamps.
  - Endpoint: `GET /api/now/table/change_request`
  - `number`: Human-readable change number (CHG…).
  - `shortDescription`: Change short description.
  - `state`: Raw change state code.
  - `priority`: Raw priority code.
  - `risk`: Raw risk code.
  - `type`: Change type (normal, standard, emergency).
  - `assignmentGroupId`: sys_id of the assignment group (null if unassigned).
  - `assignedToId`: sys_id of the assigned user (null if unassigned).
  - `openedAt`: When the change was opened (Unix ms).
  - `closedAt`: When the change was closed (Unix ms, null if open).
  - `createdAt`: When the record was created (Unix ms).
- **`servicenow_problem`** _(entity)_ - Problems with state, priority, assignment, and open timestamps.
  - Endpoint: `GET /api/now/table/problem`
  - `number`: Human-readable problem number (PRB…).
  - `shortDescription`: Problem short description.
  - `state`: Raw problem state code.
  - `priority`: Raw priority code.
  - `assignmentGroupId`: sys_id of the assignment group (null if unassigned).
  - `assignedToId`: sys_id of the assigned user (null if unassigned).
  - `openedAt`: When the problem was opened (Unix ms).
  - `createdAt`: When the record was created (Unix ms).

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const servicenow = {
  name: 'servicenow',
  connectorId: 'servicenow',
  config: {
    instanceUrl: 'acme.service-now.com',
    username: 'rawdash.integration',
    password: secret('SERVICENOW_PASSWORD'),
  },
};

export default defineConfig({
  connectors: [servicenow],
  dashboards: {
    itsm: defineDashboard({
      widgets: {
        active_incidents: {
          kind: 'stat',
          title: 'Active incidents',
          metric: defineMetric({
            connector: servicenow,
            shape: 'entity',
            entityType: 'servicenow_incident',
            fn: 'count',
            filter: [{ field: 'active', op: 'eq', value: true }],
          }),
        },
        incidents_opened: {
          kind: 'timeseries',
          title: 'Incidents opened',
          window: '30d',
          metric: defineMetric({
            connector: servicenow,
            shape: 'event',
            name: 'servicenow_incident_state_change',
            fn: 'count',
            filter: [{ field: 'transition', op: 'eq', value: 'opened' }],
          }),
        },
      },
    }),
  },
});
```

## Rate limits

ServiceNow applies per-instance inbound REST rate limits configured by the admin (default plans allow thousands of requests/hour); throttled requests return HTTP 429, which the shared HTTP client retries with backoff.

## Limitations

- Incident state-change events are derived from each record’s opened/resolved/closed timestamps; the full sys_journal_field audit history is not synced.
- Reference fields (assignment group, assigned to, caller) are synced as sys_id values, not display names.
- Incremental syncs filter on `sys_updated_on`, which ServiceNow evaluates in the integration account timezone; set that account to UTC to avoid boundary gaps.
- SLA (task_sla) records, attachments, and journal comment bodies are out of scope.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors)
- [ServiceNow API docs](https://developer.servicenow.com/dev.do#!/reference/api/latest/rest/c_TableAPI)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
