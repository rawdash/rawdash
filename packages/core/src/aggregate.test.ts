import { describe, expect, it } from 'vitest';

import { classifyWidget } from './aggregate';
import type { Widget } from './config';

describe('classifyWidget', () => {
  it('classifies a plain count stat widget as aggregate', () => {
    const widget: Widget = {
      kind: 'stat',
      title: 'open prs',
      metric: {
        connectorId: 'github',
        shape: 'entity',
        name: 'pull_request',
        fn: 'count',
        filter: [{ field: 'state', op: 'eq', value: 'open' }],
      },
    };
    const c = classifyWidget(widget);
    expect(c.via).toBe('aggregate');
    expect(c.request).toEqual({
      fn: 'count',
      resource: 'pull_request',
      field: undefined,
      filter: [{ field: 'state', op: 'eq', value: 'open' }],
    });
  });

  it('classifies a latest stat widget with a field as aggregate', () => {
    const widget: Widget = {
      kind: 'stat',
      title: 'stars',
      metric: {
        connectorId: 'github',
        shape: 'entity',
        name: 'repo',
        field: 'stars',
        fn: 'latest',
      },
    };
    expect(classifyWidget(widget).via).toBe('aggregate');
  });

  it('routes through entity-sync when a window is present', () => {
    const widget: Widget = {
      kind: 'stat',
      title: 'recent',
      window: '7d',
      metric: {
        connectorId: 'github',
        shape: 'entity',
        name: 'issue',
        fn: 'count',
      },
    };
    expect(classifyWidget(widget).via).toBe('entity-sync');
  });

  it('routes through entity-sync when groupBy is present', () => {
    const widget: Widget = {
      kind: 'timeseries',
      title: 'series',
      window: '30d',
      metric: {
        connectorId: 'github',
        shape: 'entity',
        name: 'pull_request',
        fn: 'count',
        window: '30d',
        groupBy: { field: 'updated_at', granularity: 'week' },
      },
    };
    expect(classifyWidget(widget).via).toBe('entity-sync');
  });

  it('routes through entity-sync for non-count/latest fns', () => {
    const widget: Widget = {
      kind: 'stat',
      title: 'avg',
      metric: {
        connectorId: 'x',
        shape: 'metric',
        name: 'latency',
        field: 'value',
        fn: 'avg',
      },
    };
    expect(classifyWidget(widget).via).toBe('entity-sync');
  });

  it('routes status widgets through entity-sync (no aggregate)', () => {
    const widget: Widget = { kind: 'status', title: 's', source: 'github' };
    expect(classifyWidget(widget).via).toBe('entity-sync');
  });
});
