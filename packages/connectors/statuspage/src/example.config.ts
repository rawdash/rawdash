import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const statuspage = {
  name: 'statuspage',
  connectorId: 'statuspage',
  config: {
    apiKey: secret('STATUSPAGE_API_KEY'),
    pageId: 'abc123def456',
  },
};

export default defineConfig({
  connectors: [statuspage],
  dashboards: {
    engineering: defineDashboard({
      widgets: {
        open_incidents: {
          kind: 'stat',
          title: 'Open incidents',
          metric: defineMetric({
            connector: statuspage,
            shape: 'entity',
            entityType: 'statuspage_incident',
            fn: 'count',
            filter: [{ field: 'status', op: 'neq', value: 'resolved' }],
          }),
        },
      },
    }),
  },
});
