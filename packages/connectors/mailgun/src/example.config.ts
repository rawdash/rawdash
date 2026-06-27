import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const mailgun = {
  name: 'mailgun',
  connectorId: 'mailgun',
  config: {
    apiKey: secret('MAILGUN_API_KEY'),
    domain: 'mg.example.com',
    region: 'us' as const,
    lookbackDays: 90,
  },
};

export default defineConfig({
  connectors: [mailgun],
  dashboards: {
    email: defineDashboard({
      widgets: {
        sends_30d: {
          kind: 'stat',
          title: 'Emails sent (30d)',
          window: '30d',
          metric: defineMetric({
            connector: mailgun,
            shape: 'metric',
            name: 'mailgun_email_stats',
            field: 'value',
            fn: 'sum',
          }),
        },
        daily_sends: {
          kind: 'timeseries',
          title: 'Daily email volume',
          window: '30d',
          metric: defineMetric({
            connector: mailgun,
            shape: 'metric',
            name: 'mailgun_email_stats',
            field: 'value',
            fn: 'sum',
          }),
        },
      },
    }),
  },
});
