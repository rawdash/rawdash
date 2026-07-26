import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const pipedrive = {
  name: 'pipedrive',
  connectorId: 'pipedrive',
  config: {
    companyDomain: 'acme',
    apiToken: secret('PIPEDRIVE_API_TOKEN'),
    resources: ['deals', 'pipelines', 'activities'],
  },
};

export default defineConfig({
  connectors: [pipedrive],
  dashboards: {
    sales: defineDashboard({
      widgets: {
        open_deals: {
          kind: 'stat',
          title: 'Open Deals',
          metric: defineMetric({
            connector: pipedrive,
            shape: 'entity',
            entityType: 'pipedrive_deal',
            fn: 'count',
          }),
        },
      },
    }),
  },
});
