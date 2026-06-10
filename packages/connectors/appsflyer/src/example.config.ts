import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const appsflyer = {
  name: 'appsflyer',
  connectorId: 'appsflyer',
  config: {
    appId: 'id1234567890',
    apiToken: secret('APPSFLYER_API_TOKEN'),
    lookbackDays: 90,
  },
};

export default defineConfig({
  connectors: [appsflyer],
  dashboards: {
    mobile: defineDashboard({
      widgets: {
        installs_30d: {
          kind: 'stat',
          title: 'AppsFlyer installs (30d)',
          window: '30d',
          metric: defineMetric({
            connector: appsflyer,
            shape: 'metric',
            name: 'appsflyer_install_metrics',
            field: 'installs',
            fn: 'sum',
          }),
        },
        daily_installs: {
          kind: 'timeseries',
          title: 'Daily installs by media source',
          window: '30d',
          metric: defineMetric({
            connector: appsflyer,
            shape: 'metric',
            name: 'appsflyer_install_metrics',
            field: 'installs',
            fn: 'sum',
          }),
        },
      },
    }),
  },
});
