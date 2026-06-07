import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const mailchimp = {
  name: 'mailchimp',
  connectorId: 'mailchimp',
  config: {
    apiKey: secret('MAILCHIMP_API_KEY'),
  },
};

export default defineConfig({
  connectors: [mailchimp],
  dashboards: {
    marketing: defineDashboard({
      widgets: {
        emails_sent: {
          kind: 'stat',
          title: 'Emails sent (last 30d)',
          metric: defineMetric({
            connector: mailchimp,
            shape: 'metric',
            name: 'mailchimp_campaign_stats',
            fn: 'sum',
          }),
        },
      },
    }),
  },
});
