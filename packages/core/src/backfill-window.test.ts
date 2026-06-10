import { describe, expect, it } from 'vitest';

import {
  computeConnectorBackfill,
  fetchSpecsForConnector,
} from './backfill-window';
import type { DashboardConfig } from './config';

function configWith(widgets: Record<string, unknown>): DashboardConfig {
  return {
    connectors: [],
    dashboards: { d: { widgets } },
  } as unknown as DashboardConfig;
}

const day = 86_400_000;

describe('computeConnectorBackfill', () => {
  it('omits connectors with no widgets', () => {
    const result = computeConnectorBackfill(configWith({}));
    expect(result.size).toBe(0);
  });

  it('takes max window across same-filter widgets per resource', () => {
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
    expect(result.get('gh')?.get('workflow_run')?.specs).toEqual([
      { requiredWindowMs: 90 * day },
    ]);
  });

  it('records current-state-only widgets with a single window-less spec', () => {
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
    expect(result.get('gh')?.get('repo')?.specs).toEqual([{}]);
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
    expect(gh?.get('pull_request')?.specs).toEqual([
      { requiredWindowMs: 30 * day },
    ]);
    expect(gh?.get('repo')?.specs).toEqual([{}]);
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

  describe('mergeSpecs', () => {
    it('keeps separate specs for different filter sets', () => {
      const result = computeConnectorBackfill(
        configWith({
          open: {
            kind: 'stat',
            title: 'open PRs',
            metric: {
              connectorId: 'gh',
              shape: 'entity',
              name: 'pull_request',
              fn: 'count',
              filter: [{ field: 'state', op: 'eq', value: 'open' }],
            },
          },
          closed: {
            kind: 'timeseries',
            title: 'closed per day',
            window: '7d',
            metric: {
              connectorId: 'gh',
              shape: 'entity',
              name: 'pull_request',
              fn: 'count',
              filter: [{ field: 'state', op: 'eq', value: 'closed' }],
            },
          },
        }),
      );
      const specs = result.get('gh')?.get('pull_request')?.specs;
      expect(specs).toEqual([
        { filter: [{ field: 'state', op: 'eq', value: 'open' }] },
        {
          filter: [{ field: 'state', op: 'eq', value: 'closed' }],
          requiredWindowMs: 7 * day,
        },
      ]);
    });

    it('collapses same-filter specs to the loosest window (unbounded subsumes bounded)', () => {
      const result = computeConnectorBackfill(
        configWith({
          openNoWindow: {
            kind: 'stat',
            title: 'open PRs',
            metric: {
              connectorId: 'gh',
              shape: 'entity',
              name: 'pull_request',
              fn: 'count',
              filter: [{ field: 'state', op: 'eq', value: 'open' }],
            },
          },
          open7d: {
            kind: 'timeseries',
            title: 'open opened per day',
            window: '7d',
            metric: {
              connectorId: 'gh',
              shape: 'entity',
              name: 'pull_request',
              fn: 'count',
              filter: [{ field: 'state', op: 'eq', value: 'open' }],
            },
          },
        }),
      );
      expect(result.get('gh')?.get('pull_request')?.specs).toEqual([
        { filter: [{ field: 'state', op: 'eq', value: 'open' }] },
      ]);
    });

    it('treats filter order as insignificant when collapsing specs', () => {
      const result = computeConnectorBackfill(
        configWith({
          a: {
            kind: 'stat',
            title: 'a',
            metric: {
              connectorId: 'gh',
              shape: 'entity',
              name: 'pull_request',
              fn: 'count',
              filter: [
                { field: 'state', op: 'eq', value: 'open' },
                { field: 'draft', op: 'eq', value: false },
              ],
            },
          },
          b: {
            kind: 'stat',
            title: 'b',
            metric: {
              connectorId: 'gh',
              shape: 'entity',
              name: 'pull_request',
              fn: 'count',
              filter: [
                { field: 'draft', op: 'eq', value: false },
                { field: 'state', op: 'eq', value: 'open' },
              ],
            },
          },
        }),
      );
      expect(result.get('gh')?.get('pull_request')?.specs).toHaveLength(1);
    });
  });
});

describe('fetchSpecsForConnector', () => {
  it('returns undefined for a connector with no referenced widgets', () => {
    expect(fetchSpecsForConnector(configWith({}), 'gh')).toBeUndefined();
  });

  it('returns the wire-shape record keyed by resource', () => {
    const config = configWith({
      open: {
        kind: 'stat',
        title: 'open PRs',
        metric: {
          connectorId: 'gh',
          shape: 'entity',
          name: 'pull_request',
          fn: 'count',
          filter: [{ field: 'state', op: 'eq', value: 'open' }],
        },
      },
      closed: {
        kind: 'timeseries',
        title: 'closed per day',
        window: '7d',
        metric: {
          connectorId: 'gh',
          shape: 'entity',
          name: 'pull_request',
          fn: 'count',
          filter: [{ field: 'state', op: 'eq', value: 'closed' }],
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
    });
    expect(fetchSpecsForConnector(config, 'gh')).toEqual({
      pull_request: [
        { filter: [{ field: 'state', op: 'eq', value: 'open' }] },
        {
          filter: [{ field: 'state', op: 'eq', value: 'closed' }],
          requiredWindowMs: 7 * day,
        },
      ],
      repo: [{}],
    });
  });
});
