<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-statusgator

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-statusgator)](https://www.npmjs.com/package/@rawdash/connector-statusgator)
[![license](https://img.shields.io/npm/l/@rawdash/connector-statusgator)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Aggregate the public status pages of every SaaS you depend on into a single 'is anything down?' view - current health per service plus the history of status changes across your dependency set.

## Install

```sh
npm install @rawdash/connector-statusgator
```

## Authentication

A StatusGator API token is required. Tokens are org-scoped and inherit read access to your boards, monitors, and history.

1. Sign in to StatusGator as an organization admin.
2. Open the API section from the main board menu and create an API token.
3. Store the token as a secret and reference it as `apiKey: secret("STATUSGATOR_API_KEY")`.
4. Optionally set `boardId` to a single board; omit it to sync every board.

## Configuration

| Field                 | Type   | Required | Description                                                                                                                                         |
| --------------------- | ------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apiKey`              | secret | Yes      | StatusGator API token. An organization admin can create one under the API section of the StatusGator dashboard.                                     |
| `boardId`             | string | No       | Restrict the sync to a single StatusGator board. Omit to sync every board on the account.                                                           |
| `services`            | array  | No       | Only sync the named services. Matches a monitor display name, service name, or service slug (case-insensitive). Omit to sync every watched service. |
| `historyLookbackDays` | number | No       | How many days of status-change history to fetch on a full sync. Defaults to 90.                                                                     |
| `resources`           | array  | No       | Which StatusGator resources to sync. Omit to sync all of them.                                                                                      |

## Resources

- **`statusgator_service`** _(entity)_ - A service watched on a StatusGator board (the third-party status pages you subscribe to), with its current aggregated health.
  - Endpoint: `GET /boards/{board_id}/monitors`
  - `name`: Monitor display name.
  - `currentStatus`: Current aggregated status: up | warn | down | maintenance | unknown.
  - `serviceId`: StatusGator catalog service id, when the monitor tracks a known service.
  - `serviceName`: Canonical service name from the StatusGator catalog.
  - `serviceSlug`: Canonical service slug from the StatusGator catalog.
  - `homepageUrl`: Service homepage URL.
  - `statusPageUrl`: Public status page URL for the service.
  - `boardId`: Id of the board the service is watched on.
  - `lastChangedAt`: When the monitor was last checked / its status last changed (epoch ms).
- **`statusgator_status_change`** _(event)_ - A status transition for a watched service, derived from board history. Emitted at the moment the service entered the new status.
  - Endpoint: `GET /boards/{board_id}/history`
  - from is the previous status in the history for that service (null for the earliest known change). Bounded by the history lookback window (default 90 days) and tightened to options.since on incremental syncs.
  - `serviceId`: Monitor id the transition belongs to.
  - `serviceName`: Monitor / service name.
  - `from`: Status the service was in before the transition, or null.
  - `to`: Status the service entered at this transition.
  - `boardId`: Id of the board the transition was observed on.

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const statusgator = {
  name: 'statusgator',
  connectorId: 'statusgator',
  config: {
    apiKey: secret('STATUSGATOR_API_KEY'),
    services: ['GitHub', 'Stripe', 'AWS'],
  },
};

export default defineConfig({
  connectors: [statusgator],
  dashboards: {
    dependencies: defineDashboard({
      widgets: {
        services_down: {
          kind: 'stat',
          title: 'Dependencies down',
          metric: defineMetric({
            connector: statusgator,
            shape: 'entity',
            entityType: 'statusgator_service',
            fn: 'count',
            filter: [{ field: 'currentStatus', op: 'eq', value: 'down' }],
          }),
        },
        status_changes_per_day: {
          kind: 'timeseries',
          title: 'Status changes per day',
          window: '30d',
          granularity: 'day',
          metric: defineMetric({
            connector: statusgator,
            shape: 'event',
            name: 'statusgator_status_change',
            fn: 'count',
          }),
        },
      },
    }),
  },
});
```

## Rate limits

StatusGator paginates boards and monitors at up to 100 rows per page. This connector paginates sequentially and honors 429 Retry-After.

## Limitations

- Website / ping / custom monitor configuration (check intervals, regions, HTTP settings) is out of scope - only the current status and status-change history are synced.
- Incidents, subscribers, users, and regions are not synced.
- Status-change transitions are derived from board history; the "from" status of the earliest known change for a service is null.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors)
- [StatusGator API docs](https://statusgator.com/api/v3/docs)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
