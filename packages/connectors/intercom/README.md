<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-intercom

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-intercom)](https://www.npmjs.com/package/@rawdash/connector-intercom)
[![license](https://img.shields.io/npm/l/@rawdash/connector-intercom)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync conversations, contacts, teams, and admins from Intercom for support volume, response latency, and queue-depth analytics.

## Install

```sh
npm install @rawdash/connector-intercom
```

## Authentication

An Intercom access token (personal or app) with read access to conversations, contacts, teams, and admins.

1. Open Intercom → Settings → Developers → Developer Hub and create or select an app.
2. On the app's Authentication tab, copy the access token.
3. Ensure the token has read access for the resources you intend to sync.
4. Store the token as a secret and reference it from config as `accessToken: secret("INTERCOM_ACCESS_TOKEN")`.

## Configuration

| Field         | Type                 | Required | Description                                                                                                                                                                     |
| ------------- | -------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `accessToken` | secret               | Yes      | Intercom access token (personal or app) with read access to conversations, contacts, teams, and admins. Generate one at Settings → Developers → Developer Hub → Authentication. |
| `apiVersion`  | string               | No       | Value sent in the Intercom-Version header. Defaults to 2.11; pin a specific version here when upgrading deliberately.                                                           |
| `region`      | `us` \| `eu` \| `au` | No       | Intercom region of your workspace. Selects the API host: us → api.intercom.io, eu → api.eu.intercom.io, au → api.au.intercom.io.                                                |
| `resources`   | array                | No       | Which Intercom resources to sync. Omit to sync all of them. The access token only needs read scopes for the resources listed here.                                              |

## Resources

- **`intercom_admin`** _(entity)_ - Intercom teammates (admins) with seat and away state.
  - Endpoint: `GET /admins`
  - `name`: Admin display name.
  - `email`: Admin email address.
  - `jobTitle`: Admin job title.
  - `awayMode`: Whether away mode is enabled.
  - `hasInboxSeat`: Whether the admin has an inbox seat.
- **`intercom_team`** _(entity)_ - Inbox teams and their admin membership counts.
  - Endpoint: `GET /teams`
  - `name`: Team name.
  - `adminCount`: Number of admins on the team.
- **`intercom_contact`** _(entity)_ - Contacts (users and leads) with role and last-seen time.
  - Endpoint: `POST /contacts/search`
  - `role`: Contact role (user or lead).
  - `email`: Contact email address.
  - `externalId`: Your external identifier for the contact.
  - `createdAt`: When the contact was created (Unix ms).
  - `lastSeenAt`: When the contact was last seen (Unix ms).
- **`intercom_conversation`** _(entity)_ - Conversations with state, priority, assignment, reply-time statistics, and tags.
  - Endpoint: `POST /conversations/search`
  - `state`: Conversation state (open, snoozed, closed).
  - `priority`: Conversation priority.
  - `adminAssigneeId`: Assigned admin id (null if unassigned).
  - `teamAssigneeId`: Assigned team id (null if unassigned).
  - `createdAt`: When the conversation was created (Unix ms).
  - `firstContactReplyAt`: First contact reply time (Unix ms).
  - `firstAdminReplyAt`: First admin reply time (Unix ms).
  - `snoozedUntil`: Snooze expiry time (Unix ms), if snoozed.
  - `countAssignments`: Number of assignments.
  - `countReopens`: Number of reopens.
  - `countConversationParts`: Number of conversation parts.
  - `tags`: Flat list of tag names on the conversation.
- **`intercom_conversation_state_change`** _(event)_ - State-change events (created / assigned / closed / snoozed) derived from each conversation.
  - Endpoint: `POST /conversations/search`
  - Derived from each conversation’s statistics block; the scope is cleared and rewritten on every sync.
  - `conversationId`: The conversation the event belongs to.
  - `transition`: created, assigned, closed, or snoozed.
  - `state`: Conversation state at sync time.
  - `priority`: Conversation priority at sync time.
  - `adminAssigneeId`: Assigned admin id (null if unassigned).
  - `teamAssigneeId`: Assigned team id (null if unassigned).

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const intercom = {
  name: 'intercom',
  connectorId: 'intercom',
  config: {
    accessToken: secret('INTERCOM_ACCESS_TOKEN'),
    region: 'us',
    apiVersion: '2.11',
  },
};

export default defineConfig({
  connectors: [intercom],
  dashboards: {
    support: defineDashboard({
      widgets: {
        open_conversations: {
          kind: 'stat',
          title: 'Open conversations',
          metric: defineMetric({
            connector: intercom,
            shape: 'entity',
            entityType: 'intercom_conversation',
            fn: 'count',
            filter: [{ field: 'state', op: 'eq', value: 'open' }],
          }),
        },
      },
    }),
  },
});
```

## Rate limits

Intercom enforces per-app and per-workspace limits (default ~1000 requests/minute) and signals quota state via the X-RateLimit-\* response headers; the shared HTTP client backs off on 429, preferring X-RateLimit-Reset.

## Limitations

- Conversation message bodies and per-part transcripts are not synced.
- Help Center articles and outbound campaigns are out of scope.
- Full per-part state-transition history is not synced; state-change events are derived from each conversation’s statistics block.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors)
- [Intercom API docs](https://developers.intercom.com/docs/references/rest-api/api.intercom.io/)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
