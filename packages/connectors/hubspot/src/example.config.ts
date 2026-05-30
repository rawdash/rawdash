import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const hubspot = {
  name: 'hubspot',
  connectorId: 'hubspot',
  config: {
    accessToken: secret('HUBSPOT_ACCESS_TOKEN'),
    resources: ['contacts', 'companies', 'deals'],
  },
};

export default defineConfig({
  connectors: [hubspot],
  dashboards: {
    sales: defineDashboard({
      widgets: {
        open_deals: {
          kind: 'stat',
          title: 'Open Deals',
          metric: defineMetric({
            connector: hubspot,
            shape: 'entity',
            entityType: 'hubspot_deal',
            fn: 'count',
          }),
        },
      },
    }),
  },
});
