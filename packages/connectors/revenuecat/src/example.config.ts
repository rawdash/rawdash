import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const revenuecat = {
  name: 'revenuecat',
  connectorId: 'revenuecat',
  config: {
    apiKey: secret('REVENUECAT_API_KEY'),
    projectId: 'proj1ab2cd3',
    resources: ['products', 'customers', 'events', 'metrics'],
  },
};

export default defineConfig({
  connectors: [revenuecat],
  dashboards: {
    mobile_revenue: defineDashboard({
      widgets: {
        active_subscriptions: {
          kind: 'stat',
          title: 'Active subscriptions',
          metric: defineMetric({
            connector: revenuecat,
            shape: 'entity',
            entityType: 'revenuecat_subscription',
            fn: 'count',
            filter: [{ field: 'status', op: 'eq', value: 'active' }],
          }),
        },
      },
    }),
  },
});
