import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const sendgrid = {
  name: 'sendgrid',
  connectorId: 'sendgrid',
  config: {
    apiKey: secret('SENDGRID_API_KEY'),
  },
};

export default defineConfig({
  connectors: [sendgrid],
  dashboards: {
    email: defineDashboard({
      widgets: {
        sends: {
          kind: 'stat',
          title: 'Emails sent (last 30d)',
          metric: defineMetric({
            connector: sendgrid,
            shape: 'metric',
            name: 'sendgrid_email_stats',
            field: 'requests',
            fn: 'sum',
          }),
        },
        bounces: {
          kind: 'stat',
          title: 'Bounces (last 30d)',
          metric: defineMetric({
            connector: sendgrid,
            shape: 'event',
            name: 'sendgrid_bounce',
            fn: 'count',
          }),
        },
        daily_volume: {
          kind: 'timeseries',
          title: 'Daily email volume',
          window: '30d',
          metric: defineMetric({
            connector: sendgrid,
            shape: 'metric',
            name: 'sendgrid_email_stats',
            field: 'requests',
            fn: 'sum',
          }),
        },
      },
    }),
  },
});
