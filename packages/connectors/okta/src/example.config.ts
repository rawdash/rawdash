import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const okta = {
  name: 'okta',
  connectorId: 'okta',
  config: {
    host: 'acme.okta.com',
    apiToken: secret('OKTA_API_TOKEN'),
  },
};

export default defineConfig({
  connectors: [okta],
  dashboards: {
    identity: defineDashboard({
      widgets: {
        active_users: {
          kind: 'stat',
          title: 'Active users',
          metric: defineMetric({
            connector: okta,
            shape: 'entity',
            entityType: 'okta_user',
            fn: 'count',
            filter: [{ field: 'status', op: 'eq', value: 'ACTIVE' }],
          }),
        },
      },
    }),
  },
});
