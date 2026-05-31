import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const datadog = {
  name: 'datadog',
  connectorId: 'datadog',
  config: {
    apiKey: secret('DD_API_KEY'),
    appKey: secret('DD_APP_KEY'),
    site: 'datadoghq.com',
  },
};

export default defineConfig({
  connectors: [datadog],
  dashboards: {
    observability: defineDashboard({
      widgets: {
        monitors_in_alert: {
          kind: 'stat',
          title: 'Monitors in Alert',
          metric: defineMetric({
            connector: datadog,
            shape: 'entity',
            entityType: 'datadog_monitor',
            fn: 'count',
            filter: [{ field: 'status', op: 'eq', value: 'Alert' }],
          }),
        },
      },
    }),
  },
});
