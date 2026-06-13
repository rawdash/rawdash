import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const auth0 = {
  name: 'auth0',
  connectorId: 'auth0',
  config: {
    domain: 'acme.us.auth0.com',
    clientId: 'AbCdEf...',
    clientSecret: secret('AUTH0_CLIENT_SECRET'),
  },
};

export default defineConfig({
  connectors: [auth0],
  dashboards: {
    identity: defineDashboard({
      widgets: {
        active_users: {
          kind: 'stat',
          title: 'Auth0 users',
          metric: defineMetric({
            connector: auth0,
            shape: 'entity',
            entityType: 'auth0_user',
            fn: 'count',
            filter: [{ field: 'blocked', op: 'eq', value: false }],
          }),
        },
        failed_logins: {
          kind: 'stat',
          title: 'Failed logins',
          metric: defineMetric({
            connector: auth0,
            shape: 'event',
            name: 'auth0_login_event',
            fn: 'count',
            filter: [{ field: 'type', op: 'eq', value: 'f' }],
          }),
        },
      },
    }),
  },
});
