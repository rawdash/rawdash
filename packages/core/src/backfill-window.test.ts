import { describe, expect, it } from 'vitest';

import { computeConnectorBackfill } from './backfill-window';
import type { DashboardConfig } from './config';

function configWith(widgets: Record<string, unknown>): DashboardConfig {
  return {
    connectors: [],
    dashboards: { d: { widgets } },
  } as unknown as DashboardConfig;
}

describe('computeConnectorBackfill', () => {
  it('omits connectors with no widgets', () => {
    const result = computeConnectorBackfill(configWith({}));
    expect(result.size).toBe(0);
  });

  it('takes max window across widgets per resource', () => {
    const result = computeConnectorBackfill(
      configWith({
        a: {
          kind: 'timeseries',
          title: 'a',
          window: '7d',
          metric: {
            connectorId: 'gh',
            shape: 'event',
            name: 'workflow_run',
            fn: 'count',
            window: '7d',
          },
        },
        b: {
          kind: 'timeseries',
          title: 'b',
          window: '90d',
          metric: {
            connectorId: 'gh',
            shape: 'event',
            name: 'workflow_run',
            fn: 'count',
            window: '90d',
          },
        },
      }),
    );
    expect(result.get('gh')?.get('workflow_run')?.requiredWindowMs).toBe(
      90 * 86_400_000,
    );
  });

  it('records current-state-only widgets with undefined window', () => {
    const result = computeConnectorBackfill(
      configWith({
        stars: {
          kind: 'stat',
          title: 'stars',
          metric: {
            connectorId: 'gh',
            shape: 'entity',
            name: 'repo',
            fn: 'latest',
          },
        },
      }),
    );
    expect(result.get('gh')?.has('repo')).toBe(true);
    expect(result.get('gh')?.get('repo')?.requiredWindowMs).toBeUndefined();
  });

  it('treats status widgets as references to the named connector with no resources', () => {
    const result = computeConnectorBackfill(
      configWith({
        s: { kind: 'status', title: 's', source: 'sentry' },
      }),
    );
    expect(result.has('sentry')).toBe(true);
    expect(result.get('sentry')?.size).toBe(0);
  });

  it('keeps per-resource scope across multiple resources on the same connector', () => {
    const result = computeConnectorBackfill(
      configWith({
        prs: {
          kind: 'timeseries',
          title: 'prs',
          window: '30d',
          metric: {
            connectorId: 'gh',
            shape: 'entity',
            name: 'pull_request',
            fn: 'count',
            window: '30d',
          },
        },
        stars: {
          kind: 'stat',
          title: 'stars',
          metric: {
            connectorId: 'gh',
            shape: 'entity',
            name: 'repo',
            fn: 'latest',
          },
        },
      }),
    );
    const gh = result.get('gh');
    expect(gh?.size).toBe(2);
    expect(gh?.get('pull_request')?.requiredWindowMs).toBe(30 * 86_400_000);
    expect(gh?.has('repo')).toBe(true);
    expect(gh?.get('repo')?.requiredWindowMs).toBeUndefined();
  });

  it('does not include resources that are not referenced by any widget', () => {
    const result = computeConnectorBackfill(
      configWith({
        stars: {
          kind: 'stat',
          title: 'stars',
          metric: {
            connectorId: 'gh',
            shape: 'entity',
            name: 'repo',
            fn: 'latest',
          },
        },
      }),
    );
    const gh = result.get('gh');
    expect(gh?.has('repo')).toBe(true);
    expect(gh?.has('deployment')).toBe(false);
    expect(gh?.has('release')).toBe(false);
  });

  it('falls back to entityType when metric.name is omitted', () => {
    const result = computeConnectorBackfill(
      configWith({
        x: {
          kind: 'stat',
          title: 'x',
          metric: {
            connectorId: 'gh',
            shape: 'entity',
            entityType: 'contributor',
            fn: 'count',
          },
        },
      }),
    );
    expect(result.get('gh')?.has('contributor')).toBe(true);
  });
});
