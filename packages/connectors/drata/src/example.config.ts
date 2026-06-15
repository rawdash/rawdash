import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const drata = {
  name: 'drata',
  connectorId: 'drata',
  config: {
    apiKey: secret('DRATA_API_KEY'),
  },
};

export default defineConfig({
  connectors: [drata],
  dashboards: {
    compliance: defineDashboard({
      widgets: {
        failing_controls: {
          kind: 'stat',
          title: 'Failing controls',
          metric: defineMetric({
            connector: drata,
            shape: 'entity',
            entityType: 'drata_control',
            fn: 'count',
            filter: [{ field: 'status', op: 'eq', value: 'FAILING' }],
          }),
        },
        open_findings: {
          kind: 'stat',
          title: 'Open findings',
          metric: defineMetric({
            connector: drata,
            shape: 'event',
            name: 'drata_test_finding',
            fn: 'count',
            filter: [{ field: 'status', op: 'eq', value: 'OPEN' }],
          }),
        },
      },
    }),
  },
});
