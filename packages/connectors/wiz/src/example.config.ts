import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const wiz = {
  name: 'wiz',
  connectorId: 'wiz',
  config: {
    apiEndpoint: 'https://api.us1.app.wiz.io/graphql',
    clientId: 'aaaa-bbbb-cccc-dddd',
    clientSecret: secret('WIZ_CLIENT_SECRET'),
  },
};

export default defineConfig({
  connectors: [wiz],
  dashboards: {
    security: defineDashboard({
      widgets: {
        open_criticals: {
          kind: 'stat',
          title: 'Open critical issues',
          metric: defineMetric({
            connector: wiz,
            shape: 'entity',
            entityType: 'wiz_issue',
            fn: 'count',
            filter: [
              { field: 'status', op: 'eq', value: 'OPEN' },
              { field: 'severity', op: 'eq', value: 'CRITICAL' },
            ],
          }),
        },
        resolved_per_day: {
          kind: 'timeseries',
          title: 'Issues resolved per day',
          window: '30d',
          metric: defineMetric({
            connector: wiz,
            shape: 'event',
            name: 'wiz_issue_event',
            fn: 'count',
            filter: [{ field: 'kind', op: 'eq', value: 'resolved' }],
          }),
        },
      },
    }),
  },
});
