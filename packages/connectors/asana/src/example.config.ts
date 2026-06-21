import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const asana = {
  name: 'asana',
  connectorId: 'asana',
  config: {
    apiToken: secret('ASANA_API_TOKEN'),
    workspaceGid: '1201234567890',
  },
};

export default defineConfig({
  connectors: [asana],
  dashboards: {
    delivery: defineDashboard({
      widgets: {
        open_tasks: {
          kind: 'stat',
          title: 'Open Tasks',
          metric: defineMetric({
            connector: asana,
            shape: 'entity',
            entityType: 'asana_task',
            fn: 'count',
            filter: [{ field: 'completed', op: 'eq', value: false }],
          }),
        },
      },
    }),
  },
});
