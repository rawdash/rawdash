import { describe, expect, it } from 'vitest';

import {
  type DashboardConfig,
  defineConfig,
  defineDashboard,
  defineMetric,
} from './config';
import { renderConfigSource } from './render-config';
import { secret } from './secrets';

function reparse(source: string): DashboardConfig {
  const body = source
    .replace(/^import .*$/m, '')
    .replace('export default', 'return');
  const fn = new Function(
    'defineConfig',
    'defineDashboard',
    'defineMetric',
    'secret',
    body,
  );
  return fn(defineConfig, defineDashboard, defineMetric, secret);
}

describe('renderConfigSource', () => {
  it('renders a minimal config', () => {
    const config = defineConfig({ connectors: [], dashboards: {} });
    const source = renderConfigSource(config);
    expect(source).toContain("import { defineConfig } from '@rawdash/core';");
    expect(source).toContain('export default defineConfig({');
    expect(source).toContain('connectors: [],');
    expect(source).toContain('dashboards: {},');
    expect(reparse(source)).toEqual(config);
  });

  it('renders secret() markers instead of raw $secret objects', () => {
    const config = defineConfig({
      connectors: [
        {
          name: 'gh',
          connectorId: 'github-actions',
          config: { token: secret('GITHUB_TOKEN') },
        },
      ],
      dashboards: {},
    });
    const source = renderConfigSource(config);
    expect(source).toContain('secret(');
    expect(source).toContain('token: secret("GITHUB_TOKEN")');
    expect(source).not.toContain('$secret');
    expect(source).toContain(
      "import { defineConfig, secret } from '@rawdash/core';",
    );
    expect(reparse(source)).toEqual(config);
  });

  it('renders metrics via defineMetric with connector.name', () => {
    const config = defineConfig({
      connectors: [{ name: 'gh', connectorId: 'github-actions', config: {} }],
      dashboards: {
        main: defineDashboard({
          widgets: {
            prs: {
              kind: 'stat',
              title: 'Open PRs',
              metric: defineMetric({
                connector: { name: 'gh' },
                shape: 'entity',
                entityType: 'pull_request',
                fn: 'count',
              }),
            },
          },
        }),
      },
    });
    const source = renderConfigSource(config);
    expect(source).toContain('defineMetric({');
    expect(source).toContain('connector: { name: "gh" }');
    expect(source).not.toContain('connectorId: "gh"');
    expect(source).toContain(
      "import { defineConfig, defineDashboard, defineMetric } from '@rawdash/core';",
    );
    expect(reparse(source)).toEqual(config);
  });

  it('renders an array of metrics', () => {
    const config = defineConfig({
      connectors: [
        { name: 'a', connectorId: 'github-actions', config: {} },
        { name: 'b', connectorId: 'github-actions', config: {} },
      ],
      dashboards: {
        main: defineDashboard({
          widgets: {
            combined: {
              kind: 'stat',
              title: 'Combined',
              metric: [
                defineMetric({
                  connector: { name: 'a' },
                  shape: 'event',
                  name: 'deploy',
                  fn: 'count',
                }),
                defineMetric({
                  connector: { name: 'b' },
                  shape: 'event',
                  name: 'deploy',
                  fn: 'count',
                }),
              ],
            },
          },
        }),
      },
    });
    const source = renderConfigSource(config);
    expect(reparse(source)).toEqual(config);
  });

  it('renders status widgets without a metric', () => {
    const config = defineConfig({
      connectors: [{ name: 'gh', connectorId: 'github-actions', config: {} }],
      dashboards: {
        main: defineDashboard({
          widgets: {
            health: { kind: 'status', title: 'Health', source: 'gh' },
          },
        }),
      },
    });
    const source = renderConfigSource(config);
    expect(source).not.toContain('defineMetric');
    expect(reparse(source)).toEqual(config);
  });

  it('round-trips connector options, filters, groupBy and retention', () => {
    const config = defineConfig({
      connectors: [
        {
          name: 'gh',
          connectorId: 'github-actions',
          displayName: 'GitHub',
          config: {
            token: secret('GITHUB_TOKEN'),
            repos: ['owner/one', 'owner/two'],
            nested: { flag: true, count: 3 },
          },
          syncIntervalSeconds: 600,
          enabled: false,
        },
      ],
      dashboards: {
        main: defineDashboard({
          widgets: {
            merged: {
              kind: 'timeseries',
              title: 'Merged PRs',
              window: '30d',
              granularity: 'day',
              metric: defineMetric({
                connector: { name: 'gh' },
                shape: 'event',
                name: 'pull_request',
                fn: 'count',
                window: '30d',
                filter: [{ field: 'state', op: 'eq', value: 'merged' }],
                groupBy: { field: 'author', granularity: 'day' },
                label: 'merged',
              }),
            },
          },
        }),
      },
      retention: { maxAge: 90, maxSize: 10000, floor: 100 },
    });
    const source = renderConfigSource(config);
    expect(source).toContain('displayName: "GitHub"');
    expect(source).toContain('retention: {');
    expect(reparse(source)).toEqual(config);
  });

  it('quotes keys that are not plain identifiers', () => {
    const config = defineConfig({
      connectors: [
        {
          name: 'svc',
          connectorId: 'github-actions',
          config: { 'weird-key': 1, 'with space': 2 },
        },
      ],
      dashboards: {},
    });
    const source = renderConfigSource(config);
    expect(source).toContain('"weird-key": 1');
    expect(source).toContain('"with space": 2');
    expect(reparse(source)).toEqual(config);
  });
});
