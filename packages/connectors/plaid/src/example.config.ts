import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const plaid = {
  name: 'plaid',
  connectorId: 'plaid',
  config: {
    clientId: '5f1a2b3c4d5e6f0011223344',
    secret: secret('PLAID_SECRET'),
    accessToken: secret('PLAID_ACCESS_TOKEN'),
    environment: 'production' as const,
    resources: ['accounts', 'transactions'] as const,
  },
};

export default defineConfig({
  connectors: [plaid],
  dashboards: {
    cash: defineDashboard({
      widgets: {
        accounts_tracked: {
          kind: 'stat',
          title: 'Accounts tracked',
          metric: defineMetric({
            connector: plaid,
            shape: 'entity',
            entityType: 'plaid_account',
            fn: 'count',
          }),
        },
        spend_this_month: {
          kind: 'stat',
          title: 'Spend this month',
          metric: defineMetric({
            connector: plaid,
            shape: 'event',
            name: 'plaid_transaction',
            fn: 'sum',
            field: 'amount',
          }),
        },
      },
    }),
  },
});
