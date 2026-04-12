import { defineConfig, defineMetric } from '@rawdash/core';
import { GitHubActionsConnector } from '@rawdash/github';
import { serve } from '@rawdash/server';

serve(
  defineConfig({
    connectors: [
      {
        connector: GitHubActionsConnector,
        config: {
          owner: process.env['GITHUB_OWNER'] ?? 'rawdash',
          repo: process.env['GITHUB_REPO'] ?? 'rawdash',
          token: process.env['GITHUB_TOKEN'] ?? '',
        },
      },
    ],
    widgets: {
      latest_run_conclusion: {
        label: 'Latest Run',
        metric: defineMetric({
          connector: GitHubActionsConnector,
          resource: 'workflow_run',
          field: 'conclusion',
          fn: 'latest',
        }),
      },
      run_count_7d: {
        label: 'Runs (7d)',
        metric: defineMetric({
          connector: GitHubActionsConnector,
          resource: 'workflow_run',
          field: 'id',
          fn: 'count',
          window: '7d',
        }),
      },
      successful_runs_7d: {
        label: 'Successful Runs (7d)',
        metric: defineMetric({
          connector: GitHubActionsConnector,
          resource: 'workflow_run',
          field: 'id',
          fn: 'count',
          window: '7d',
          filter: [{ field: 'conclusion', op: 'eq', value: 'success' }],
        }),
      },
      daily_runs: {
        label: 'Daily Runs',
        metric: defineMetric({
          connector: GitHubActionsConnector,
          resource: 'workflow_run',
          field: 'id',
          fn: 'count',
          window: '7d',
          groupBy: { field: 'created_at', granularity: 'day' },
        }),
      },
    },
  }),
  { port: 8080 },
);
