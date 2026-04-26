import { describe, expect, it } from 'vitest';

import { defineConfig, defineDashboard, defineMetric } from './config';
import type { Distribution, Edge, Entity, Event, Metric } from './connector';

describe('shape types', () => {
  it('Event has required fields', () => {
    const e: Event = {
      name: 'workflow_run',
      start_ts: 1000,
      end_ts: 2000,
      attributes: { conclusion: 'success' },
    };
    expect(e.name).toBe('workflow_run');
    expect(e.start_ts).toBe(1000);
    expect(e.end_ts).toBe(2000);
    expect(e.attributes['conclusion']).toBe('success');
  });

  it('Event allows null end_ts', () => {
    const e: Event = {
      name: 'deploy',
      start_ts: Date.now(),
      end_ts: null,
      attributes: {},
    };
    expect(e.end_ts).toBeNull();
  });

  it('Entity has required fields', () => {
    const e: Entity = {
      type: 'pull_request',
      id: '42',
      attributes: { title: 'Fix bug', state: 'open' },
      updated_at: 1000,
    };
    expect(e.type).toBe('pull_request');
    expect(e.id).toBe('42');
    expect(e.updated_at).toBe(1000);
  });

  it('Metric has required fields', () => {
    const m: Metric = {
      name: 'ad.spend',
      ts: 1000,
      value: 99.5,
      attributes: { campaign: 'summer' },
    };
    expect(m.value).toBe(99.5);
  });

  it('Edge has required fields', () => {
    const e: Edge = {
      from_type: 'pull_request',
      from_id: '1',
      kind: 'reviewed_by',
      to_type: 'user',
      to_id: 'alice',
      attributes: { state: 'APPROVED' },
      updated_at: 1000,
    };
    expect(e.kind).toBe('reviewed_by');
  });

  it('Distribution supports histogram', () => {
    const d: Distribution = {
      name: 'latency',
      ts: 1000,
      kind: 'histogram',
      data: {
        buckets: [
          { le: 0.1, count: 10 },
          { le: 0.5, count: 20 },
        ],
        count: 20,
        sum: 4.5,
      },
      attributes: {},
    };
    expect(d.kind).toBe('histogram');
    if ('buckets' in d.data) {
      expect(d.data.buckets).toHaveLength(2);
    }
  });

  it('Distribution supports summary', () => {
    const d: Distribution = {
      name: 'response_time',
      ts: 1000,
      kind: 'summary',
      data: {
        quantiles: [
          { q: 0.5, value: 0.2 },
          { q: 0.99, value: 1.1 },
        ],
        count: 100,
        sum: 30,
      },
      attributes: {},
    };
    expect(d.kind).toBe('summary');
  });
});

describe('defineMetric', () => {
  it('resolves connectorId and shape', () => {
    const connector = { id: 'my-connector' };
    const resolved = defineMetric({
      connector,
      shape: 'event',
      name: 'deploy',
      field: 'conclusion',
      fn: 'latest',
    });
    expect(resolved.connectorId).toBe('my-connector');
    expect(resolved.shape).toBe('event');
    expect(resolved.name).toBe('deploy');
    expect(resolved.field).toBe('conclusion');
    expect(resolved.fn).toBe('latest');
  });

  it('preserves window, filter, and groupBy', () => {
    const connector = { id: 'c' };
    const resolved = defineMetric({
      connector,
      shape: 'event',
      name: 'run',
      field: 'start_ts',
      fn: 'count',
      window: '7d',
      filter: [{ field: 'branch', op: 'eq', value: 'main' }],
      groupBy: { field: 'start_ts', granularity: 'day' },
    });
    expect(resolved.window).toBe('7d');
    expect(resolved.filter).toHaveLength(1);
    expect(resolved.groupBy?.granularity).toBe('day');
  });
});

describe('defineConfig validation', () => {
  const connector = { id: 'c', credentials: undefined, sync: async () => {} };

  it('throws if connector not listed', () => {
    expect(() =>
      defineConfig({
        connectors: [],
        dashboards: {
          main: defineDashboard({
            widgets: {
              w: {
                metric: defineMetric({
                  connector,
                  shape: 'event',
                  field: 'start_ts',
                  fn: 'count',
                }),
              },
            },
          }),
        },
      }),
    ).toThrow('connector "c" is not listed');
  });

  it('throws for invalid shape', () => {
    expect(() =>
      defineConfig({
        connectors: [{ connector }],
        dashboards: {
          main: defineDashboard({
            widgets: {
              w: {
                metric: {
                  connectorId: 'c',
                  shape: 'invalid' as never,
                  field: 'x',
                  fn: 'count',
                },
              },
            },
          }),
        },
      }),
    ).toThrow('invalid shape');
  });

  it('throws for invalid fn', () => {
    expect(() =>
      defineConfig({
        connectors: [{ connector }],
        dashboards: {
          main: defineDashboard({
            widgets: {
              w: {
                metric: {
                  connectorId: 'c',
                  shape: 'event',
                  field: 'x',
                  fn: 'badFn' as never,
                },
              },
            },
          }),
        },
      }),
    ).toThrow('invalid fn');
  });

  it('passes for valid config', () => {
    expect(() =>
      defineConfig({
        connectors: [{ connector }],
        dashboards: {
          main: defineDashboard({
            widgets: {
              w: {
                metric: defineMetric({
                  connector,
                  shape: 'event',
                  name: 'run',
                  field: 'conclusion',
                  fn: 'latest',
                }),
              },
            },
          }),
        },
      }),
    ).not.toThrow();
  });
});
