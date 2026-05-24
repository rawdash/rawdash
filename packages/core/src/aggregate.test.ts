import { describe, expect, it } from 'vitest';

import {
  aggregateKey,
  classifyWidget,
  readAggregate,
  writeAggregate,
} from './aggregate';
import type { Widget } from './config';
import { InMemoryStorage } from './in-memory-storage';

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

  it('routes through entity-sync when groupBy is set on a stat widget', () => {
    const widget: Widget = {
      kind: 'stat',
      title: 'grouped stat',
      metric: {
        connectorId: 'github',
        shape: 'entity',
        name: 'pull_request',
        fn: 'count',
        groupBy: { field: 'updated_at', granularity: 'week' },
      },
    };
    expect(classifyWidget(widget).via).toBe('entity-sync');
  });

  it('routes through entity-sync for fn=latest without a field', () => {
    const widget: Widget = {
      kind: 'stat',
      title: 'latest no field',
      metric: {
        connectorId: 'github',
        shape: 'entity',
        name: 'repo',
        fn: 'latest',
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

describe('aggregate storage namespacing', () => {
  it('scopes aggregate values by dashboard so same widget id in different dashboards does not collide', async () => {
    const storage = new InMemoryStorage();
    const handle = storage.getStorageHandle('github');
    await writeAggregate(handle, 'dash-a', 'open_prs', 3);
    await writeAggregate(handle, 'dash-b', 'open_prs', 99);
    const a = await readAggregate(handle, 'dash-a', 'open_prs');
    const b = await readAggregate(handle, 'dash-b', 'open_prs');
    expect(a?.value).toBe(3);
    expect(b?.value).toBe(99);
    expect(aggregateKey('dash-a', 'open_prs')).toBe('dash-a:open_prs');
  });
});
