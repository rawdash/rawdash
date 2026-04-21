import { TursoStorage } from '@rawdash/adapter-turso';
import { GitHubActionsConnector } from '@rawdash/connector-github';
import { defineConfig, defineMetric } from '@rawdash/core';
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
    token: process.env['GITHUB_TOKEN'],
  },
);

const storage = new TursoStorage({
  url: process.env['TURSO_URL'] ?? 'file:rawdash.db',
  authToken: process.env['TURSO_AUTH_TOKEN'],
});

serve(
  defineConfig({
    connectors: [{ connector: github }],
    widgets: {
      latest_run_conclusion: {
        label: 'Latest Run Conclusion',
        metric: defineMetric({
          connector: github,
          shape: 'event',
          name: 'workflow_run',
          field: 'conclusion',
          fn: 'latest',
        }),
      },
      run_count_7d: {
        label: 'Run Count 7d',
        metric: defineMetric({
          connector: github,
          shape: 'event',
          name: 'workflow_run',
          field: 'start_ts',
          fn: 'count',
          window: '7d',
        }),
      },
      successful_runs_7d: {
        label: 'Successful Runs 7d',
        metric: defineMetric({
          connector: github,
          shape: 'event',
          name: 'workflow_run',
          field: 'start_ts',
          fn: 'count',
          window: '7d',
          filter: [{ field: 'conclusion', op: 'eq', value: 'success' }],
        }),
      },
      daily_runs: {
        label: 'Daily Runs',
        metric: defineMetric({
          connector: github,
          shape: 'event',
          name: 'workflow_run',
          field: 'start_ts',
          fn: 'count',
          window: '7d',
          groupBy: { field: 'start_ts', granularity: 'day' },
        }),
      },
    },
  }),
  { port: resolvePort(), storage },
);
