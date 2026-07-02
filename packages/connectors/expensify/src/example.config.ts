import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const expensify = {
  name: 'expensify',
  connectorId: 'expensify',
  config: {
    partnerName: 'your_partnerUserID',
    partnerPassword: secret('EXPENSIFY_PARTNER_PASSWORD'),
    lookbackDays: 180,
  },
};

export default defineConfig({
  connectors: [expensify],
  dashboards: {
    finance: defineDashboard({
      widgets: {
        spend_mtd: {
          kind: 'stat',
          title: 'Spend (30d)',
          window: '30d',
          metric: defineMetric({
            connector: expensify,
            shape: 'metric',
            name: 'expensify_category_spend',
            field: 'value',
            fn: 'sum',
          }),
        },
        daily_spend: {
          kind: 'timeseries',
          title: 'Daily spend',
          window: '90d',
          metric: defineMetric({
            connector: expensify,
            shape: 'metric',
            name: 'expensify_category_spend',
            field: 'value',
            fn: 'sum',
          }),
        },
      },
    }),
  },
});
