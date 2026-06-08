import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const azureCost = {
  name: 'azure-cost',
  connectorId: 'azure-cost',
  config: {
    tenantId: '00000000-0000-0000-0000-000000000000',
    clientId: '00000000-0000-0000-0000-000000000000',
    clientSecret: secret('AZ_CLIENT_SECRET'),
    subscriptionId: '00000000-0000-0000-0000-000000000000',
    groupBy: ['ServiceName'],
  },
};

export default defineConfig({
  connectors: [azureCost],
  dashboards: {
    finance: defineDashboard({
      widgets: {
        spend_30d: {
          kind: 'stat',
          title: 'Azure spend (30d)',
          window: '30d',
          metric: defineMetric({
            connector: azureCost,
            shape: 'metric',
            name: 'azure_cost_daily',
            fn: 'sum',
          }),
        },
      },
    }),
  },
});
