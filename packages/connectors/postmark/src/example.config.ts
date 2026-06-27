import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const postmark = {
  name: 'postmark',
  connectorId: 'postmark',
  config: {
    serverToken: secret('POSTMARK_SERVER_TOKEN'),
    lookbackDays: 90,
  },
};

export default defineConfig({
  connectors: [postmark],
  dashboards: {
    email: defineDashboard({
      widgets: {
        sent_30d: {
          kind: 'stat',
          title: 'Emails sent (30d)',
          window: '30d',
          metric: defineMetric({
            connector: postmark,
            shape: 'metric',
            name: 'postmark_email_stats',
            field: 'value',
            fn: 'sum',
          }),
        },
        daily_sent: {
          kind: 'timeseries',
          title: 'Daily emails sent',
          window: '30d',
          metric: defineMetric({
            connector: postmark,
            shape: 'metric',
            name: 'postmark_email_stats',
            field: 'value',
            fn: 'sum',
          }),
        },
      },
    }),
  },
});
