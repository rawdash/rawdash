import { describe, expect, it } from 'vitest';

import type { Entity, Event, MetricSample, StorageHandle } from './connector';
import { computeRetention, selectForDeletion } from './retention';

const NOW = 1_000_000;
const getTs = (r: { ts: number }) => r.ts;

function makeRows(timestamps: number[]) {
  return timestamps.map((ts) => ({ ts }));
}

describe('selectForDeletion — no policy', () => {
  it('returns empty when neither maxAge nor maxSize is set', () => {
    const rows = makeRows([900, 800, 700]);
    expect(selectForDeletion(rows, getTs, {}, NOW)).toHaveLength(0);
  });
});

describe('selectForDeletion — maxAge', () => {
  it('marks rows older than maxAge as candidates', () => {
    const rows = makeRows([NOW - 100, NOW - 200, NOW - 500]);
    const toDelete = selectForDeletion(rows, getTs, { maxAge: 300 }, NOW);
    expect(toDelete).toHaveLength(1);
    expect(toDelete[0]!.ts).toBe(NOW - 500);
  });

  it('keeps all rows when none exceed maxAge', () => {
    const rows = makeRows([NOW - 100, NOW - 200]);
    expect(selectForDeletion(rows, getTs, { maxAge: 300 }, NOW)).toHaveLength(
      0,
    );
  });

  it('marks all rows when all exceed maxAge', () => {
    const rows = makeRows([NOW - 400, NOW - 500, NOW - 600]);
    const toDelete = selectForDeletion(rows, getTs, { maxAge: 300 }, NOW);
    expect(toDelete).toHaveLength(3);
  });
});

describe('selectForDeletion — maxSize', () => {
  it('keeps only the newest maxSize rows', () => {
    const rows = makeRows([NOW - 100, NOW - 200, NOW - 300, NOW - 400]);
    const toDelete = selectForDeletion(rows, getTs, { maxSize: 2 }, NOW);
    expect(toDelete).toHaveLength(2);
    expect(toDelete.map((r) => r.ts)).toEqual([NOW - 300, NOW - 400]);
  });

  it('returns empty when row count is within maxSize', () => {
    const rows = makeRows([NOW - 100, NOW - 200]);
    expect(selectForDeletion(rows, getTs, { maxSize: 5 }, NOW)).toHaveLength(0);
  });

  it('returns empty when row count equals maxSize', () => {
    const rows = makeRows([NOW - 100, NOW - 200]);
    expect(selectForDeletion(rows, getTs, { maxSize: 2 }, NOW)).toHaveLength(0);
  });
});

describe('selectForDeletion — floor', () => {
  it('always keeps newest floor rows even if maxAge would delete them', () => {
    const rows = makeRows([NOW - 500, NOW - 600, NOW - 700]);
    const toDelete = selectForDeletion(
      rows,
      getTs,
      { maxAge: 400, floor: 1 },
      NOW,
    );
    expect(toDelete).toHaveLength(2);
    expect(toDelete.map((r) => r.ts)).toEqual([NOW - 600, NOW - 700]);
  });

  it('always keeps newest floor rows even if maxSize would delete them', () => {
    const rows = makeRows([NOW - 100, NOW - 200, NOW - 300]);
    const toDelete = selectForDeletion(
      rows,
      getTs,
      { maxSize: 1, floor: 2 },
      NOW,
    );
    expect(toDelete).toHaveLength(1);
    expect(toDelete[0]!.ts).toBe(NOW - 300);
  });

  it('keeps all rows when floor >= total count', () => {
    const rows = makeRows([NOW - 100, NOW - 200]);
    const toDelete = selectForDeletion(
      rows,
      getTs,
      { maxSize: 0, floor: 2 },
      NOW,
    );
    expect(toDelete).toHaveLength(0);
  });
});

describe('selectForDeletion — combined maxAge + maxSize', () => {
  it('applies both rules as a union (OR)', () => {
    const rows = makeRows([NOW - 100, NOW - 200, NOW - 400, NOW - 500]);
    const toDelete = selectForDeletion(
      rows,
      getTs,
      { maxAge: 350, maxSize: 3 },
      NOW,
    );
    expect(toDelete.map((r) => r.ts).sort((a, b) => b - a)).toEqual([
      NOW - 400,
      NOW - 500,
    ]);
  });
});

function makeEvent(
  name: string,
  ts: number,
  attributes: Record<string, unknown> = {},
): Event {
  return {
    name,
    start_ts: ts,
    end_ts: null,
    attributes: attributes as Event['attributes'],
  };
}

function makeMetric(
  name: string,
  ts: number,
  attributes: Record<string, unknown> = {},
): MetricSample {
  return {
    name,
    ts,
    value: 1,
    attributes: attributes as MetricSample['attributes'],
  };
}

function makeEntity(
  type: string,
  id: string,
  updatedAt: number,
  attributes: Record<string, unknown> = {},
): Entity {
  return {
    type,
    id,
    updated_at: updatedAt,
    attributes: attributes as Entity['attributes'],
  };
}

function makeHandle(data: {
  events?: Event[];
  metrics?: MetricSample[];
  entities?: Entity[];
}): StorageHandle {
  return {
    event: async () => {},
    entity: async () => {},
    metric: async () => {},
    edge: async () => {},
    distribution: async () => {},
    events: async () => {},
    entities: async () => {},
    metrics: async () => {},
    edges: async () => {},
    distributions: async () => {},
    queryEvents: async () => data.events ?? [],
    getEntity: async () => null,
    queryEntities: async (q) =>
      (data.entities ?? []).filter((e) => e.type === q.type),
    queryMetrics: async () => data.metrics ?? [],
    traverse: async () => [],
    queryDistributions: async () => [],
    deleteOlderThan: async () => ({ rowsDeleted: 0 }),
  };
}

describe('computeRetention — watermark', () => {
  it('keeps raw rows at or after the watermark', async () => {
    const WATERMARK = NOW - 500;
    const handle = makeHandle({
      events: [
        makeEvent('deploys', NOW - 100),
        makeEvent('deploys', NOW - 600),
      ],
    });
    const plan = await computeRetention(
      handle,
      { watermarks: { deploys: WATERMARK } },
      NOW,
    );
    expect(plan.events).toHaveLength(1);
    expect(plan.events[0]!.start_ts).toBe(NOW - 600);
  });

  it('keeps all rows when no watermark is set', async () => {
    const handle = makeHandle({
      events: [makeEvent('deploys', NOW - 1000)],
    });
    const plan = await computeRetention(handle, {}, NOW);
    expect(plan.events).toHaveLength(0);
  });

  it('deletes rows before watermark when outside keep-set', async () => {
    const WATERMARK = NOW - 200;
    const handle = makeHandle({
      metrics: [
        makeMetric('requests', NOW - 100),
        makeMetric('requests', NOW - 500),
      ],
    });
    const plan = await computeRetention(
      handle,
      { watermarks: { requests: WATERMARK } },
      NOW,
    );
    expect(plan.metrics).toHaveLength(1);
    expect(plan.metrics[0]!.ts).toBe(NOW - 500);
  });
});

describe('computeRetention — FetchSpec keep-set', () => {
  it('keeps rows within a spec window', async () => {
    const WATERMARK = NOW - 100;
    const handle = makeHandle({
      events: [
        makeEvent('deploys', NOW - 500),
        makeEvent('deploys', NOW - 2000),
      ],
    });
    const plan = await computeRetention(
      handle,
      {
        fetchSpecs: { deploys: [{ requiredWindowMs: 1000 }] },
        watermarks: { deploys: WATERMARK },
      },
      NOW,
    );
    expect(plan.events).toHaveLength(1);
    expect(plan.events[0]!.start_ts).toBe(NOW - 2000);
  });

  it('keeps rows matching a spec filter', async () => {
    const WATERMARK = NOW - 100;
    const handle = makeHandle({
      metrics: [
        makeMetric('requests', NOW - 500, { env: 'prod' }),
        makeMetric('requests', NOW - 600, { env: 'staging' }),
      ],
    });
    const plan = await computeRetention(
      handle,
      {
        fetchSpecs: {
          requests: [{ filter: [{ field: 'env', op: 'eq', value: 'prod' }] }],
        },
        watermarks: { requests: WATERMARK },
      },
      NOW,
    );
    expect(plan.metrics).toHaveLength(1);
    expect(plan.metrics[0]!.attributes['env']).toBe('staging');
  });

  it('no-spec resource keeps nothing extra beyond watermark', async () => {
    const WATERMARK = NOW - 200;
    const handle = makeHandle({
      events: [
        makeEvent('logs', NOW - 100),
        makeEvent('logs', NOW - 500),
        makeEvent('logs', NOW - 1000),
      ],
    });
    const plan = await computeRetention(
      handle,
      { watermarks: { logs: WATERMARK } },
      NOW,
    );
    expect(plan.events).toHaveLength(2);
    expect(plan.events.map((e) => e.start_ts)).toEqual(
      expect.arrayContaining([NOW - 500, NOW - 1000]),
    );
  });
});

describe('computeRetention — entities', () => {
  it('keeps open PR regardless of age (no-window filter spec)', async () => {
    const handle = makeHandle({
      entities: [
        makeEntity('pull_request', 'pr-1', NOW - 100_000, { state: 'open' }),
      ],
    });
    const plan = await computeRetention(
      handle,
      {
        fetchSpecs: {
          pull_request: [
            { filter: [{ field: 'state', op: 'eq', value: 'open' }] },
          ],
        },
      },
      NOW,
    );
    expect(plan.entities).toHaveLength(0);
  });

  it('deletes closed PR past window and grace period', async () => {
    const WINDOW = 7 * 86_400_000;
    const GRACE = 86_400_000;
    const handle = makeHandle({
      entities: [
        makeEntity('pull_request', 'pr-2', NOW - WINDOW - GRACE - 1, {
          state: 'closed',
        }),
      ],
    });
    const plan = await computeRetention(
      handle,
      {
        fetchSpecs: {
          pull_request: [
            {
              filter: [{ field: 'state', op: 'eq', value: 'open' }],
            },
          ],
        },
        gracePeriodMs: GRACE,
      },
      NOW,
    );
    expect(plan.entities).toHaveLength(1);
    expect(plan.entities[0]!.id).toBe('pr-2');
  });

  it('keeps recently closed PR within grace period', async () => {
    const GRACE = 86_400_000;
    const handle = makeHandle({
      entities: [
        makeEntity('pull_request', 'pr-3', NOW - GRACE + 1000, {
          state: 'closed',
        }),
      ],
    });
    const plan = await computeRetention(
      handle,
      {
        fetchSpecs: {
          pull_request: [
            { filter: [{ field: 'state', op: 'eq', value: 'open' }] },
          ],
        },
        gracePeriodMs: GRACE,
      },
      NOW,
    );
    expect(plan.entities).toHaveLength(0);
  });

  it('keeps entity within windowed spec when updated_at is recent', async () => {
    const WINDOW = 30 * 86_400_000;
    const handle = makeHandle({
      entities: [
        makeEntity('issue', 'i-1', NOW - 10 * 86_400_000, { state: 'closed' }),
        makeEntity('issue', 'i-2', NOW - 60 * 86_400_000, { state: 'closed' }),
      ],
    });
    const plan = await computeRetention(
      handle,
      {
        fetchSpecs: {
          issue: [{ requiredWindowMs: WINDOW }],
        },
        gracePeriodMs: 0,
      },
      NOW,
    );
    expect(plan.entities).toHaveLength(1);
    expect(plan.entities[0]!.id).toBe('i-2');
  });

  it('does not touch entities from types not in fetchSpecs', async () => {
    const handle = makeHandle({
      entities: [
        makeEntity('pull_request', 'pr-1', NOW - 999_999, { state: 'closed' }),
        makeEntity('issue', 'i-1', NOW - 999_999, { state: 'closed' }),
      ],
    });
    const plan = await computeRetention(
      handle,
      {
        fetchSpecs: {
          pull_request: [
            { filter: [{ field: 'state', op: 'eq', value: 'open' }] },
          ],
        },
        gracePeriodMs: 0,
      },
      NOW,
    );
    const ids = plan.entities.map((e) => e.id);
    expect(ids).toContain('pr-1');
    expect(ids).not.toContain('i-1');
  });
});
