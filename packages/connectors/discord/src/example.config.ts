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
