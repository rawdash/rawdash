import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const vanta = {
  name: 'vanta',
  connectorId: 'vanta',
  config: {
    clientId: 'vci_AbCdEf...',
    clientSecret: secret('VANTA_CLIENT_SECRET'),
  },
};

export default defineConfig({
  connectors: [vanta],
  dashboards: {
    compliance: defineDashboard({
      widgets: {
        failing_controls: {
          kind: 'stat',
          title: 'Failing controls',
          metric: defineMetric({
            connector: vanta,
            shape: 'entity',
            entityType: 'vanta_control',
            fn: 'count',
            filter: [{ field: 'status', op: 'eq', value: 'FAILING' }],
          }),
        },
        open_findings: {
          kind: 'stat',
          title: 'Open findings',
          metric: defineMetric({
            connector: vanta,
            shape: 'event',
            name: 'vanta_test_finding',
            fn: 'count',
            filter: [{ field: 'status', op: 'eq', value: 'OPEN' }],
          }),
        },
      },
    }),
  },
});
