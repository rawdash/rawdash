import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const googleSearchConsole = {
  name: 'googleSearchConsole',
  connectorId: 'google-search-console',
  config: {
    siteUrl: 'https://example.com/',
    serviceAccountJson: secret('GSC_SERVICE_ACCOUNT_JSON'),
    lookbackDays: 90,
  },
};

export default defineConfig({
  connectors: [googleSearchConsole],
  dashboards: {
    seo: defineDashboard({
      widgets: {
        clicks: {
          kind: 'timeseries',
          title: 'Daily search clicks',
          window: '30d',
          metric: defineMetric({
            connector: googleSearchConsole,
            shape: 'metric',
            name: 'gsc_search_analytics_by_day',
            fn: 'sum',
          }),
        },
      },
    }),
  },
});
