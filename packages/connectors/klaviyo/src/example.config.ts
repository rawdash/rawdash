import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const klaviyo = {
  name: 'klaviyo',
  connectorId: 'klaviyo',
  config: {
    apiKey: secret('KLAVIYO_API_KEY'),
    apiRevision: '2024-10-15',
    channel: 'email',
  },
};

export default defineConfig({
  connectors: [klaviyo],
  dashboards: {
    marketing: defineDashboard({
      widgets: {
        active_segments: {
          kind: 'stat',
          title: 'Active segments',
          metric: defineMetric({
            connector: klaviyo,
            shape: 'entity',
            entityType: 'klaviyo_segment',
            fn: 'count',
            filter: [{ field: 'isActive', op: 'eq', value: true }],
          }),
        },
      },
    }),
  },
});
