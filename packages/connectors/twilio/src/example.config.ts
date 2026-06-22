import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const twilio = {
  name: 'twilio',
  connectorId: 'twilio',
  config: {
    accountSid: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    authToken: secret('TWILIO_AUTH_TOKEN'),
  },
};

export default defineConfig({
  connectors: [twilio],
  dashboards: {
    messaging: defineDashboard({
      widgets: {
        spend_mtd: {
          kind: 'stat',
          title: 'Twilio spend (last 30d)',
          window: '30d',
          metric: defineMetric({
            connector: twilio,
            shape: 'metric',
            name: 'twilio_usage_price',
            fn: 'sum',
          }),
        },
        sends_today: {
          kind: 'stat',
          title: 'Usage count today',
          window: '1d',
          metric: defineMetric({
            connector: twilio,
            shape: 'metric',
            name: 'twilio_usage_count',
            fn: 'sum',
          }),
        },
      },
    }),
  },
});
