import { describe, expect, it } from 'vitest';

import { projectRows, toEpochMs, toJsonValue, toNumber } from './project';
import type { QueryDefinition } from './query-config';

const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);

function query(overrides: Partial<QueryDefinition>): QueryDefinition {
  return {
    id: 'signups',
    sql: 'select 1',
    shape: 'stat',
    ...overrides,
  } as QueryDefinition;
}

describe('toNumber', () => {
  it('accepts numbers, numeric strings, and bigints', () => {
    expect(toNumber(4)).toBe(4);
    expect(toNumber('4.5')).toBe(4.5);
    expect(toNumber(7n)).toBe(7);
  });

  it('rejects non-numeric values', () => {
    expect(toNumber('abc')).toBeNull();
    expect(toNumber(null)).toBeNull();
    expect(toNumber(Number.NaN)).toBeNull();
    expect(toNumber('')).toBeNull();
  });
});

describe('toEpochMs', () => {
  it('accepts Date, epoch numbers, and ISO strings', () => {
    expect(toEpochMs(new Date(NOW))).toBe(NOW);
    expect(toEpochMs(NOW)).toBe(NOW);
    expect(toEpochMs('2026-01-15T12:00:00.000Z')).toBe(NOW);
  });

  it('rejects unparseable values', () => {
    expect(toEpochMs('not a date')).toBeNull();
    expect(toEpochMs(null)).toBeNull();
  });
});

describe('toJsonValue', () => {
  it('converts dates to epoch milliseconds and bigints to numbers', () => {
    expect(toJsonValue(new Date(NOW))).toBe(NOW);
    expect(toJsonValue(9n)).toBe(9);
  });

  it('walks arrays and objects', () => {
    expect(toJsonValue({ a: [1, new Date(NOW)] })).toEqual({ a: [1, NOW] });
  });
});

describe('projectRows — stat', () => {
  it('emits one sample from the first row, stamped at the sync time', () => {
    const result = projectRows(
      query({ shape: 'stat' }),
      [{ value: 42 }, { value: 99 }],
      NOW,
    );
    expect(result.metrics).toEqual([
      {
        name: 'signups',
        ts: NOW,
        value: 42,
        attributes: { queryId: 'signups' },
      },
    ]);
  });

  it('uses the sole column when it is not named value', () => {
    const result = projectRows(query({ shape: 'stat' }), [{ mrr: 1234 }], NOW);
    expect(result.metrics[0]?.value).toBe(1234);
  });

  it('honors an explicit value column', () => {
    const result = projectRows(
      query({ shape: 'stat', columns: { value: 'total_cents' } }),
      [{ total_cents: 500, other: 1 }],
      NOW,
    );
    expect(result.metrics[0]?.value).toBe(500);
  });

  it('skips a row with no usable numeric column', () => {
    const result = projectRows(
      query({ shape: 'stat' }),
      [{ label: 'x', other: 'y' }],
      NOW,
    );
    expect(result.metrics).toHaveLength(0);
    expect(result.skipped).toBe(1);
  });
});

describe('projectRows — timeseries', () => {
  it('emits one sample per row using the ts column', () => {
    const result = projectRows(
      query({ id: 'orders_per_day', shape: 'timeseries' }),
      [
        { ts: '2026-01-13T00:00:00Z', value: 3 },
        { ts: '2026-01-14T00:00:00Z', value: 5 },
      ],
      NOW,
    );
    expect(result.metrics.map((m) => [m.ts, m.value])).toEqual([
      [Date.UTC(2026, 0, 13), 3],
      [Date.UTC(2026, 0, 14), 5],
    ]);
  });

  it('carries a series dimension when the query groups', () => {
    const result = projectRows(
      query({ id: 'orders_per_day', shape: 'timeseries' }),
      [{ bucket: '2026-01-13T00:00:00Z', total: 3, series: 'web' }],
      NOW,
    );
    expect(result.metrics[0]?.attributes).toEqual({
      queryId: 'orders_per_day',
      series: 'web',
    });
  });

  it('skips rows without a parseable timestamp', () => {
    const result = projectRows(
      query({ id: 'orders_per_day', shape: 'timeseries' }),
      [{ ts: 'nope', value: 1 }],
      NOW,
    );
    expect(result.metrics).toHaveLength(0);
    expect(result.skipped).toBe(1);
  });
});

describe('projectRows — distribution', () => {
  it('stamps every group at the sync time and labels it with series', () => {
    const result = projectRows(
      query({ id: 'orders_by_status', shape: 'distribution' }),
      [
        { status: 'paid', count: 10 },
        { status: 'refunded', count: 2 },
      ],
      NOW,
    );
    expect(result.metrics).toEqual([
      {
        name: 'orders_by_status',
        ts: NOW,
        value: 10,
        attributes: { queryId: 'orders_by_status', series: 'paid' },
      },
      {
        name: 'orders_by_status',
        ts: NOW,
        value: 2,
        attributes: { queryId: 'orders_by_status', series: 'refunded' },
      },
    ]);
  });

  it('labels null group keys as unknown', () => {
    const result = projectRows(
      query({ id: 'orders_by_status', shape: 'distribution' }),
      [{ status: null, count: 1 }],
      NOW,
    );
    expect(result.metrics[0]?.attributes.series).toBe('unknown');
  });
});

describe('projectRows — entities', () => {
  it('upserts one entity per row keyed on the id column', () => {
    const result = projectRows(
      query({ id: 'top_accounts', shape: 'entities' }),
      [{ id: 7, name: 'Acme', updated_at: '2026-01-14T00:00:00Z' }],
      NOW,
    );
    expect(result.entities).toEqual([
      {
        type: 'top_accounts',
        id: '7',
        attributes: { name: 'Acme', updated_at: '2026-01-14T00:00:00Z' },
        updated_at: Date.UTC(2026, 0, 14),
      },
    ]);
  });

  it('falls back to the sync time when no updated_at column is present', () => {
    const result = projectRows(
      query({ id: 'top_accounts', shape: 'entities' }),
      [{ id: 'a', name: 'Acme' }],
      NOW,
    );
    expect(result.entities[0]?.updated_at).toBe(NOW);
  });

  it('skips rows with no id', () => {
    const result = projectRows(
      query({ id: 'top_accounts', shape: 'entities' }),
      [{ id: null, name: 'Acme' }, { name: 'NoId' }],
      NOW,
    );
    expect(result.entities).toHaveLength(0);
    expect(result.skipped).toBe(2);
  });
});
