import { createClient } from '@libsql/client';
import { LibsqlStorage } from '@rawdash/adapter-libsql';
import { GitHubConnector } from '@rawdash/connector-github';
import {
  defineConfig,
  defineDashboard,
  defineMetric,
  secret,
} from '@rawdash/core';

import { serve } from './src/serve';

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

const github = {
  name: 'github',
  connectorId: 'github-actions',
  config: {
    owner: process.env['GITHUB_OWNER'] ?? 'rawdash',
    repo: process.env['GITHUB_REPO'] ?? 'rawdash',
    token: secret('GITHUB_TOKEN'),
  },
};

const storage = new LibsqlStorage({
  client: createClient({
    url: process.env['TURSO_URL'] ?? 'file:rawdash.db',
    authToken: process.env['TURSO_AUTH_TOKEN'],
  }),
});

serve(
  defineConfig({
    connectors: [github],
    dashboards: {
      github: defineDashboard({
        widgets: {
          latest_run_conclusion: {
            kind: 'stat',
            title: 'Latest Run Conclusion',
            metric: defineMetric({
              connector: github,
              shape: 'event',
              name: 'workflow_run',
              field: 'conclusion',
              fn: 'latest',
            }),
          },
          run_count_7d: {
            kind: 'stat',
            title: 'Run Count 7d',
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
            kind: 'stat',
            title: 'Successful Runs 7d',
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
            kind: 'timeseries',
            title: 'Daily Runs',
            window: '7d',
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
    },
  }),
  {
    port: resolvePort(),
    storage,
    connectorRegistry: { 'github-actions': GitHubConnector },
  },
);
