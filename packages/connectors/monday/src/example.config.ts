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
