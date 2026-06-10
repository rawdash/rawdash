import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const googlePlayConsole = {
  name: 'googlePlayConsole',
  connectorId: 'google-play-console',
  config: {
    packageName: 'com.example.app',
    serviceAccountJson: secret('GPLAY_SA_JSON'),
    lookbackDays: 30,
  },
};

export default defineConfig({
  connectors: [googlePlayConsole],
  dashboards: {
    mobile: defineDashboard({
      widgets: {
        crashRate: {
          kind: 'timeseries',
          title: 'Daily crash rate',
          window: '30d',
          metric: defineMetric({
            connector: googlePlayConsole,
            shape: 'metric',
            name: 'gplay_crash_rate_by_day',
            fn: 'avg',
          }),
        },
      },
    }),
  },
});
