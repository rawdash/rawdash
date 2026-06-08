import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const netlify = {
  name: 'netlify',
  connectorId: 'netlify',
  config: {
    apiToken: secret('NETLIFY_API_TOKEN'),
    deploysLookbackDays: 30,
  },
};

export default defineConfig({
  connectors: [netlify],
  dashboards: {
    infrastructure: defineDashboard({
      widgets: {
        deploys: {
          kind: 'stat',
          title: 'Deploys',
          metric: defineMetric({
            connector: netlify,
            shape: 'event',
            name: 'netlify_deploy_event',
            fn: 'count',
          }),
        },
      },
    }),
  },
});
