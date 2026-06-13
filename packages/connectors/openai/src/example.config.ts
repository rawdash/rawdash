import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const openai = {
  name: 'openai',
  connectorId: 'openai',
  config: {
    adminApiKey: secret('OPENAI_ADMIN_API_KEY'),
  },
};

export default defineConfig({
  connectors: [openai],
  dashboards: {
    ai: defineDashboard({
      widgets: {
        spend_mtd: {
          kind: 'stat',
          title: 'OpenAI spend (last 30d)',
          window: '30d',
          metric: defineMetric({
            connector: openai,
            shape: 'metric',
            name: 'openai_cost_usd',
            fn: 'sum',
          }),
        },
        tokens_today: {
          kind: 'stat',
          title: 'Input tokens today',
          window: '1d',
          metric: defineMetric({
            connector: openai,
            shape: 'metric',
            name: 'openai_completions_input_tokens',
            fn: 'sum',
          }),
        },
      },
    }),
  },
});
