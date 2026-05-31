import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const vercel = {
  name: 'vercel',
  connectorId: 'vercel',
  config: {
    apiToken: secret('VERCEL_TOKEN'),
    teamId: 'team_abc123',
    deploymentsLookbackDays: 30,
  },
};

export default defineConfig({
  connectors: [vercel],
  dashboards: {
    infrastructure: defineDashboard({
      widgets: {
        deployments: {
          kind: 'stat',
          title: 'Deployments',
          metric: defineMetric({
            connector: vercel,
            shape: 'event',
            name: 'vercel_deployment_event',
            fn: 'count',
          }),
        },
      },
    }),
  },
});
