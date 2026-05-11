import { defineConfig, defineDashboard, defineMetric, secret } from '@rawdash/core';
import { GitHubActionsConnector } from '@rawdash/connector-github';
import { serve } from '@rawdash/server';

function resolvePort(): number {
  const raw = process.env['PORT'];
  if (raw === undefined || raw === '') {
    return 8080;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
    console.warn(
      `Invalid PORT env var "${raw}" — falling back to default port 8080`,
    );
    return 8080;
  }
  return parsed;
}

const github = new GitHubActionsConnector(
  {
    owner: process.env['GITHUB_OWNER'] ?? 'rawdash',
    repo: process.env['GITHUB_REPO'] ?? 'rawdash',
  },
  {
    token: secret('GITHUB_TOKEN'),
  },
);

serve(
  defineConfig({
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
          prs_merged_per_week: {
            kind: 'timeseries',
            title: 'PRs Merged per Week',
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
  }),
  { port: resolvePort() },
);
