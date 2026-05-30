import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const linear = {
  name: 'linear',
  connectorId: 'linear',
  config: {
    apiKey: secret('LINEAR_API_KEY'),
  },
};

export default defineConfig({
  connectors: [linear],
  dashboards: {
    product: defineDashboard({
      widgets: {
        open_issues: {
          kind: 'stat',
          title: 'In-progress issues',
          metric: defineMetric({
            connector: linear,
            shape: 'entity',
            entityType: 'linear_issue',
            fn: 'count',
            filter: [{ field: 'stateType', op: 'eq', value: 'started' }],
          }),
        },
      },
    }),
  },
});
