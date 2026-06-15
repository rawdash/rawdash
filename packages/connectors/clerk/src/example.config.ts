import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const clerk = {
  name: 'clerk',
  connectorId: 'clerk',
  config: {
    secretKey: secret('CLERK_SECRET_KEY'),
  },
};

export default defineConfig({
  connectors: [clerk],
  dashboards: {
    identity: defineDashboard({
      widgets: {
        active_users: {
          kind: 'stat',
          title: 'Clerk users',
          metric: defineMetric({
            connector: clerk,
            shape: 'entity',
            entityType: 'clerk_user',
            fn: 'count',
            filter: [{ field: 'banned', op: 'eq', value: false }],
          }),
        },
        active_sessions: {
          kind: 'stat',
          title: 'Active sessions',
          metric: defineMetric({
            connector: clerk,
            shape: 'event',
            name: 'clerk_session',
            fn: 'count',
            filter: [{ field: 'status', op: 'eq', value: 'active' }],
          }),
        },
      },
    }),
  },
});
