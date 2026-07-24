import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const productHunt = {
  name: 'product-hunt',
  connectorId: 'product-hunt',
  config: {
    apiToken: secret('PRODUCT_HUNT_API_TOKEN'),
    slugs: ['rawdash'],
  },
};

export default defineConfig({
  connectors: [productHunt],
  dashboards: {
    launch: defineDashboard({
      widgets: {
        upvotes: {
          kind: 'stat',
          title: 'Upvotes',
          window: '1d',
          metric: defineMetric({
            connector: productHunt,
            shape: 'metric',
            name: 'product_hunt_post_metrics',
            field: 'value',
            fn: 'max',
          }),
        },
        upvote_trajectory: {
          kind: 'timeseries',
          title: 'Upvote trajectory',
          window: '30d',
          metric: defineMetric({
            connector: productHunt,
            shape: 'metric',
            name: 'product_hunt_post_metrics',
            field: 'value',
            fn: 'max',
          }),
        },
        comments: {
          kind: 'stat',
          title: 'Comments',
          window: '1d',
          metric: defineMetric({
            connector: productHunt,
            shape: 'metric',
            name: 'product_hunt_post_metrics',
            field: 'comments',
            fn: 'max',
          }),
        },
      },
    }),
  },
});
