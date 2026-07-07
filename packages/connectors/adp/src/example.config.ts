import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const adp = {
  name: 'adp',
  connectorId: 'adp',
  config: {
    clientId: 'your-adp-client-id',
    clientSecret: secret('ADP_CLIENT_SECRET'),
    certPem: secret('ADP_CERT_PEM'),
    keyPem: secret('ADP_KEY_PEM'),
  },
};

export default defineConfig({
  connectors: [adp],
  dashboards: {
    workforce: defineDashboard({
      widgets: {
        headcount: {
          kind: 'stat',
          title: 'Active headcount',
          metric: defineMetric({
            connector: adp,
            shape: 'entity',
            entityType: 'adp_worker',
            fn: 'count',
            filter: [{ field: 'status', op: 'eq', value: 'active' }],
          }),
        },
        payroll_spend_30d: {
          kind: 'stat',
          title: 'Gross payroll (30d)',
          window: '30d',
          metric: defineMetric({
            connector: adp,
            shape: 'metric',
            name: 'adp_payroll_metric',
            fn: 'sum',
            filter: [{ field: 'kind', op: 'eq', value: 'gross' }],
          }),
        },
        payroll_trend: {
          kind: 'timeseries',
          title: 'Gross payroll per cycle',
          window: '365d',
          metric: defineMetric({
            connector: adp,
            shape: 'metric',
            name: 'adp_payroll_metric',
            fn: 'sum',
            filter: [{ field: 'kind', op: 'eq', value: 'gross' }],
          }),
        },
      },
    }),
  },
});
