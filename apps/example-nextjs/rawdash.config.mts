import { defineConfig, defineDashboard, defineMetric, secret } from '@rawdash/core';
import { GitHubActionsConnector } from '@rawdash/connector-github';

const github = new GitHubActionsConnector(
  {
    owner: process.env['GITHUB_OWNER'] ?? 'rawdash',
    repo: process.env['GITHUB_REPO'] ?? 'rawdash',
  },
  {
    token: secret('GITHUB_TOKEN'),
  },
);

export default defineConfig({
  connectors: [{ connector: github }],
  dashboards: {
    github: defineDashboard({
      widgets: {
        stars: {
          kind: 'stat',
          title: 'Stars',
          metric: defineMetric({
            connector: github,
            shape: 'entity',
            name: 'repo',
            field: 'stars',
            fn: 'latest',
          }),
        },
        forks: {
          kind: 'stat',
          title: 'Forks',
          metric: defineMetric({
            connector: github,
            shape: 'entity',
            name: 'repo',
            field: 'forks',
            fn: 'latest',
          }),
        },
        contributors: {
          kind: 'stat',
          title: 'Contributors',
          metric: defineMetric({
            connector: github,
            shape: 'entity',
            name: 'contributor',
            field: 'commits',
            fn: 'count',
          }),
        },
        open_prs: {
          kind: 'stat',
          title: 'Open PRs',
          metric: defineMetric({
            connector: github,
            shape: 'entity',
            name: 'pull_request',
            field: 'state',
            fn: 'count',
            filter: [{ field: 'state', op: 'eq', value: 'open' }],
          }),
        },
        open_issues: {
          kind: 'stat',
          title: 'Open Issues',
          metric: defineMetric({
            connector: github,
            shape: 'entity',
            name: 'issue',
            field: 'state',
            fn: 'count',
            filter: [{ field: 'state', op: 'eq', value: 'open' }],
          }),
        },
        ci_status: {
          kind: 'stat',
          title: 'CI Status',
          metric: defineMetric({
            connector: github,
            shape: 'event',
            name: 'workflow_run',
            field: 'conclusion',
            fn: 'latest',
          }),
        },
        prs_closed_per_week: {
          kind: 'timeseries',
          title: 'PRs Closed per Week',
          window: '90d',
          granularity: 'week',
          metric: defineMetric({
            connector: github,
            shape: 'entity',
            name: 'pull_request',
            field: 'updated_at',
            fn: 'count',
            window: '90d',
            filter: [{ field: 'state', op: 'eq', value: 'closed' }],
            groupBy: { field: 'updated_at', granularity: 'week' },
          }),
        },
      },
    }),
  },
});
