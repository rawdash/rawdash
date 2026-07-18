import { defineConfig, defineDashboard, defineMetric } from '@rawdash/core';

const sslMonitor = {
  name: 'ssl-monitor',
  connectorId: 'ssl-monitor',
  config: {
    domains: [
      { host: 'example.com' },
      { host: 'api.example.com', port: 8443, severityThresholdDays: 45 },
    ],
  },
};

export default defineConfig({
  connectors: [sslMonitor],
  dashboards: {
    infrastructure: defineDashboard({
      widgets: {
        expiring_soon: {
          kind: 'stat',
          title: 'Certificates expiring soon',
          metric: defineMetric({
            connector: sslMonitor,
            shape: 'entity',
            entityType: 'ssl_certificate',
            fn: 'count',
            filter: [{ field: 'status', op: 'eq', value: 'expiring_soon' }],
          }),
        },
        expired: {
          kind: 'stat',
          title: 'Expired certificates',
          metric: defineMetric({
            connector: sslMonitor,
            shape: 'entity',
            entityType: 'ssl_certificate',
            fn: 'count',
            filter: [{ field: 'status', op: 'eq', value: 'expired' }],
          }),
        },
        checks_per_day: {
          kind: 'timeseries',
          title: 'Certificate checks per day',
          window: '30d',
          metric: defineMetric({
            connector: sslMonitor,
            shape: 'event',
            name: 'ssl_check',
            fn: 'count',
          }),
        },
        certificate_health: {
          kind: 'status',
          title: 'Certificate health',
          source: 'ssl-monitor',
        },
      },
    }),
  },
});
