import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const workos = {
  name: 'workos',
  connectorId: 'workos',
  config: {
    apiKey: secret('WORKOS_API_KEY'),
  },
};

export default defineConfig({
  connectors: [workos],
  dashboards: {
    enterprise_auth: defineDashboard({
      widgets: {
        organizations: {
          kind: 'stat',
          title: 'Organizations',
          metric: defineMetric({
            connector: workos,
            shape: 'entity',
            entityType: 'workos_organization',
            fn: 'count',
          }),
        },
        active_connections: {
          kind: 'stat',
          title: 'Active SSO connections',
          metric: defineMetric({
            connector: workos,
            shape: 'entity',
            entityType: 'workos_connection',
            fn: 'count',
            filter: [{ field: 'state', op: 'eq', value: 'active' }],
          }),
        },
        sso_failures: {
          kind: 'stat',
          title: 'Failed SSO sign-ins',
          metric: defineMetric({
            connector: workos,
            shape: 'event',
            name: 'workos_auth_event',
            fn: 'count',
            filter: [
              {
                field: 'eventType',
                op: 'eq',
                value: 'authentication.sso_failed',
              },
            ],
          }),
        },
      },
    }),
  },
});
