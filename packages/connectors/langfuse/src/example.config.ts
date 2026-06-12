import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const langfuse = {
  name: 'langfuse',
  connectorId: 'langfuse',
  config: {
    publicKey: 'pk-lf-...',
    secretKey: secret('LANGFUSE_SECRET_KEY'),
    host: 'https://cloud.langfuse.com',
  },
};

export default defineConfig({
  connectors: [langfuse],
  dashboards: {
    llm: defineDashboard({
      widgets: {
        daily_observations: {
          kind: 'timeseries',
          title: 'LLM observations per day',
          window: '30d',
          metric: defineMetric({
            connector: langfuse,
            shape: 'metric',
            name: 'langfuse_observations_per_day',
            fn: 'sum',
          }),
        },
      },
    }),
  },
});
