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
