import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const gitlab = {
  name: 'gitlab',
  connectorId: 'gitlab',
  config: {
    apiToken: secret('GITLAB_API_TOKEN'),
    host: 'gitlab.com',
    projectIds: [278964],
  },
};

export default defineConfig({
  connectors: [gitlab],
  dashboards: {
    engineering: defineDashboard({
      widgets: {
        open_merge_requests: {
          kind: 'stat',
          title: 'Open MRs',
          metric: defineMetric({
            connector: gitlab,
            shape: 'entity',
            entityType: 'merge_request',
            fn: 'count',
            filter: [{ field: 'state', op: 'eq', value: 'opened' }],
          }),
        },
      },
    }),
  },
});
