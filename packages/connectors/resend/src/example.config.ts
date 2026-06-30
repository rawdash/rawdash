import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const resend = {
  name: 'resend',
  connectorId: 'resend',
  config: {
    apiKey: secret('RESEND_API_KEY'),
    lookbackDays: 90,
  },
};

export default defineConfig({
  connectors: [resend],
  dashboards: {
    email: defineDashboard({
      widgets: {
        sent_7d: {
          kind: 'stat',
          title: 'Emails sent (7d)',
          window: '7d',
          metric: defineMetric({
            connector: resend,
            shape: 'event',
            name: 'resend_email',
            fn: 'count',
          }),
        },
        daily_sent: {
          kind: 'timeseries',
          title: 'Daily emails sent',
          window: '30d',
          metric: defineMetric({
            connector: resend,
            shape: 'event',
            name: 'resend_email',
            fn: 'count',
          }),
        },
      },
    }),
  },
});
