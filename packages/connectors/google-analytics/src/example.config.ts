import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const googleAnalytics = {
  name: 'googleAnalytics',
  connectorId: 'google-analytics',
  config: {
    propertyId: '123456789',
    serviceAccountJson: secret('GA4_SERVICE_ACCOUNT_JSON'),
    lookbackDays: 90,
  },
};

export default defineConfig({
  connectors: [googleAnalytics],
  dashboards: {
    traffic: defineDashboard({
      widgets: {
        sessions: {
          kind: 'timeseries',
          title: 'Daily sessions',
          window: '30d',
          metric: defineMetric({
            connector: googleAnalytics,
            shape: 'metric',
            name: 'ga4_traffic_by_day',
            fn: 'sum',
          }),
        },
      },
    }),
  },
});
