import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const bitbucket = {
  name: 'bitbucket',
  connectorId: 'bitbucket',
  config: {
    workspace: 'my-workspace',
    username: 'janedoe',
    appPassword: secret('BITBUCKET_APP_PASSWORD'),
    repoSlugs: ['my-repo'],
  },
};

export default defineConfig({
  connectors: [bitbucket],
  dashboards: {
    engineering: defineDashboard({
      widgets: {
        open_pull_requests: {
          kind: 'stat',
          title: 'Open PRs',
          metric: defineMetric({
            connector: bitbucket,
            shape: 'entity',
            entityType: 'pull_request',
            fn: 'count',
            filter: [{ field: 'state', op: 'eq', value: 'OPEN' }],
          }),
        },
      },
    }),
  },
});
