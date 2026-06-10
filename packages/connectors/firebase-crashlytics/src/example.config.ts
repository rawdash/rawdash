import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const crashlytics = {
  name: 'crashlytics',
  connectorId: 'firebase-crashlytics',
  config: {
    serviceAccountJson: secret('FIREBASE_SA_JSON'),
    projectId: 'my-firebase-project',
    bqDataset: 'firebase_crashlytics',
    bqLocation: 'US',
    lookbackDays: 90,
    topIssuesLimit: 50,
  },
};

export default defineConfig({
  connectors: [crashlytics],
  dashboards: {
    mobile: defineDashboard({
      widgets: {
        crashes: {
          kind: 'stat',
          title: 'Crashes (last 7d)',
          metric: defineMetric({
            connector: crashlytics,
            shape: 'metric',
            name: 'crashes_per_day',
            fn: 'sum',
          }),
        },
      },
    }),
  },
});
