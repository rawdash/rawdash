import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const deel = {
  name: 'deel',
  connectorId: 'deel',
  config: {
    apiToken: secret('DEEL_API_TOKEN'),
  },
};

export default defineConfig({
  connectors: [deel],
  dashboards: {
    workforce: defineDashboard({
      widgets: {
        headcount: {
          kind: 'stat',
          title: 'Headcount',
          metric: defineMetric({
            connector: deel,
            shape: 'entity',
            entityType: 'deel_person',
            fn: 'count',
          }),
        },
        active_contracts: {
          kind: 'stat',
          title: 'Active contracts',
          metric: defineMetric({
            connector: deel,
            shape: 'entity',
            entityType: 'deel_contract',
            fn: 'count',
            filter: [{ field: 'status', op: 'eq', value: 'in_progress' }],
          }),
        },
        invoiced_this_window: {
          kind: 'stat',
          title: 'Invoiced (total)',
          metric: defineMetric({
            connector: deel,
            shape: 'event',
            name: 'deel_invoice_event',
            field: 'amount',
            fn: 'sum',
            filter: [{ field: 'transition', op: 'eq', value: 'issued' }],
          }),
        },
      },
    }),
  },
});
