import { describe, expect, it } from 'vitest';

import { computeMetric } from './compute';
import { InMemoryStorage } from './storage';

function makeHandle(connectorId = 'c') {
  const s = new InMemoryStorage();
  return s.getStorageHandle(connectorId);
}

const NOW = Date.now();
const DAY = 86_400_000;

describe('computeMetric — events', () => {
  it('counts all events', async () => {
    const h = makeHandle();
    await h.events([
      { name: 'run', start_ts: NOW - 1000, end_ts: null, attributes: {} },
      { name: 'run', start_ts: NOW - 2000, end_ts: null, attributes: {} },
    ]);
    const result = await computeMetric(h, {
      connectorId: 'c',
      shape: 'event',
      name: 'run',
      field: 'start_ts',
      fn: 'count',
    });
    expect(result).toBe(2);
  });

  it('returns latest attribute value', async () => {
    const h = makeHandle();
    await h.events([
      {
        name: 'run',
        start_ts: NOW - 2000,
        end_ts: null,
        attributes: { conclusion: 'failure' },
      },
      {
        name: 'run',
        start_ts: NOW - 1000,
        end_ts: null,
        attributes: { conclusion: 'success' },
      },
    ]);
    const result = await computeMetric(h, {
      connectorId: 'c',
      shape: 'event',
      name: 'run',
      field: 'conclusion',
      fn: 'latest',
    });
    expect(result).toBe('success');
  });

  it('applies window filter', async () => {
    const h = makeHandle();
    await h.events([
      { name: 'run', start_ts: NOW - 10 * DAY, end_ts: null, attributes: {} },
      { name: 'run', start_ts: NOW - 1 * DAY, end_ts: null, attributes: {} },
    ]);
    const result = await computeMetric(h, {
      connectorId: 'c',
      shape: 'event',
      name: 'run',
      field: 'start_ts',
      fn: 'count',
      window: '7d',
    });
    expect(result).toBe(1);
  });

  it('applies attribute filter', async () => {
    const h = makeHandle();
    await h.events([
      {
        name: 'run',
        start_ts: NOW - 1000,
        end_ts: null,
        attributes: { conclusion: 'success' },
      },
      {
        name: 'run',
        start_ts: NOW - 2000,
        end_ts: null,
        attributes: { conclusion: 'failure' },
      },
    ]);
    const result = await computeMetric(h, {
      connectorId: 'c',
      shape: 'event',
      name: 'run',
      field: 'start_ts',
      fn: 'count',
      filter: [{ field: 'conclusion', op: 'eq', value: 'success' }],
    });
    expect(result).toBe(1);
  });

  it('groups by day', async () => {
    const h = makeHandle();
    const day1 = new Date('2024-01-01T12:00:00Z').getTime();
    const day2 = new Date('2024-01-02T12:00:00Z').getTime();
    await h.events([
      { name: 'run', start_ts: day1, end_ts: null, attributes: {} },
      { name: 'run', start_ts: day1 + 3600_000, end_ts: null, attributes: {} },
      { name: 'run', start_ts: day2, end_ts: null, attributes: {} },
    ]);
    const result = await computeMetric(h, {
      connectorId: 'c',
      shape: 'event',
      name: 'run',
      field: 'start_ts',
      fn: 'count',
      groupBy: { field: 'start_ts', granularity: 'day' },
    });
    expect(Array.isArray(result)).toBe(true);
    const rows = result as Array<{ date: string; value: number }>;
    expect(rows).toHaveLength(2);
    expect(rows[0]!.date).toBe('2024-01-01');
    expect(rows[0]!.value).toBe(2);
    expect(rows[1]!.date).toBe('2024-01-02');
    expect(rows[1]!.value).toBe(1);
  });

  it('returns 0 when no events match name', async () => {
    const h = makeHandle();
    await h.events([
      { name: 'deploy', start_ts: NOW, end_ts: null, attributes: {} },
    ]);
    const result = await computeMetric(h, {
      connectorId: 'c',
      shape: 'event',
      name: 'run',
      field: 'start_ts',
      fn: 'count',
    });
    expect(result).toBe(0);
  });
});

describe('computeMetric — entities', () => {
  it('counts entities by type', async () => {
    const h = makeHandle();
    await h.entities([
      {
        type: 'pull_request',
        id: '1',
        attributes: { state: 'open' },
        updated_at: NOW,
      },
      {
        type: 'pull_request',
        id: '2',
        attributes: { state: 'open' },
        updated_at: NOW,
      },
    ]);
    const result = await computeMetric(h, {
      connectorId: 'c',
      shape: 'entity',
      entityType: 'pull_request',
      field: 'id',
      fn: 'count',
    });
    expect(result).toBe(2);
  });

  it('filters entities by attribute', async () => {
    const h = makeHandle();
    await h.entities([
      {
        type: 'issue',
        id: '1',
        attributes: { state: 'open' },
        updated_at: NOW,
      },
      {
        type: 'issue',
        id: '2',
        attributes: { state: 'closed' },
        updated_at: NOW,
      },
    ]);
    const result = await computeMetric(h, {
      connectorId: 'c',
      shape: 'entity',
      entityType: 'issue',
      field: 'id',
      fn: 'count',
      filter: [{ field: 'state', op: 'eq', value: 'open' }],
    });
    expect(result).toBe(1);
  });
});

describe('computeMetric — metrics shape', () => {
  it('sums metric values', async () => {
    const h = makeHandle();
    await h.metrics([
      {
        name: 'spend',
        ts: NOW - 1000,
        value: 10,
        attributes: { campaign: 'a' },
      },
      {
        name: 'spend',
        ts: NOW - 2000,
        value: 20,
        attributes: { campaign: 'b' },
      },
    ]);
    const result = await computeMetric(h, {
      connectorId: 'c',
      shape: 'metric',
      name: 'spend',
      field: 'value',
      fn: 'sum',
    });
    expect(result).toBe(30);
  });

  it('applies window to metrics', async () => {
    const h = makeHandle();
    await h.metrics([
      { name: 'spend', ts: NOW - 10 * DAY, value: 100, attributes: {} },
      { name: 'spend', ts: NOW - 1 * DAY, value: 5, attributes: {} },
    ]);
    const result = await computeMetric(h, {
      connectorId: 'c',
      shape: 'metric',
      name: 'spend',
      field: 'value',
      fn: 'sum',
      window: '7d',
    });
    expect(result).toBe(5);
  });
});

describe('computeMetric — or filters', () => {
  it('handles or clauses', async () => {
    const h = makeHandle();
    await h.events([
      {
        name: 'run',
        start_ts: NOW - 1000,
        end_ts: null,
        attributes: { conclusion: 'success' },
      },
      {
        name: 'run',
        start_ts: NOW - 2000,
        end_ts: null,
        attributes: { conclusion: 'failure' },
      },
      {
        name: 'run',
        start_ts: NOW - 3000,
        end_ts: null,
        attributes: { conclusion: 'cancelled' },
      },
    ]);
    const result = await computeMetric(h, {
      connectorId: 'c',
      shape: 'event',
      name: 'run',
      field: 'start_ts',
      fn: 'count',
      filter: [
        {
          or: [
            { field: 'conclusion', op: 'eq', value: 'success' },
            { field: 'conclusion', op: 'eq', value: 'failure' },
          ],
        },
      ],
    });
    expect(result).toBe(2);
  });
});
