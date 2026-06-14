import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const entraId = {
  name: 'entra-id',
  connectorId: 'entra-id',
  config: {
    tenantId: '00000000-0000-0000-0000-000000000000',
    clientId: '11111111-1111-1111-1111-111111111111',
    clientSecret: secret('ENTRA_CLIENT_SECRET'),
  },
};

export default defineConfig({
  connectors: [entraId],
  dashboards: {
    identity: defineDashboard({
      widgets: {
        active_users: {
          kind: 'stat',
          title: 'Enabled users',
          metric: defineMetric({
            connector: entraId,
            shape: 'entity',
            entityType: 'entra_user',
            fn: 'count',
            filter: [{ field: 'accountEnabled', op: 'eq', value: true }],
          }),
        },
        failed_signins: {
          kind: 'stat',
          title: 'Failed sign-ins',
          metric: defineMetric({
            connector: entraId,
            shape: 'event',
            name: 'entra_signin_event',
            fn: 'count',
            filter: [{ field: 'status', op: 'eq', value: 'failure' }],
          }),
        },
        risky_users: {
          kind: 'stat',
          title: 'Risky users',
          metric: defineMetric({
            connector: entraId,
            shape: 'entity',
            entityType: 'entra_risky_user',
            fn: 'count',
          }),
        },
      },
    }),
  },
});
