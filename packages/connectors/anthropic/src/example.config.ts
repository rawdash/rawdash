import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const anthropic = {
  name: 'anthropic',
  connectorId: 'anthropic',
  config: {
    adminApiKey: secret('ANTHROPIC_ADMIN_API_KEY'),
  },
};

export default defineConfig({
  connectors: [anthropic],
  dashboards: {
    ai: defineDashboard({
      widgets: {
        spend_mtd: {
          kind: 'stat',
          title: 'Anthropic spend (last 30d)',
          window: '30d',
          metric: defineMetric({
            connector: anthropic,
            shape: 'metric',
            name: 'anthropic_cost_usd',
            fn: 'sum',
          }),
        },
        input_tokens_today: {
          kind: 'stat',
          title: 'Input tokens today',
          window: '1d',
          metric: defineMetric({
            connector: anthropic,
            shape: 'metric',
            name: 'anthropic_input_tokens',
            fn: 'sum',
          }),
        },
      },
    }),
  },
});
