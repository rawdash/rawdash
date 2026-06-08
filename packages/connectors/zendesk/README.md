<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-zendesk

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-zendesk)](https://www.npmjs.com/package/@rawdash/connector-zendesk)
[![license](https://img.shields.io/npm/l/@rawdash/connector-zendesk)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync tickets, ticket state-change events, satisfaction ratings, users, and groups from Zendesk Support for queue depth, response time, and CSAT analytics.

## Install

```sh
npm install @rawdash/connector-zendesk
```

## Authentication

HTTP Basic auth using an agent (or admin) email address paired with a Zendesk API token. The token must belong to an account with read access to tickets, users, and groups.

1. Open Admin Center -> Apps and integrations -> Zendesk API.
2. On the Settings tab, enable Token access if it is not already on.
3. Click Add API token, give it a label, and copy the generated token value (you cannot view it again).
4. Store the token as a secret and reference it from config as `apiToken: secret("ZENDESK_API_TOKEN")`, alongside the agent email and your account subdomain (the "acme" in acme.zendesk.com).

## Configuration

| Field       | Type   | Required | Description                                                                                                                    |
| ----------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `subdomain` | string | Yes      | Your Zendesk account subdomain, the "acme" in acme.zendesk.com.                                                                |
| `email`     | string | Yes      | Email address of an agent (or admin) on the Zendesk account; paired with the API token for Basic auth.                         |
| `apiToken`  | secret | Yes      | Zendesk API token. Create one in Admin Center -> Apps and integrations -> Zendesk API -> Settings -> Add API token.            |
| `resources` | array  | No       | Which Zendesk resources to sync. Omit to sync all of them. The API token only needs read scopes for the resources listed here. |

## Resources

- **`zendesk_user`** _(entity)_ - Zendesk users (agents, admins, and end-users) with role and activity flags.
  - Endpoint: `GET /api/v2/users.json`
  - `name`: User display name.
  - `email`: User email address.
  - `role`: User role (end-user, agent, or admin).
  - `active`: Whether the user is active.
  - `suspended`: Whether the user is suspended.
  - `defaultGroupId`: Default group the user belongs to (agents only).
  - `createdAt`: When the user was created (Unix ms).
- **`zendesk_group`** _(entity)_ - Agent groups used to route tickets.
  - Endpoint: `GET /api/v2/groups.json`
  - `name`: Group name.
  - `isDefault`: Whether this is the account default group.
  - `deleted`: Whether the group is soft-deleted.
  - `createdAt`: When the group was created (Unix ms).
- **`zendesk_ticket`** _(entity)_ - Tickets with status, priority, assignment, channel, and tags.
  - Endpoint: `GET /api/v2/incremental/tickets/cursor.json`
  - `subject`: Ticket subject line.
  - `status`: Ticket status (new, open, pending, hold, solved, closed).
  - `priority`: Ticket priority (low, normal, high, urgent).
  - `type`: Ticket type (question, incident, etc.).
  - `channel`: Channel the ticket was created from (email, web, etc.).
  - `assigneeId`: Assigned agent id (null if unassigned).
  - `requesterId`: Requester (end-user) id.
  - `groupId`: Group the ticket is routed to (null if unrouted).
  - `organizationId`: Organization id (null if none).
  - `tags`: Flat list of tags applied to the ticket.
  - `satisfactionScore`: Per-ticket CSAT score from the satisfaction_rating block (offered, good, bad, unoffered).
  - `createdAt`: When the ticket was created (Unix ms).
- **`zendesk_ticket_state_change`** _(event)_ - Ticket state-change events (created / solved) derived from each ticket.
  - Endpoint: `GET /api/v2/incremental/tickets/cursor.json`
  - Derived from each ticket’s timestamps; the scope is cleared and rewritten on every sync.
  - `ticketId`: The ticket the event belongs to.
  - `transition`: created or solved.
  - `status`: Ticket status at sync time.
  - `priority`: Ticket priority at sync time.
  - `assigneeId`: Assigned agent id at sync time (null if unassigned).
  - `groupId`: Group id at sync time (null if unrouted).
  - `channel`: Channel the ticket was created from.
- **`zendesk_satisfaction_rating`** _(entity)_ - Per-ticket customer satisfaction (CSAT) ratings with score and free-text comment.
  - Endpoint: `GET /api/v2/satisfaction_ratings.json`
  - `score`: Rating score (good, bad, offered).
  - `ticketId`: The ticket the rating is for.
  - `assigneeId`: Agent assigned at the time of rating.
  - `requesterId`: Requester (end-user) id.
  - `groupId`: Group id at the time of rating.
  - `hasComment`: Whether a free-text comment is set.
  - `createdAt`: When the rating was submitted (Unix ms).

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const zendesk = {
  name: 'zendesk',
  connectorId: 'zendesk',
  config: {
    subdomain: 'acme',
    email: 'agent@acme.com',
    apiToken: secret('ZENDESK_API_TOKEN'),
  },
};

export default defineConfig({
  connectors: [zendesk],
  dashboards: {
    support: defineDashboard({
      widgets: {
        open_tickets: {
          kind: 'stat',
          title: 'Open tickets',
          metric: defineMetric({
            connector: zendesk,
            shape: 'entity',
            entityType: 'zendesk_ticket',
            fn: 'count',
            filter: [{ field: 'status', op: 'eq', value: 'open' }],
          }),
        },
      },
    }),
  },
});
```

## Rate limits

Zendesk Support API enforces per-account quotas (default ~700 requests/minute on Professional plans, higher on Enterprise) and signals throttling via 429 with a Retry-After header; the shared HTTP client honors Retry-After on backoff.

## Limitations

- Ticket comment bodies and per-event audit transcripts are not synced.
- Zendesk Chat, Talk (voice), and Sell are separate product lines and are out of scope.
- Ticket state-change events are derived from each ticket’s timestamps (created, updated, solved); full audit-event history is not synced.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors/)
- [Zendesk API docs](https://developer.zendesk.com/api-reference/ticketing/introduction/)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
