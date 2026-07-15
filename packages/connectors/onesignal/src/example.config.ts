import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const onesignal = {
  name: 'onesignal',
  connectorId: 'onesignal',
  config: {
    apiKey: secret('ONESIGNAL_REST_API_KEY'),
    appId: '00000000-0000-0000-0000-000000000000',
    lookbackDays: 90,
  },
};

export default defineConfig({
  connectors: [onesignal],
  dashboards: {
    messaging: defineDashboard({
      widgets: {
        sends_7d: {
          kind: 'stat',
          title: 'Recipients targeted (7d)',
          window: '7d',
          metric: defineMetric({
            connector: onesignal,
            shape: 'metric',
            name: 'onesignal_notification_stats',
            field: 'value',
            fn: 'sum',
          }),
        },
        daily_delivered: {
          kind: 'timeseries',
          title: 'Delivered per day',
          window: '30d',
          metric: defineMetric({
            connector: onesignal,
            shape: 'metric',
            name: 'onesignal_notification_stats',
            field: 'delivered',
            fn: 'sum',
          }),
        },
      },
    }),
  },
});
