import { describe, expect, it } from 'vitest';

import { defineConfig, defineDashboard, defineMetric } from './config';
import type {
  Distribution,
  Edge,
  Entity,
  Event,
  MetricSample,
} from './connector';
import { getWidgetSchema, widgetSchemas } from './widget-schemas';

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

  it('MetricSample has required fields', () => {
    const m: MetricSample = {
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
    const connector = { name: 'my-connector' };
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
    const connector = { name: 'c' };
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
  const connector = {
    name: 'c',
    connectorId: 'c',
    config: {},
  };

  it('throws if connector not listed', () => {
    expect(() =>
      defineConfig({
        connectors: [],
        dashboards: {
          main: defineDashboard({
            widgets: {
              w: {
                kind: 'stat',
                title: 'W',
                metric: defineMetric({
                  connector,
                  shape: 'event',
                  name: 'run',
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
        connectors: [connector],
        dashboards: {
          main: defineDashboard({
            widgets: {
              w: {
                kind: 'stat',
                title: 'W',
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
    ).toThrow(/Widget "w".*event.*entity.*metric.*edge.*distribution/);
  });

  it('throws for invalid fn', () => {
    expect(() =>
      defineConfig({
        connectors: [connector],
        dashboards: {
          main: defineDashboard({
            widgets: {
              w: {
                kind: 'stat',
                title: 'W',
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
    ).toThrow(/Widget "w" \(kind "stat"\): Invalid option/);
  });

  it('allows fn: "count" without a field', () => {
    expect(() =>
      defineConfig({
        connectors: [connector],
        dashboards: {
          main: defineDashboard({
            widgets: {
              w: {
                kind: 'stat',
                title: 'W',
                metric: {
                  connectorId: 'c',
                  shape: 'entity',
                  name: 'pull_request',
                  fn: 'count',
                },
              },
            },
          }),
        },
      }),
    ).not.toThrow();
  });

  it('throws for non-count fn without a field', () => {
    expect(() =>
      defineConfig({
        connectors: [connector],
        dashboards: {
          main: defineDashboard({
            widgets: {
              w: {
                kind: 'stat',
                title: 'W',
                metric: {
                  connectorId: 'c',
                  shape: 'event',
                  fn: 'sum',
                },
              },
            },
          }),
        },
      }),
    ).toThrow(/field is required unless fn is "count"/);
  });

  it('throws for a metric with neither name nor entityType', () => {
    expect(() =>
      defineConfig({
        connectors: [connector],
        dashboards: {
          main: defineDashboard({
            widgets: {
              w: {
                kind: 'stat',
                title: 'W',
                metric: {
                  connectorId: 'c',
                  shape: 'event',
                  fn: 'count',
                },
              },
            },
          }),
        },
      }),
    ).toThrow(/either name or entityType is required/);
  });

  it('throws for dashboard key with URL-unsafe characters', () => {
    expect(() =>
      defineConfig({
        connectors: [connector],
        dashboards: {
          'bad/key': defineDashboard({ widgets: {} }),
        },
      }),
    ).toThrow('Dashboard key "bad/key" contains URL-unsafe characters');
  });

  it('throws for widget key with URL-unsafe characters', () => {
    expect(() =>
      defineConfig({
        connectors: [connector],
        dashboards: {
          main: defineDashboard({
            widgets: {
              'bad:key': {
                kind: 'stat',
                title: 'W',
                metric: defineMetric({
                  connector,
                  shape: 'event',
                  name: 'run',
                  field: 'start_ts',
                  fn: 'count',
                }),
              },
            },
          }),
        },
      }),
    ).toThrow(
      'Dashboard "main", widget "bad:key": widget key contains URL-unsafe characters',
    );
  });

  it('passes for valid config', () => {
    expect(() =>
      defineConfig({
        connectors: [connector],
        dashboards: {
          main: defineDashboard({
            widgets: {
              w: {
                kind: 'stat',
                title: 'My Widget',
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

  describe('retention validation', () => {
    const base = {
      connectors: [connector],
      dashboards: { main: defineDashboard({ widgets: {} }) },
    };

    it('throws for negative maxAge', () => {
      expect(() =>
        defineConfig({ ...base, retention: { maxAge: -1 } }),
      ).toThrow('retention.maxAge must be a finite number >= 0');
    });

    it('throws for NaN maxAge', () => {
      expect(() =>
        defineConfig({ ...base, retention: { maxAge: NaN } }),
      ).toThrow('retention.maxAge must be a finite number >= 0');
    });

    it('throws for Infinity maxAge', () => {
      expect(() =>
        defineConfig({ ...base, retention: { maxAge: Infinity } }),
      ).toThrow('retention.maxAge must be a finite number >= 0');
    });

    it('throws for negative maxSize', () => {
      expect(() =>
        defineConfig({ ...base, retention: { maxSize: -1 } }),
      ).toThrow('retention.maxSize must be an integer >= 0');
    });

    it('throws for fractional maxSize', () => {
      expect(() =>
        defineConfig({ ...base, retention: { maxSize: 1.5 } }),
      ).toThrow('retention.maxSize must be an integer >= 0');
    });

    it('throws for negative floor', () => {
      expect(() =>
        defineConfig({ ...base, retention: { maxAge: 1000, floor: -1 } }),
      ).toThrow('retention.floor must be an integer >= 0');
    });

    it('throws for non-positive intervalMs', () => {
      expect(() =>
        defineConfig({ ...base, retention: { maxAge: 1000, intervalMs: 0 } }),
      ).toThrow('retention.intervalMs must be a finite number > 0');
    });

    it('throws for NaN intervalMs', () => {
      expect(() =>
        defineConfig({ ...base, retention: { maxAge: 1000, intervalMs: NaN } }),
      ).toThrow('retention.intervalMs must be a finite number > 0');
    });

    it('throws for Infinity intervalMs', () => {
      expect(() =>
        defineConfig({
          ...base,
          retention: { maxAge: 1000, intervalMs: Infinity },
        }),
      ).toThrow('retention.intervalMs must be a finite number > 0');
    });

    it('passes for valid retention config', () => {
      expect(() =>
        defineConfig({
          ...base,
          retention: {
            maxAge: 86400000,
            maxSize: 1000,
            floor: 10,
            intervalMs: 3600000,
          },
        }),
      ).not.toThrow();
    });

    it('passes when retention is omitted', () => {
      expect(() => defineConfig(base)).not.toThrow();
    });
  });
});

describe('widgetSchemas', () => {
  it('has schemas for all four widget kinds', () => {
    expect(Object.keys(widgetSchemas)).toEqual([
      'stat',
      'status',
      'timeseries',
      'distribution',
    ]);
  });

  it('getWidgetSchema returns the correct schema', () => {
    expect(getWidgetSchema('stat')).toBe(widgetSchemas.stat);
    expect(getWidgetSchema('status')).toBe(widgetSchemas.status);
    expect(getWidgetSchema('timeseries')).toBe(widgetSchemas.timeseries);
    expect(getWidgetSchema('distribution')).toBe(widgetSchemas.distribution);
  });

  const sampleMetric = {
    connectorId: 'c',
    shape: 'event' as const,
    name: 'run',
    field: 'start_ts',
    fn: 'count' as const,
  };

  it('stat schema validates required fields', () => {
    const result = widgetSchemas.stat.safeParse({
      kind: 'stat',
      title: 'Deploys',
      metric: sampleMetric,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.compare).toBe('none');
    }
  });

  it('stat schema rejects missing title', () => {
    const result = widgetSchemas.stat.safeParse({
      kind: 'stat',
      metric: sampleMetric,
    });
    expect(result.success).toBe(false);
  });

  it('stat schema rejects string metric (legacy shape)', () => {
    const result = widgetSchemas.stat.safeParse({
      kind: 'stat',
      title: 'Deploys',
      metric: 'deploy-count',
    });
    expect(result.success).toBe(false);
  });

  it('status schema validates required fields', () => {
    const result = widgetSchemas.status.safeParse({
      kind: 'status',
      title: 'CI Status',
      source: 'github-actions',
    });
    expect(result.success).toBe(true);
  });

  it('timeseries schema applies default granularity', () => {
    const result = widgetSchemas.timeseries.safeParse({
      kind: 'timeseries',
      title: 'Latency over time',
      metric: sampleMetric,
      window: '7d',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.granularity).toBe('day');
    }
  });

  it('timeseries schema rejects missing window', () => {
    const result = widgetSchemas.timeseries.safeParse({
      kind: 'timeseries',
      title: 'Latency',
      metric: sampleMetric,
    });
    expect(result.success).toBe(false);
  });

  it('distribution schema validates required fields', () => {
    const result = widgetSchemas.distribution.safeParse({
      kind: 'distribution',
      title: 'Request latency',
      metric: sampleMetric,
      window: '1d',
    });
    expect(result.success).toBe(true);
  });
});

describe('defineDashboard widget validation', () => {
  const metric = defineMetric({
    connector: { name: 'c' },
    shape: 'event',
    name: 'run',
    field: 'start_ts',
    fn: 'count',
  });

  it('throws for unknown widget kind', () => {
    expect(() =>
      defineDashboard({
        widgets: {
          w: { kind: 'unknown' as never, title: 'W', metric },
        },
      }),
    ).toThrow('unknown kind "unknown"');
  });

  it('throws when required title is missing', () => {
    expect(() =>
      defineDashboard({
        widgets: {
          w: { kind: 'stat', metric } as never,
        },
      }),
    ).toThrow();
  });

  it('accepts a valid stat widget', () => {
    expect(() =>
      defineDashboard({
        widgets: {
          w: {
            kind: 'stat',
            title: 'Deploys',
            metric,
            window: '7d',
            compare: 'previous-period',
          },
        },
      }),
    ).not.toThrow();
  });

  it('accepts a valid status widget', () => {
    expect(() =>
      defineDashboard({
        widgets: {
          w: { kind: 'status', title: 'CI', source: 'github' },
        },
      }),
    ).not.toThrow();
  });

  it('accepts a valid timeseries widget', () => {
    expect(() =>
      defineDashboard({
        widgets: {
          w: { kind: 'timeseries', title: 'Latency', metric, window: '7d' },
        },
      }),
    ).not.toThrow();
  });

  it('accepts a valid distribution widget', () => {
    expect(() =>
      defineDashboard({
        widgets: {
          w: {
            kind: 'distribution',
            title: 'Latency dist',
            metric,
            window: '1d',
          },
        },
      }),
    ).not.toThrow();
  });
});
