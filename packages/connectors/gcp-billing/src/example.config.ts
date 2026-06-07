import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const gcpBilling = {
  name: 'gcpBilling',
  connectorId: 'gcp-billing',
  config: {
    serviceAccountJson: secret('GCP_BILLING_SA_JSON'),
    bqProject: 'my-billing-project',
    bqDataset: 'billing_export',
    bqLocation: 'US',
    groupBy: ['service'],
    lookbackDays: 90,
  },
};

export default defineConfig({
  connectors: [gcpBilling],
  dashboards: {
    finance: defineDashboard({
      widgets: {
        spend: {
          kind: 'stat',
          title: 'Spend (last 30d)',
          metric: defineMetric({
            connector: gcpBilling,
            shape: 'metric',
            name: 'gcp_cost_daily',
            fn: 'sum',
          }),
        },
      },
    }),
  },
});
