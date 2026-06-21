import {
  InMemoryStorage,
  computeConnectorBackfill,
  computeMetric,
  defineConfig,
  defineDashboard,
  defineMetric,
  widgetMetrics,
} from '@rawdash/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GitHubConnector } from './github';

const github = { name: 'github', connectorId: 'github-actions', config: {} };

const config = defineConfig({
  connectors: [github],
  dashboards: {
    github: defineDashboard({
      widgets: {
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

const widgets = config.dashboards.github!.widgets;

function mockJson(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'application/json' }),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

const now = Date.now();

function pr(number: number, state: string, daysAgo: number) {
  const iso = new Date(now - daysAgo * 86_400_000).toISOString();
  return {
    number,
    title: `PR ${number}`,
    state,
    draft: false,
    user: { login: 'alice' },
    created_at: iso,
    updated_at: iso,
  };
}

async function syncToCompletion(
  connector: GitHubConnector,
  handle: ReturnType<InMemoryStorage['getStorageHandle']>,
): Promise<void> {
  const backfill = computeConnectorBackfill(config).get('github')!;
  const resources = new Set(backfill.keys());
  const fetchSpecs: Record<string, unknown> = {};
  for (const [name, { specs }] of backfill) {
    fetchSpecs[name] = specs;
  }
  let cursor: unknown = undefined;
  for (let i = 0; i < 50; i++) {
    const result = await connector.sync(
      { mode: 'full', resources, fetchSpecs: fetchSpecs as never, cursor },
      handle,
    );
    if (result.done) {
      return;
    }
    cursor = result.cursor;
  }
  throw new Error('sync did not complete');
}

describe('RAW-676 widget-driven scope regression', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  const openPRs = [pr(1, 'open', 1), pr(2, 'open', 2), pr(3, 'open', 3)];
  const closedPRs = [pr(10, 'closed', 5), pr(11, 'closed', 12)];

  beforeEach(() => {
    fetchSpy = vi.fn().mockImplementation((url: string | URL) => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.includes('/actions/runs')) {
        return Promise.resolve(mockJson({ workflow_runs: [] }));
      }
      if (u.includes('/pulls')) {
        const state = new URL(u).searchParams.get('state');
        if (state === 'closed') {
          return Promise.resolve(mockJson(closedPRs));
        }
        return Promise.resolve(mockJson(openPRs));
      }
      if (u.includes('/issues')) {
        return Promise.resolve(mockJson([]));
      }
      if (u.includes('/contributors')) {
        return Promise.resolve(
          mockJson([
            { login: 'alice', contributions: 296 },
            { login: 'bob', contributions: 17 },
            { login: 'carol', contributions: 12 },
          ]),
        );
      }
      return Promise.resolve(
        mockJson({ stargazers_count: 1, forks_count: 0, subscribers_count: 0 }),
      );
    });
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('Contributors counts 3 from the reliable /contributors endpoint (no 202 stats)', async () => {
    const connector = new GitHubConnector({
      owner: 'rawdash',
      repo: 'rawdash',
    });
    const storage = new InMemoryStorage();
    const handle = storage.getStorageHandle('github');

    await syncToCompletion(connector, handle);

    const urls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('/stats/contributors'))).toBe(false);
    expect(urls.some((u) => u.includes('/contributors'))).toBe(true);

    const count = await computeMetric(
      handle,
      widgetMetrics(widgets.contributors!)[0]!,
    );
    expect(count).toBe(3);
  });

  it('backfills closed PRs so the PRs-Closed-per-Week series is non-empty', async () => {
    const connector = new GitHubConnector({
      owner: 'rawdash',
      repo: 'rawdash',
    });
    const storage = new InMemoryStorage();
    const handle = storage.getStorageHandle('github');

    await syncToCompletion(connector, handle);

    const prUrls = fetchSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((u) => u.includes('/pulls'));
    expect(prUrls.some((u) => u.includes('state=open'))).toBe(true);
    expect(prUrls.some((u) => u.includes('state=closed'))).toBe(true);

    const series = (await computeMetric(
      handle,
      widgetMetrics(widgets.prs_closed_per_week!)[0]!,
    )) as { date: string; value: number }[];
    expect(series.length).toBeGreaterThan(0);
    const total = series.reduce((sum, point) => sum + point.value, 0);
    expect(total).toBe(closedPRs.length);
  });
});
