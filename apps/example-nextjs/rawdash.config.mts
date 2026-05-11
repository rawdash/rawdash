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
          open_prs: {
            label: 'Open PRs',
            metric: defineMetric({
              connector: github,
              shape: 'entity',
              name: 'pull_request',
              field: 'state',
              fn: 'count',
              filter: [{ field: 'state', op: 'eq', value: 'open' }],
            }),
          },
          prs_merged_per_week: {
            label: 'PRs Merged per Week',
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
          successful_runs_30d: {
            label: 'Successful Runs 30d',
            metric: defineMetric({
              connector: github,
              shape: 'event',
              name: 'workflow_run',
              field: 'start_ts',
              fn: 'count',
              window: '30d',
              filter: [{ field: 'conclusion', op: 'eq', value: 'success' }],
            }),
          },
          run_count_30d: {
            label: 'Total Runs 30d',
            metric: defineMetric({
              connector: github,
              shape: 'event',
              name: 'workflow_run',
              field: 'start_ts',
              fn: 'count',
              window: '30d',
            }),
          },
          daily_runs_30d: {
            label: 'Daily Runs 30d',
            metric: defineMetric({
              connector: github,
              shape: 'event',
              name: 'workflow_run',
              field: 'start_ts',
              fn: 'count',
              window: '30d',
              groupBy: { field: 'start_ts', granularity: 'day' },
            }),
          },
          total_contributors: {
            label: 'Contributors',
            metric: defineMetric({
              connector: github,
              shape: 'entity',
              name: 'contributor',
              field: 'commits',
              fn: 'count',
            }),
          },
          open_issues: {
            label: 'Open Issues',
            metric: defineMetric({
              connector: github,
              shape: 'entity',
              name: 'issue',
              field: 'state',
              fn: 'count',
              filter: [{ field: 'state', op: 'eq', value: 'open' }],
            }),
          },
          releases_per_month: {
            label: 'Releases per Month',
            metric: defineMetric({
              connector: github,
              shape: 'entity',
              name: 'release',
              field: 'updated_at',
              fn: 'count',
              window: '365d',
              groupBy: { field: 'updated_at', granularity: 'month' },
            }),
          },
          deployments_per_week: {
            label: 'Deployments per Week',
            metric: defineMetric({
              connector: github,
              shape: 'entity',
              name: 'deployment',
              field: 'updated_at',
              fn: 'count',
              window: '90d',
              groupBy: { field: 'updated_at', granularity: 'week' },
            }),
          },
        },
      }),
    },
  }),
  { port: resolvePort() },
);
