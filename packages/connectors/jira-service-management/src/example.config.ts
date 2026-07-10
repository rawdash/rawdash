import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const jsm = {
  name: 'jira-service-management',
  connectorId: 'jira-service-management',
  config: {
    email: 'you@yourorg.com',
    apiToken: secret('JIRA_API_TOKEN'),
    host: 'yourorg.atlassian.net',
  },
};

export default defineConfig({
  connectors: [jsm],
  dashboards: {
    servicedesk: defineDashboard({
      widgets: {
        open_requests: {
          kind: 'stat',
          title: 'Open requests',
          metric: defineMetric({
            connector: jsm,
            shape: 'entity',
            entityType: 'jsm_request',
            fn: 'count',
            filter: [
              { field: 'statusCategory', op: 'eq', value: 'indeterminate' },
            ],
          }),
        },
        requests_opened: {
          kind: 'timeseries',
          title: 'Request status changes',
          window: '30d',
          metric: defineMetric({
            connector: jsm,
            shape: 'event',
            name: 'jsm_request_status_change',
            fn: 'count',
          }),
        },
        sla_breach_rate: {
          kind: 'stat',
          title: 'SLA breach rate',
          metric: defineMetric({
            connector: jsm,
            shape: 'event',
            name: 'jsm_sla_cycle',
            fn: 'avg',
            field: 'breached',
          }),
        },
      },
    }),
  },
});
