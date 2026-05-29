import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const awsCost = {
  name: 'aws-cost',
  connectorId: 'aws-cost',
  config: {
    accessKeyId: secret('AWS_ACCESS_KEY_ID'),
    secretAccessKey: secret('AWS_SECRET_ACCESS_KEY'),
    granularity: 'DAILY',
    groupBy: ['SERVICE'],
    lookbackDays: 90,
  },
};

export default defineConfig({
  connectors: [awsCost],
  dashboards: {
    finance: defineDashboard({
      widgets: {
        spend_by_service: {
          kind: 'stat',
          title: 'Total spend (last 30d)',
          metric: defineMetric({
            connector: awsCost,
            shape: 'metric',
            name: 'aws_cost_daily',
            fn: 'sum',
          }),
        },
      },
    }),
  },
});
