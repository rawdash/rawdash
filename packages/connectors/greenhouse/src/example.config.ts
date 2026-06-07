import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const greenhouse = {
  name: 'greenhouse',
  connectorId: 'greenhouse',
  config: {
    apiKey: secret('GREENHOUSE_API_KEY'),
  },
};

export default defineConfig({
  connectors: [greenhouse],
  dashboards: {
    hiring: defineDashboard({
      widgets: {
        open_roles: {
          kind: 'stat',
          title: 'Open roles',
          metric: defineMetric({
            connector: greenhouse,
            shape: 'entity',
            entityType: 'greenhouse_job',
            fn: 'count',
            filter: [{ field: 'status', op: 'eq', value: 'open' }],
          }),
        },
        offers_extended: {
          kind: 'stat',
          title: 'Offers extended',
          metric: defineMetric({
            connector: greenhouse,
            shape: 'entity',
            entityType: 'greenhouse_offer',
            fn: 'count',
          }),
        },
      },
    }),
  },
});
