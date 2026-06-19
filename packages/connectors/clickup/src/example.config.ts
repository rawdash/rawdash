import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const clickup = {
  name: 'clickup',
  connectorId: 'clickup',
  config: {
    apiToken: secret('CLICKUP_API_TOKEN'),
    teamId: '9000000000',
  },
};

export default defineConfig({
  connectors: [clickup],
  dashboards: {
    product: defineDashboard({
      widgets: {
        open_tasks: {
          kind: 'stat',
          title: 'Open tasks',
          metric: defineMetric({
            connector: clickup,
            shape: 'entity',
            entityType: 'clickup_task',
            fn: 'count',
            filter: [{ field: 'statusType', op: 'eq', value: 'open' }],
          }),
        },
        tasks_closed: {
          kind: 'timeseries',
          title: 'Tasks closed per day',
          window: '30d',
          metric: defineMetric({
            connector: clickup,
            shape: 'event',
            name: 'clickup_task_event',
            fn: 'count',
            filter: [{ field: 'kind', op: 'eq', value: 'closed' }],
          }),
        },
      },
    }),
  },
});
