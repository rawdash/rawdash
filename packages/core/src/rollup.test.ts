import { describe, expect, it } from 'vitest';

import { computeMetric } from './compute';
import type { ComputedMetric, DashboardConfig } from './config';
import type {
  Event,
  MetricSample,
  RollupBucket,
  StorageHandle,
} from './connector';
import { InMemoryStorage } from './in-memory-storage';
import {
  type RollupSpec,
  aggFromPartials,
  computeRollupSpecs,
  emptyPartials,
  foldResourceRollups,
  foldValueIntoPartials,
  mergePartials,
} from './rollup';
import { bucketStartMs } from './time-buckets';

const DAY = 86_400_000;
const DAY0 = Date.UTC(2026, 0, 1);
const dayN = (n: number) => DAY0 + n * DAY;

function handle(connectorId = 'c'): StorageHandle {
  return new InMemoryStorage().getStorageHandle(connectorId);
}

function ev(start_ts: number, attributes: Event['attributes'] = {}): Event {
  return { name: 'run', start_ts, end_ts: null, attributes };
}

function mtr(
  ts: number,
  value: number,
  attributes: MetricSample['attributes'] = {},
): MetricSample {
  return { name: 'latency', ts, value, attributes };
}

describe('partials primitive', () => {
  it('folds and merges to match direct aggregation', () => {
    const values = [3, 1, 4, 1, 5, 9, 2, 6];
    const a = emptyPartials();
    values.slice(0, 4).forEach((v, i) => foldValueIntoPartials(a, dayN(i), v));
    const b = emptyPartials();
    values.slice(4).forEach((v, i) => foldValueIntoPartials(b, dayN(i + 4), v));
    const merged = mergePartials(a, b);

    expect(aggFromPartials('count', merged)).toBe(8);
    expect(aggFromPartials('sum', merged)).toBe(31);
    expect(aggFromPartials('avg', merged)).toBeCloseTo(31 / 8);
    expect(aggFromPartials('min', merged)).toBe(1);
    expect(aggFromPartials('max', merged)).toBe(9);
    expect(aggFromPartials('first', merged)).toBe(3);
    expect(aggFromPartials('latest', merged)).toBe(6);
  });

  it('treats avg/min/max of empty as null and sum as 0', () => {
    const p = emptyPartials();
    expect(aggFromPartials('count', p)).toBe(0);
    expect(aggFromPartials('sum', p)).toBe(0);
    expect(aggFromPartials('avg', p)).toBeNull();
    expect(aggFromPartials('min', p)).toBeNull();
    expect(aggFromPartials('max', p)).toBeNull();
  });
});

function configWith(widgets: Record<string, unknown>): DashboardConfig {
  return {
    connectors: [],
    dashboards: { d: { widgets } },
  } as unknown as DashboardConfig;
}

describe('computeRollupSpecs', () => {
  it('takes the finest granularity across widgets and unions dim fields', () => {
    const specs = computeRollupSpecs(
      configWith({
        a: {
          kind: 'timeseries',
          title: 'a',
          window: '30d',
          granularity: 'day',
          metric: {
            connectorId: 'gh',
            shape: 'event',
            name: 'run',
            fn: 'count',
            filter: [{ field: 'status', op: 'eq', value: 'done' }],
          },
        },
        b: {
          kind: 'timeseries',
          title: 'b',
          window: '7d',
          granularity: 'hour',
          metric: {
            connectorId: 'gh',
            shape: 'event',
            name: 'run',
            fn: 'sum',
            field: 'duration',
            filter: [{ field: 'branch', op: 'neq', value: 'main' }],
          },
        },
      }),
    );
    const spec = specs.get('gh')?.get('run');
    expect(spec?.granularity).toBe('hour');
    expect(spec?.dimFields).toEqual(['branch', 'status']);
    expect(spec?.signatures).toEqual([
      { fn: 'count', field: undefined },
      { fn: 'sum', field: 'duration' },
    ]);
  });

  it('ignores non-rollup shapes and range-only filter fields', () => {
    const specs = computeRollupSpecs(
      configWith({
        entityWidget: {
          kind: 'stat',
          title: 'e',
          metric: {
            connectorId: 'gh',
            shape: 'entity',
            name: 'pr',
            fn: 'count',
          },
        },
        rangeFilter: {
          kind: 'stat',
          title: 'r',
          metric: {
            connectorId: 'gh',
            shape: 'metric',
            name: 'latency',
            fn: 'avg',
            field: 'value',
            filter: [{ field: 'value', op: 'gt', value: 100 }],
          },
        },
      }),
    );
    expect(specs.get('gh')?.has('pr')).toBe(false);
    expect(specs.get('gh')?.get('latency')?.dimFields).toEqual([]);
  });

  it('throws when one resource name is used by two shapes on a connector', () => {
    expect(() =>
      computeRollupSpecs(
        configWith({
          a: {
            kind: 'stat',
            title: 'a',
            metric: {
              connectorId: 'gh',
              shape: 'event',
              name: 'x',
              fn: 'count',
            },
          },
          b: {
            kind: 'stat',
            title: 'b',
            metric: {
              connectorId: 'gh',
              shape: 'metric',
              name: 'x',
              field: 'value',
              fn: 'sum',
            },
          },
        }),
      ),
    ).toThrow(/multiple shapes/);
  });
});

const countSpec = (
  granularity: RollupSpec['granularity'] = 'day',
): RollupSpec => ({
  resource: 'run',
  shape: 'event',
  granularity,
  dimFields: [],
  signatures: [{ fn: 'count', field: undefined }],
});

describe('foldResourceRollups', () => {
  it('folds only complete buckets and advances the watermark', async () => {
    const h = handle();
    await h.events([ev(dayN(0)), ev(dayN(0)), ev(dayN(1)), ev(dayN(2))]);
    const now = dayN(2) + DAY / 2;

    const result = await foldResourceRollups(h, countSpec(), now);

    expect(result.watermark).toBe(bucketStartMs(now, 'day'));
    const buckets = await h.queryRollups!({ resource: 'run' });
    expect(buckets.map((b) => b.bucketStart).sort()).toEqual([
      dayN(0),
      dayN(1),
    ]);
    expect(buckets.find((b) => b.bucketStart === dayN(0))?.partials.count).toBe(
      2,
    );
    expect(await h.getRollupWatermark!('run')).toBe(dayN(2));
  });

  it('is idempotent across repeated folds', async () => {
    const h = handle();
    await h.events([ev(dayN(0)), ev(dayN(0)), ev(dayN(1))]);
    const now = dayN(2);
    await foldResourceRollups(h, countSpec(), now);
    await foldResourceRollups(h, countSpec(), now);
    const buckets = await h.queryRollups!({ resource: 'run' });
    const total = buckets.reduce((s, b) => s + b.partials.count, 0);
    expect(total).toBe(3);
  });
});

describe('computeMetric read-merge', () => {
  it('answers a no-window count from buckets after raw is dropped', async () => {
    const h = handle();
    const events = [
      ev(dayN(0)),
      ev(dayN(0)),
      ev(dayN(1)),
      ev(dayN(2)),
      ev(dayN(3) + 1000),
    ];
    await h.events(events);
    const now = dayN(3) + DAY / 2;

    await foldResourceRollups(h, countSpec(), now);
    const watermark = (await h.getRollupWatermark!('run'))!;
    await h.deleteOlderThan('events', watermark);

    const metric: ComputedMetric = {
      connectorId: 'c',
      shape: 'event',
      name: 'run',
      fn: 'count',
    };
    expect(await computeMetric(h, metric)).toBe(5);
  });

  it('merges numeric aggregates across the watermark', async () => {
    const h = handle();
    await h.metrics([
      mtr(dayN(0), 10),
      mtr(dayN(1), 20),
      mtr(dayN(2) + 500, 30),
    ]);
    const now = dayN(2) + DAY / 2;
    const spec: RollupSpec = {
      resource: 'latency',
      shape: 'metric',
      granularity: 'day',
      dimFields: [],
      signatures: [
        { fn: 'sum', field: 'value' },
        { fn: 'avg', field: 'value' },
        { fn: 'max', field: 'value' },
      ],
    };
    await foldResourceRollups(h, spec, now);
    await h.deleteOlderThan(
      'metrics',
      (await h.getRollupWatermark!('latency'))!,
    );

    const base: ComputedMetric = {
      connectorId: 'c',
      shape: 'metric',
      name: 'latency',
      field: 'value',
      fn: 'sum',
    };
    expect(await computeMetric(h, base)).toBe(60);
    expect(await computeMetric(h, { ...base, fn: 'avg' })).toBe(20);
    expect(await computeMetric(h, { ...base, fn: 'max' })).toBe(30);
  });

  it('restricts results to a rolled-up dimension value', async () => {
    const h = handle();
    await h.events([
      ev(dayN(0), { status: 'open' }),
      ev(dayN(0), { status: 'closed' }),
      ev(dayN(1), { status: 'open' }),
    ]);
    const now = dayN(2);
    const spec: RollupSpec = {
      resource: 'run',
      shape: 'event',
      granularity: 'day',
      dimFields: ['status'],
      signatures: [{ fn: 'count', field: undefined }],
    };
    await foldResourceRollups(h, spec, now);
    await h.deleteOlderThan('events', (await h.getRollupWatermark!('run'))!);

    const metric: ComputedMetric = {
      connectorId: 'c',
      shape: 'event',
      name: 'run',
      fn: 'count',
      filter: [{ field: 'status', op: 'eq', value: 'open' }],
    };
    expect(await computeMetric(h, metric)).toBe(2);
  });

  it('produces a grouped time series merging buckets and raw tail', async () => {
    const h = handle();
    await h.events([ev(dayN(0)), ev(dayN(1)), ev(dayN(1)), ev(dayN(2) + 1000)]);
    const now = dayN(2) + DAY / 2;
    await foldResourceRollups(h, countSpec(), now);
    await h.deleteOlderThan('events', (await h.getRollupWatermark!('run'))!);

    const metric: ComputedMetric = {
      connectorId: 'c',
      shape: 'event',
      name: 'run',
      fn: 'count',
      groupBy: { field: 'start_ts', granularity: 'day' },
    };
    expect(await computeMetric(h, metric)).toEqual([
      { date: '2026-01-01', value: 1 },
      { date: '2026-01-02', value: 2 },
      { date: '2026-01-03', value: 1 },
    ]);
  });

  it('falls back to raw for a non-dim (range) filter', async () => {
    const h = handle();
    await h.metrics([mtr(dayN(0), 50), mtr(dayN(1), 150)]);
    const now = dayN(2);
    const spec: RollupSpec = {
      resource: 'latency',
      shape: 'metric',
      granularity: 'day',
      dimFields: [],
      signatures: [{ fn: 'count', field: undefined }],
    };
    await foldResourceRollups(h, spec, now);

    const metric: ComputedMetric = {
      connectorId: 'c',
      shape: 'metric',
      name: 'latency',
      fn: 'count',
      filter: [{ field: 'value', op: 'gt', value: 100 }],
    };
    expect(await computeMetric(h, metric)).toBe(1);
  });

  it('falls back to raw when a stored bucket lacks a required dim field', async () => {
    const h = handle();
    const bucket: RollupBucket = {
      resource: 'run',
      field: '',
      granularity: 'day',
      dims: {},
      bucketStart: dayN(0),
      partials: { ...emptyPartials(), count: 99 },
    };
    await h.writeRollups!([bucket]);
    await h.setRollupWatermark!('run', dayN(1));
    await h.events([ev(dayN(2), { status: 'open' })]);

    const metric: ComputedMetric = {
      connectorId: 'c',
      shape: 'event',
      name: 'run',
      fn: 'count',
      filter: [{ field: 'status', op: 'eq', value: 'open' }],
    };
    expect(await computeMetric(h, metric)).toBe(1);
  });
});

describe('watermark monotonicity', () => {
  it('never regresses to an older value', async () => {
    const h = handle();
    await h.setRollupWatermark!('run', 8000);
    await h.setRollupWatermark!('run', 5000);
    expect(await h.getRollupWatermark!('run')).toBe(8000);
  });
});
