import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const firebaseAnalytics = {
  name: 'firebaseAnalytics',
  connectorId: 'firebase-analytics',
  config: {
    propertyId: '123456789',
    firebaseAppId: '1:1234567890:web:abcdef1234567890',
    serviceAccountJson: secret('FIREBASE_ANALYTICS_SA_JSON'),
    lookbackDays: 90,
  },
};

export default defineConfig({
  connectors: [firebaseAnalytics],
  dashboards: {
    engagement: defineDashboard({
      widgets: {
        dau: {
          kind: 'timeseries',
          title: 'Daily active users',
          window: '30d',
          metric: defineMetric({
            connector: firebaseAnalytics,
            shape: 'metric',
            name: 'firebase_dau_wau_mau',
            fn: 'sum',
          }),
        },
      },
    }),
  },
});
