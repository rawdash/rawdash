import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const metaAds = {
  name: 'metaAds',
  connectorId: 'meta-ads',
  config: {
    adAccountId: 'act_1234567890',
    accessToken: secret('META_ACCESS_TOKEN'),
    lookbackDays: 90,
  },
};

export default defineConfig({
  connectors: [metaAds],
  dashboards: {
    marketing: defineDashboard({
      widgets: {
        spend_30d: {
          kind: 'stat',
          title: 'Meta Ads spend (30d)',
          window: '30d',
          metric: defineMetric({
            connector: metaAds,
            shape: 'metric',
            name: 'meta_campaign_insights',
            field: 'spend',
            fn: 'sum',
          }),
        },
        daily_spend: {
          kind: 'timeseries',
          title: 'Daily Meta Ads spend',
          window: '30d',
          metric: defineMetric({
            connector: metaAds,
            shape: 'metric',
            name: 'meta_campaign_insights',
            field: 'spend',
            fn: 'sum',
          }),
        },
      },
    }),
  },
});
