<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-monday

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-monday)](https://www.npmjs.com/package/@rawdash/connector-monday)
[![license](https://img.shields.io/npm/l/@rawdash/connector-monday)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync boards, items, and item activity events from a monday.com account.

## Install

```sh
npm install @rawdash/connector-monday
```

## Authentication

A monday.com API token is required. It authenticates every GraphQL request and scopes the sync to the boards the token can access.

1. Open monday.com and click your avatar -> Developers.
2. Go to My access tokens and copy your personal API token.
3. Store it as a secret and reference it from the connector config as `apiToken: secret("MONDAY_API_TOKEN")`.

## Configuration

| Field       | Type   | Required | Description                                                                                                 |
| ----------- | ------ | -------- | ----------------------------------------------------------------------------------------------------------- |
| `apiToken`  | secret | Yes      | monday.com API token. Create one at monday.com -> Profile (avatar) -> Developers -> My access tokens.       |
| `boardIds`  | array  | No       | Restrict the sync to specific board IDs. Omit to discover and sync every board the token can see.           |
| `resources` | array  | No       | Which resources to sync. Omit to sync all resources. The `item_events` phase reads each board activity log. |

## Resources

- **`monday_board`** _(entity)_ - Boards with their name, state, kind, workspace, and item count.
  - Endpoint: `GraphQL query: boards { ... }`
- **`monday_item`** _(entity)_ - Board items with their name, state, group, board, column values, and lifecycle timestamps.
  - Endpoint: `GraphQL query: boards { items_page { items { ... } } }`
- **`monday_item_activity`** _(event)_ - Item activity events derived from each board activity log (creates, updates, status changes), keyed by the originating user.
  - Endpoint: `GraphQL query: boards { activity_logs { ... } }`
  - Derived from each board activity log. Activity logs are filtered server-side by date in incremental mode (the from argument) and these append-only events accumulate across syncs. A full sync clears and rewrites the event stream.

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const monday = {
  name: 'monday',
  connectorId: 'monday',
  config: {
    apiToken: secret('MONDAY_API_TOKEN'),
  },
};

export default defineConfig({
  connectors: [monday],
  dashboards: {
    delivery: defineDashboard({
      widgets: {
        active_items: {
          kind: 'stat',
          title: 'Active items',
          metric: defineMetric({
            connector: monday,
            shape: 'entity',
            entityType: 'monday_item',
            fn: 'count',
            filter: [{ field: 'state', op: 'eq', value: 'active' }],
          }),
        },
      },
    }),
  },
});
```

## Rate limits

monday.com meters requests by a per-minute complexity budget rather than a fixed request count; the connector walks one board at a time and pages items at most 100 at a time to keep each query within budget.

## Limitations

- API token auth only (OAuth not yet supported).
- items_page has no server-side updated-at filter, so incremental item syncs page each board and drop unchanged rows client-side; item activity events are filtered server-side by date.
- Webhooks, updates/replies, and sub-items are out of scope.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors)
- [monday.com API docs](https://developer.monday.com/api-reference/)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
