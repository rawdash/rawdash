<!-- This file is generated from connector metadata by scripts/generate-connector-docs.ts. Do not edit by hand. -->

# @rawdash/connector-discord

[![npm version](https://img.shields.io/npm/v/@rawdash/connector-discord)](https://www.npmjs.com/package/@rawdash/connector-discord)
[![license](https://img.shields.io/npm/l/@rawdash/connector-discord)](https://github.com/rawdash/rawdash/blob/main/LICENSE)

Sync Discord members, joins and removals, channels, and per-channel message volume for community-health dashboards.

## Install

```sh
npm install @rawdash/connector-discord
```

## Authentication

Authenticates with a bot token sent as a `Bot` credential. The bot must be a member of the guild and, to enumerate members, must have the privileged Server Members Intent enabled and the View Audit Log permission to read member removals.

1. Open the Discord Developer Portal (https://discord.com/developers/applications) and create an application.
2. Under Bot, add a bot and copy its token. Enable the "Server Members Intent" toggle so the members endpoint returns data.
3. Under OAuth2 -> URL Generator, select the `bot` scope with at least "View Channels", "Read Message History", and "View Audit Log" permissions, then install the bot into your server.
4. Store the token as a secret and reference it from the connector config as `botToken: secret("DISCORD_BOT_TOKEN")`.
5. Enable Developer Mode in Discord (Settings -> Advanced), right-click your server, choose "Copy Server ID", and set it as `guildId`.

## Configuration

| Field                   | Type   | Required | Description                                                                                                                                                                                |
| ----------------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `botToken`              | secret | Yes      | Discord bot token for a bot installed in the guild. Create an application at the Discord Developer Portal, add a bot, and copy its token.                                                  |
| `guildId`               | string | Yes      | The Discord server (guild) ID to sync. Enable Developer Mode in Discord, then right-click the server and choose "Copy Server ID".                                                          |
| `lookbackDays`          | number | No       | How many days of message volume and member-removal events to sync. Defaults to 7. Message metrics are rewritten over this rolling window on every sync.                                    |
| `maxMessagesPerChannel` | number | No       | Safety cap on how many recent messages are scanned per channel per sync. Defaults to 2000.                                                                                                 |
| `messageChannelIds`     | array  | No       | Restrict message-volume scanning to these channel IDs. Omit to scan every readable text channel in the guild.                                                                              |
| `resources`             | array  | No       | Which Discord resources to sync. Omit to sync all of them. 'member_events' join events are derived from the member scan, so enabling it walks members even when 'members' is not selected. |

## Resources

- **`discord_channel`** _(entity)_ - Guild channels with name, kind (text, voice, category, announcement, forum, stage), position, parent category, and topic.
  - Endpoint: `GET /guilds/{guildId}/channels`
  - `name`: Channel name.
  - `kind`: Channel kind label (text, voice, category, announcement, forum, stage, thread, other).
  - `type`: Raw Discord channel type number.
  - `position`: Sort position within the guild.
  - `parentId`: Parent category channel ID, if any.
  - `topic`: Channel topic.
  - `nsfw`: Whether the channel is marked NSFW.
- **`discord_member`** _(entity)_ - Guild members with username, display name, nickname, join time, roles, and bot flag.
  - Endpoint: `GET /guilds/{guildId}/members`
  - Requires the privileged Server Members Intent. Paginated with the `after` cursor. joinedAt is Unix epoch milliseconds.
  - `username`: Discord username.
  - `globalName`: Global display name, if set.
  - `nick`: Guild-specific nickname, if set.
  - `joinedAt`: Join time (epoch ms).
  - `roles`: Role IDs assigned in the guild.
  - `isBot`: Whether the member is a bot.
- **`discord_member_event`** _(event)_ - Member lifecycle events: joins (derived from member join timestamps) and removals (kicks and bans read from the audit log).
  - Endpoint: `GET /guilds/{guildId}/audit-logs`
  - Join events are derived from the member scan and rewritten every sync. Kicks (action_type 20) and bans (action_type 22) come from the audit log within the lookback window. start_ts is the event time in Unix epoch milliseconds. Voluntary leaves require the realtime gateway and are out of scope.
  - `action`: Event action: join, kick, or ban.
  - `userId`: ID of the member the event is about.
  - `username`: Username of the member, if known.
  - `actorId`: ID of the moderator who performed a kick or ban.
  - `reason`: Audit-log reason for a kick or ban.
- **`discord_messages_per_day`** _(metric)_ - Daily message volume per channel from the REST message-history endpoint, one sample per (day, channel). The sample value is the message count; distinct authors is exposed as an attribute.
  - Endpoint: `GET /channels/{channelId}/messages`
  - Unit: messages
  - Granularity: 1d
  - Dimensions: `channelId`, `channelName`, `distinctAuthors`
  - Aggregated by UTC day over a rolling lookback window and rewritten on every sync. Only readable text and announcement channels are scanned, capped by maxMessagesPerChannel.

## Example

```ts
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const discord = {
  name: 'discord',
  connectorId: 'discord',
  config: {
    botToken: secret('DISCORD_BOT_TOKEN'),
    guildId: '123456789012345678',
  },
};

export default defineConfig({
  connectors: [discord],
  dashboards: {
    community: defineDashboard({
      widgets: {
        members: {
          kind: 'stat',
          title: 'Members',
          metric: defineMetric({
            connector: discord,
            shape: 'entity',
            entityType: 'discord_member',
            fn: 'count',
          }),
        },
        joins_per_day: {
          kind: 'timeseries',
          title: 'Joins per day',
          window: '30d',
          granularity: 'day',
          metric: defineMetric({
            connector: discord,
            shape: 'event',
            name: 'discord_member_event',
            fn: 'count',
            filter: [{ field: 'action', op: 'eq', value: 'join' }],
          }),
        },
        messages_per_day: {
          kind: 'timeseries',
          title: 'Messages per day',
          window: '7d',
          granularity: 'day',
          metric: defineMetric({
            connector: discord,
            shape: 'metric',
            name: 'discord_messages_per_day',
            fn: 'sum',
          }),
        },
      },
    }),
  },
});
```

## Rate limits

Discord enforces dynamic per-route rate limits and returns HTTP 429 with a Retry-After header when exceeded; the shared HTTP client honors it with backoff. Message-volume scanning fetches recent messages per text channel, so request volume scales with channel count and the lookback window.

## Limitations

- Message volume is derived from the REST message-history endpoint over a rolling lookback window (default 7 days) and is rewritten on every sync, so per-day counts outside the window age out. Scanning is capped per channel by `maxMessagesPerChannel`.
- Member join events are derived from each current member's join timestamp; voluntary leaves are only observable via the realtime gateway and are out of scope. Kicks and bans are read from the audit log within the lookback window.
- The members endpoint requires the privileged Server Members Intent; without it Discord returns no members and the member and join-event resources stay empty.

## Links

- [Rawdash docs](https://rawdash.dev/docs/connectors)
- [Discord API docs](https://discord.com/developers/docs/intro)
- [GitHub](https://github.com/rawdash/rawdash)

## License

Apache-2.0
