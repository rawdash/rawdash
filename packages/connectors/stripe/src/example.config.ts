import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const stripe = {
  name: 'stripe',
  connectorId: 'stripe',
  config: {
    apiKey: secret('STRIPE_API_KEY'),
    resources: ['customers', 'subscriptions', 'invoices', 'charges'],
  },
};

export default defineConfig({
  connectors: [stripe],
  dashboards: {
    revenue: defineDashboard({
      widgets: {
        active_subscriptions: {
          kind: 'stat',
          title: 'Active subscriptions',
          metric: defineMetric({
            connector: stripe,
            shape: 'entity',
            entityType: 'stripe_subscription',
            fn: 'count',
            filter: [{ field: 'status', op: 'eq', value: 'active' }],
          }),
        },
      },
    }),
  },
});
