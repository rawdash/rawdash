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

  it('takes max window across widgets per connector', () => {
    const result = computeConnectorBackfill(
      configWith({
        a: {
          kind: 'timeseries',
          title: 'a',
          window: '7d',
          metric: {
            connectorId: 'gh',
            shape: 'event',
            name: 'x',
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
            name: 'x',
            fn: 'count',
            window: '90d',
          },
        },
      }),
    );
    expect(result.get('gh')?.requiredWindowMs).toBe(90 * 86_400_000);
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
    expect(result.has('gh')).toBe(true);
    expect(result.get('gh')?.requiredWindowMs).toBeUndefined();
  });

  it('treats status widgets as references to the named connector', () => {
    const result = computeConnectorBackfill(
      configWith({
        s: { kind: 'status', title: 's', source: 'sentry' },
      }),
    );
    expect(result.has('sentry')).toBe(true);
  });

  it('keeps a window across a current-state widget on the same connector', () => {
    const result = computeConnectorBackfill(
      configWith({
        windowed: {
          kind: 'timeseries',
          title: 'w',
          window: '30d',
          metric: {
            connectorId: 'gh',
            shape: 'event',
            name: 'x',
            fn: 'count',
            window: '30d',
          },
        },
        current: {
          kind: 'stat',
          title: 'c',
          metric: {
            connectorId: 'gh',
            shape: 'entity',
            name: 'repo',
            fn: 'latest',
          },
        },
      }),
    );
    expect(result.get('gh')?.requiredWindowMs).toBe(30 * 86_400_000);
  });
});
