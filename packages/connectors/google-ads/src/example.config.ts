import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const googleAds = {
  name: 'googleAds',
  connectorId: 'google-ads',
  config: {
    customerId: '1234567890',
    clientId: '1234567890-abcdef.apps.googleusercontent.com',
    clientSecret: secret('GADS_CLIENT_SECRET'),
    refreshToken: secret('GADS_REFRESH_TOKEN'),
    developerToken: secret('GADS_DEVELOPER_TOKEN'),
    lookbackDays: 90,
  },
};

export default defineConfig({
  connectors: [googleAds],
  dashboards: {
    paid: defineDashboard({
      widgets: {
        spend_30d: {
          kind: 'timeseries',
          title: 'Ad spend (last 30 days)',
          window: '30d',
          metric: defineMetric({
            connector: googleAds,
            shape: 'metric',
            name: 'google_ads_campaign_metrics',
            fn: 'sum',
          }),
        },
      },
    }),
  },
});
