import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const algolia = {
  name: 'algolia',
  connectorId: 'algolia',
  config: {
    appId: 'YourApplicationID',
    apiKey: secret('ALGOLIA_ANALYTICS_API_KEY'),
    indexes: ['products'],
    lookbackDays: 30,
  },
};

export default defineConfig({
  connectors: [algolia],
  dashboards: {
    search: defineDashboard({
      widgets: {
        searches: {
          kind: 'timeseries',
          title: 'Daily searches',
          window: '30d',
          metric: defineMetric({
            connector: algolia,
            shape: 'metric',
            name: 'algolia_search_count',
            fn: 'sum',
          }),
        },
        noResultRate: {
          kind: 'stat',
          title: 'No-result rate',
          window: '7d',
          metric: defineMetric({
            connector: algolia,
            shape: 'metric',
            name: 'algolia_no_results_rate',
            fn: 'avg',
          }),
        },
      },
    }),
  },
});
