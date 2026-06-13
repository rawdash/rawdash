import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const langsmith = {
  name: 'langsmith',
  connectorId: 'langsmith',
  config: {
    apiKey: secret('LANGSMITH_API_KEY'),
    endpoint: 'https://api.smith.langchain.com',
    lookbackDays: 30,
  },
};

export default defineConfig({
  connectors: [langsmith],
  dashboards: {
    llm_observability: defineDashboard({
      widgets: {
        runs_today: {
          kind: 'stat',
          title: 'Runs today',
          metric: defineMetric({
            connector: langsmith,
            shape: 'metric',
            name: 'langsmith_runs_per_day',
            fn: 'sum',
            field: 'count',
          }),
        },
        spend_today: {
          kind: 'stat',
          title: 'LLM spend today (USD)',
          metric: defineMetric({
            connector: langsmith,
            shape: 'metric',
            name: 'langsmith_runs_per_day',
            fn: 'sum',
            field: 'costUsd',
          }),
        },
      },
    }),
  },
});
