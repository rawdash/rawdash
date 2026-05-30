import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const sentry = {
  name: 'sentry',
  connectorId: 'sentry',
  config: {
    authToken: secret('SENTRY_AUTH_TOKEN'),
    organization: 'my-org',
    projects: ['my-project'],
  },
};

export default defineConfig({
  connectors: [sentry],
  dashboards: {
    engineering: defineDashboard({
      widgets: {
        unresolved_issues: {
          kind: 'stat',
          title: 'Unresolved Issues',
          metric: defineMetric({
            connector: sentry,
            shape: 'entity',
            entityType: 'sentry_issue',
            fn: 'count',
            filter: [{ field: 'status', op: 'eq', value: 'unresolved' }],
          }),
        },
      },
    }),
  },
});
