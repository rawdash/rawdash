import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const launchdarkly = {
  name: 'launchdarkly',
  connectorId: 'launchdarkly',
  config: {
    apiToken: secret('LD_API_TOKEN'),
  },
};

export default defineConfig({
  connectors: [launchdarkly],
  dashboards: {
    engineering: defineDashboard({
      widgets: {
        active_flags: {
          kind: 'stat',
          title: 'Active feature flags',
          metric: defineMetric({
            connector: launchdarkly,
            shape: 'entity',
            entityType: 'launchdarkly_feature_flag',
            fn: 'count',
            filter: [{ field: 'archived', op: 'eq', value: false }],
          }),
        },
      },
    }),
  },
});
