import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const messaging = {
  name: 'messaging',
  connectorId: 'firebase-cloud-messaging',
  config: {
    serviceAccountJson: secret('FIREBASE_SA_JSON'),
    projectId: 'my-firebase-project',
    bqDataset: 'firebase_messaging',
    bqLocation: 'US',
    lookbackDays: 90,
    topTopicsLimit: 100,
  },
};

export default defineConfig({
  connectors: [messaging],
  dashboards: {
    messaging: defineDashboard({
      widgets: {
        sends: {
          kind: 'stat',
          title: 'Push sends (last 7d)',
          metric: defineMetric({
            connector: messaging,
            shape: 'metric',
            name: 'messages_per_day',
            fn: 'sum',
          }),
        },
      },
    }),
  },
});
