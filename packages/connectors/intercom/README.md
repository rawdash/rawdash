# @rawdash/connector-intercom

Rawdash connector for [Intercom](https://www.intercom.com) — syncs conversations, contacts, teams, and admins from the Intercom REST API into the six-shape storage model. Built for the support vertical: SMB teams using Intercom as their front-line inbox can chart conversation volume, queue depth, response latency, and tag/team distributions.

## Auth setup

The connector authenticates with an **access token** (personal access token or app access token).

1. In Intercom, open **Settings → Developers → Developer Hub**.
2. Either create a new app or open an existing one.
3. On the app's **Authentication** tab, copy the **Access token**.
4. Make sure the token has read access for the resources you want to sync (conversations, contacts, admins, teams).

Tokens issued from a Developer Hub app belong to the workspace that authorized the app; rotate them from the same screen if compromised.

## Configuration

```ts
import { secret } from '@rawdash/core';

const intercom = {
  name: 'intercom',
  connectorId: 'intercom',
  config: {
    accessToken: secret('INTERCOM_ACCESS_TOKEN'),
    // region: 'eu',                         // optional, defaults to 'us'
    // apiVersion: '2.11',                   // optional, defaults to '2.11'
    // resources: ['conversations', 'admins'], // optional, defaults to all
  },
};
```

Register the connector class when mounting the engine:

```ts
import { IntercomConnector } from '@rawdash/connector-intercom';
import { mountEngine } from '@rawdash/hono';

mountEngine(config, { connectorRegistry: { intercom: IntercomConnector } });
```

### Region

Set `region` to match the data residency of your Intercom workspace. The connector routes every request to the matching host:

| `region` | Host                          |
| -------- | ----------------------------- |
| `us`     | `https://api.intercom.io`     |
| `eu`     | `https://api.eu.intercom.com` |
| `au`     | `https://api.au.intercom.com` |

### Choosing resources

By default the connector syncs every supported resource. Pass `resources` to sync only a subset:

`admins`, `teams`, `contacts`, `conversations`, `conversation_events`

The access token only needs read scopes for the resources you list. `conversation_events` is derived from the same `/conversations/search` payload as `conversations`; disable it to skip the second pass.

### Configuration reference

| Field         | Required | Description                                                                    |
| ------------- | -------- | ------------------------------------------------------------------------------ |
| `accessToken` | yes      | Intercom access token (secret). Bearer-authenticated.                          |
| `region`      | no       | Intercom region: `us`, `eu`, or `au`. Defaults to `us`.                        |
| `apiVersion`  | no       | Value sent in the `Intercom-Version` header (e.g. `2.11`). Defaults to `2.11`. |
| `resources`   | no       | Subset of resources to sync. Omit for all.                                     |

### Example dashboard

```ts
import { defineConfig, defineDashboard, defineMetric } from '@rawdash/core';

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
        conversations_today: {
          kind: 'stat',
          title: 'Conversations today',
          metric: defineMetric({
            connector: intercom,
            shape: 'event',
            name: 'intercom_conversation_state_change',
            field: 'start_ts',
            fn: 'count',
            window: '1d',
            filter: [{ field: 'transition', op: 'eq', value: 'created' }],
          }),
        },
        conversation_volume: {
          kind: 'timeseries',
          title: 'Conversation volume (7d)',
          window: '7d',
          metric: defineMetric({
            connector: intercom,
            shape: 'event',
            name: 'intercom_conversation_state_change',
            field: 'start_ts',
            fn: 'count',
            window: '7d',
            filter: [{ field: 'transition', op: 'eq', value: 'created' }],
            groupBy: { field: 'start_ts', granularity: 'day' },
          }),
        },
        conversations_by_team: {
          kind: 'distribution',
          title: 'Open conversations by team',
          metric: defineMetric({
            connector: intercom,
            shape: 'entity',
            entityType: 'intercom_conversation',
            fn: 'count',
            filter: [{ field: 'state', op: 'eq', value: 'open' }],
            groupBy: { field: 'teamAssigneeId' },
          }),
        },
      },
    }),
  },
});
```

## Data model

Timestamps stored in attributes are Unix milliseconds (Intercom returns Unix seconds; the connector multiplies by 1000 at write time).

| Storage shape | Entity/event type                    | Key attributes                                                                                                                     |
| ------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| entity        | `intercom_admin`                     | name, email, jobTitle, awayMode, hasInboxSeat                                                                                      |
| entity        | `intercom_team`                      | name, adminCount                                                                                                                   |
| entity        | `intercom_contact`                   | role, email, externalId, createdAt, lastSeenAt                                                                                     |
| entity        | `intercom_conversation`              | state, priority, adminAssigneeId, teamAssigneeId, createdAt, firstContactReplyAt, firstAdminReplyAt, snoozedUntil, count\*, tags[] |
| event         | `intercom_conversation_state_change` | conversationId, transition (`created` / `assigned` / `closed` / `snoozed`), state, priority, adminAssigneeId, teamAssigneeId       |

- **`intercom_conversation_state_change`** events are derived from the conversation's `statistics` block — one event per known transition timestamp (`created_at`, `last_assignment_at`, `last_close_at`, and `snoozed_until` when the conversation is currently snoozed). The event scope is cleared and rewritten on every sync, so each tick produces the latest snapshot of those transitions per conversation. Full per-part transition history requires a separate `/conversations/{id}` fetch and is intentionally out of scope for v0.1.
- **`intercom_conversation`** carries the rolled-up statistics (`countAssignments`, `countReopens`, `countConversationParts`) and tag names so distribution widgets can group by tag without a join.

## Schemas

`IntercomConnector.schemas` declares the Zod schema for each resource's raw API response (the admin / team / contact / conversation record arrays). Used by the cloud shape-drift pipeline to populate `connector_baselines`, and by the package's property tests.

## Sync behaviour

- **Backfill** (`mode: 'full'`): admins and teams come from `GET /admins` / `GET /teams` in a single page. Contacts and conversations stream through `POST /contacts/search` / `POST /conversations/search` with no query filter, sorted by `updated_at` ascending and paginated with the API's `starting_after` cursor.
- **Incremental** (`mode: 'latest'`): contact and conversation searches add a `query: { field: 'updated_at', operator: '>', value: <since> }` clause (Unix seconds), so only records modified since the last sync are returned. Entity phases upsert by id (no scope clear); `conversation_events` always clears and rewrites its scope.
- **Resumable**: each search phase yields a `starting_after` string cursor on abort, so an interrupted sync resumes from the same page. Admins and teams are single-shot.
- **Rate limits**: Intercom enforces 1000 requests/minute per access token and returns `429` with a `Retry-After` header when exceeded. The shared HTTP client retries automatically with exponential back-off and honors `Retry-After`.

## Registering in the MCP server

To make the connector available via the `add_connector` MCP tool, include it in `connectorFactories`:

```ts
import { IntercomConnector, configFields } from '@rawdash/connector-intercom';

createMcpServer({
  // ...
  connectorFactories: [
    {
      id: 'intercom',
      configFields,
      create: IntercomConnector.create,
    },
  ],
});
```

## Property tests

`admins`, `teams`, `contacts`, and `conversations` have fast-check property tests under `src/property.test.ts` that generate synthetic API payloads from each resource's Zod schema, run them through `connector.sync()` against an `InMemoryStorage`, and assert universal invariants (non-empty ids, finite timestamps, no `undefined` in storage, no thrown errors) plus per-resource entity counts. State-change event mapping and the `since`/cursor wiring are covered by example-driven unit tests in `src/intercom.test.ts`.

## Out of scope

- Conversation message bodies and per-part transcripts — not dashboard-shaped.
- Help Center articles, knowledge base content, and outbound campaigns — covered by separate Intercom APIs that don't aggregate well.
- Full per-part state-transition history — would require an extra `GET /conversations/{id}` call per conversation and is deferred.
