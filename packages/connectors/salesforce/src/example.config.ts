import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const salesforce = {
  name: 'salesforce',
  connectorId: 'salesforce',
  config: {
    clientId: '3MVG9_consumerKey_...',
    clientSecret: secret('SF_CLIENT_SECRET'),
    refreshToken: secret('SF_REFRESH_TOKEN'),
    instanceUrl: 'https://mycompany.my.salesforce.com',
  },
};

export default defineConfig({
  connectors: [salesforce],
  dashboards: {
    sales: defineDashboard({
      widgets: {
        open_pipeline: {
          kind: 'stat',
          title: 'Open pipeline value',
          metric: defineMetric({
            connector: salesforce,
            shape: 'entity',
            entityType: 'salesforce_opportunity',
            field: 'amount',
            fn: 'sum',
            filter: [{ field: 'isClosed', op: 'eq', value: false }],
          }),
        },
        win_rate: {
          kind: 'stat',
          title: 'Won opportunities',
          metric: defineMetric({
            connector: salesforce,
            shape: 'entity',
            entityType: 'salesforce_opportunity',
            fn: 'count',
            filter: [{ field: 'isWon', op: 'eq', value: true }],
          }),
        },
      },
    }),
  },
});
