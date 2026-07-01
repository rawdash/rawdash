import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const bill = {
  name: 'bill',
  connectorId: 'bill',
  config: {
    devKey: secret('BILL_DEV_KEY'),
    username: 'api-user@example.com',
    password: secret('BILL_PASSWORD'),
    orgId: '00801ABCDEFGHIJKLMNO',
    resources: ['bills', 'vendors', 'payments'],
  },
};

export default defineConfig({
  connectors: [bill],
  dashboards: {
    payables: defineDashboard({
      widgets: {
        bills_pending: {
          kind: 'stat',
          title: 'Bills pending',
          metric: defineMetric({
            connector: bill,
            shape: 'entity',
            entityType: 'bill_bill',
            fn: 'count',
            filter: [{ field: 'paymentStatus', op: 'eq', value: 'UNPAID' }],
          }),
        },
        ap_balance: {
          kind: 'stat',
          title: 'AP balance (unpaid)',
          metric: defineMetric({
            connector: bill,
            shape: 'entity',
            entityType: 'bill_bill',
            field: 'amount',
            fn: 'sum',
            filter: [{ field: 'paymentStatus', op: 'eq', value: 'UNPAID' }],
          }),
        },
        payments_30d: {
          kind: 'timeseries',
          title: 'Vendor payments (30d)',
          window: '30d',
          metric: defineMetric({
            connector: bill,
            shape: 'event',
            name: 'bill_payment',
            field: 'amount',
            fn: 'sum',
          }),
        },
      },
    }),
  },
});
