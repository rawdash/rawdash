import { computeRetention } from '@rawdash/core';
import { InMemoryStorage } from '@rawdash/core';
import type { RetentionDeletionPlan } from '@rawdash/core';
import { describe, expect, it } from 'vitest';

import { applyRetention } from './retention';

const NOW = 1_000_000;

async function seed(storage: InMemoryStorage, connectorId: string) {
  const h = storage.getStorageHandle(connectorId);
  await h.events([
    { name: 'run', start_ts: 100, end_ts: null, attributes: { env: 'prod' } },
    { name: 'run', start_ts: 900, end_ts: null, attributes: { env: 'prod' } },
    { name: 'run', start_ts: 100, end_ts: null, attributes: { env: 'dev' } },
  ]);
  await h.metrics([
    { name: 'cpu', ts: 100, value: 1, attributes: { host: 'a' } },
    { name: 'cpu', ts: 900, value: 2, attributes: { host: 'a' } },
  ]);
  await h.distributions([
    {
      name: 'lat',
      ts: 100,
      kind: 'histogram',
      data: { buckets: [{ le: 1, count: 1 }], count: 1, sum: 1 },
      attributes: {},
    },
    {
      name: 'lat',
      ts: 900,
      kind: 'histogram',
      data: { buckets: [{ le: 1, count: 1 }], count: 1, sum: 1 },
      attributes: {},
    },
  ]);
  await h.entities([
    { type: 'pr', id: '1', attributes: { s: 'open' }, updated_at: NOW - 900 },
    { type: 'pr', id: '2', attributes: { s: 'open' }, updated_at: NOW - 100 },
  ]);
}

describe('applyRetention', () => {
  it('deletes exactly the rows named in a computeRetention plan across all four shapes', async () => {
    const storage = new InMemoryStorage();
    await seed(storage, 'c');

    const handle = storage.getStorageHandle('c');
    const plan = await computeRetention(
      handle,
      {
        watermarks: { run: 500, cpu: 500, lat: 500 },
        fetchSpecs: { pr: [] },
        gracePeriodMs: 500,
      },
      NOW,
    );

    expect(plan.events).toHaveLength(2);
    expect(plan.metrics).toHaveLength(1);
    expect(plan.distributions).toHaveLength(1);
    expect(plan.entities).toHaveLength(1);

    const totalPlanned =
      plan.events.length +
      plan.metrics.length +
      plan.distributions.length +
      plan.entities.length;

    const { rowsDeleted } = await applyRetention(storage, 'c', plan);
    expect(rowsDeleted).toBe(totalPlanned);

    const events = await handle.queryEvents({});
    expect(events).toEqual([
      { name: 'run', start_ts: 900, end_ts: null, attributes: { env: 'prod' } },
    ]);

    const metrics = await handle.queryMetrics({});
    expect(metrics).toHaveLength(1);
    expect(metrics[0]!.ts).toBe(900);

    const distributions = await handle.queryDistributions({});
    expect(distributions).toHaveLength(1);
    expect(distributions[0]!.ts).toBe(900);

    const entities = await handle.queryEntities({ type: 'pr' });
    expect(entities).toHaveLength(1);
    expect(entities[0]!.id).toBe('2');
  });

  it('deletes a row iff it is in the plan, discriminating by attributes serialization', async () => {
    const storage = new InMemoryStorage();
    const handle = storage.getStorageHandle('c');
    await handle.events([
      { name: 'run', start_ts: 100, end_ts: null, attributes: { env: 'prod' } },
      { name: 'run', start_ts: 100, end_ts: null, attributes: { env: 'dev' } },
    ]);

    const plan: RetentionDeletionPlan = {
      events: [
        {
          name: 'run',
          start_ts: 100,
          end_ts: null,
          attributes: { env: 'prod' },
        },
      ],
      metrics: [],
      distributions: [],
      entities: [],
    };

    const { rowsDeleted } = await applyRetention(storage, 'c', plan);
    expect(rowsDeleted).toBe(1);

    const survivors = await handle.queryEvents({});
    expect(survivors).toHaveLength(1);
    expect(survivors[0]!.attributes['env']).toBe('dev');
  });

  it('is a no-op for an empty plan', async () => {
    const storage = new InMemoryStorage();
    await seed(storage, 'c');

    const emptyPlan: RetentionDeletionPlan = {
      events: [],
      metrics: [],
      distributions: [],
      entities: [],
    };

    const { rowsDeleted } = await applyRetention(storage, 'c', emptyPlan);
    expect(rowsDeleted).toBe(0);

    const handle = storage.getStorageHandle('c');
    expect(await handle.queryEvents({})).toHaveLength(3);
  });
});
