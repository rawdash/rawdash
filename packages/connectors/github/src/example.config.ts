import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

const github = {
  name: 'github',
  connectorId: 'github-actions',
  config: {
    owner: 'my-org',
    repo: 'my-repo',
    token: secret('GITHUB_TOKEN'),
  },
};

export default defineConfig({
  connectors: [github],
  dashboards: {
    engineering: defineDashboard({
      widgets: {
        open_prs: {
          kind: 'stat',
          title: 'Open PRs',
          metric: defineMetric({
            connector: github,
            shape: 'entity',
            entityType: 'pull_request',
            fn: 'count',
            filter: [{ field: 'state', op: 'eq', value: 'open' }],
          }),
        },
      },
    }),
  },
});
