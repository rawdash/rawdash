import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const bedrock = {
  name: 'bedrock',
  connectorId: 'aws-bedrock',
  config: {
    region: 'us-east-1',
    accessKeyId: secret('AWS_ACCESS_KEY_ID'),
    secretAccessKey: secret('AWS_SECRET_ACCESS_KEY'),
    lookbackDays: 30,
  },
};

export default defineConfig({
  connectors: [bedrock],
  dashboards: {
    ai: defineDashboard({
      widgets: {
        spend_mtd: {
          kind: 'stat',
          title: 'Bedrock spend (last 30d)',
          metric: defineMetric({
            connector: bedrock,
            shape: 'metric',
            name: 'bedrock_spend',
            fn: 'sum',
          }),
        },
        invocations_trend: {
          kind: 'timeseries',
          title: 'Invocations per day',
          window: '30d',
          metric: defineMetric({
            connector: bedrock,
            shape: 'metric',
            name: 'bedrock_invocations',
            fn: 'sum',
          }),
        },
      },
    }),
  },
});
