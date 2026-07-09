import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const servicenow = {
  name: 'servicenow',
  connectorId: 'servicenow',
  config: {
    instanceUrl: 'acme.service-now.com',
    username: 'rawdash.integration',
    password: secret('SERVICENOW_PASSWORD'),
  },
};

export default defineConfig({
  connectors: [servicenow],
  dashboards: {
    itsm: defineDashboard({
      widgets: {
        active_incidents: {
          kind: 'stat',
          title: 'Active incidents',
          metric: defineMetric({
            connector: servicenow,
            shape: 'entity',
            entityType: 'servicenow_incident',
            fn: 'count',
            filter: [{ field: 'active', op: 'eq', value: true }],
          }),
        },
        incidents_opened: {
          kind: 'timeseries',
          title: 'Incidents opened',
          window: '30d',
          metric: defineMetric({
            connector: servicenow,
            shape: 'event',
            name: 'servicenow_incident_state_change',
            fn: 'count',
            filter: [{ field: 'transition', op: 'eq', value: 'opened' }],
          }),
        },
      },
    }),
  },
});
