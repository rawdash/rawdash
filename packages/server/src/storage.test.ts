import { describe, expect, it } from 'vitest';

import { InMemoryStorage } from './storage';

function makeStorage() {
  const s = new InMemoryStorage();
  return { storage: s, handle: s.getStorageHandle('test-connector') };
}

describe('InMemoryStorage — events', () => {
  it('appends via event()', async () => {
    const { handle } = makeStorage();
    await handle.event({
      name: 'run',
      start_ts: 1000,
      end_ts: 2000,
      attributes: { status: 'ok' },
    });
    await handle.event({
      name: 'run',
      start_ts: 3000,
      end_ts: 4000,
      attributes: { status: 'fail' },
    });
    const results = await handle.queryEvents({});
    expect(results).toHaveLength(2);
  });

  it('replaces via events()', async () => {
    const { handle } = makeStorage();
    await handle.event({
      name: 'run',
      start_ts: 1000,
      end_ts: null,
      attributes: {},
    });
    await handle.events([
      { name: 'run', start_ts: 5000, end_ts: 6000, attributes: {} },
    ]);
    const results = await handle.queryEvents({});
    expect(results).toHaveLength(1);
    expect(results[0]!.start_ts).toBe(5000);
  });

  it('filters by name', async () => {
    const { handle } = makeStorage();
    await handle.events([
      { name: 'run', start_ts: 1000, end_ts: null, attributes: {} },
      { name: 'deploy', start_ts: 2000, end_ts: null, attributes: {} },
    ]);
    const results = await handle.queryEvents({ name: 'run' });
    expect(results).toHaveLength(1);
    expect(results[0]!.name).toBe('run');
  });

  it('events([], { names }) clears the named scope', async () => {
    const { handle } = makeStorage();
    await handle.events([
      { name: 'run', start_ts: 1000, end_ts: null, attributes: {} },
      { name: 'deploy', start_ts: 2000, end_ts: null, attributes: {} },
    ]);
    await handle.events([], { names: ['run'] });
    const runs = await handle.queryEvents({ name: 'run' });
    const deploys = await handle.queryEvents({ name: 'deploy' });
    expect(runs).toHaveLength(0);
    expect(deploys).toHaveLength(1);
  });

  it('events() preserves other names across calls', async () => {
    const { handle } = makeStorage();
    await handle.events([
      { name: 'run', start_ts: 1000, end_ts: null, attributes: {} },
    ]);
    await handle.events([
      { name: 'deploy', start_ts: 2000, end_ts: null, attributes: {} },
    ]);
    const runs = await handle.queryEvents({ name: 'run' });
    const deploys = await handle.queryEvents({ name: 'deploy' });
    expect(runs).toHaveLength(1);
    expect(deploys).toHaveLength(1);
  });

  it('filters by start window', async () => {
    const { handle } = makeStorage();
    await handle.events([
      { name: 'e', start_ts: 1000, end_ts: null, attributes: {} },
      { name: 'e', start_ts: 5000, end_ts: null, attributes: {} },
    ]);
    const results = await handle.queryEvents({ start: 3000 });
    expect(results).toHaveLength(1);
    expect(results[0]!.start_ts).toBe(5000);
  });
});

describe('InMemoryStorage — entities', () => {
  it('upserts via entity()', async () => {
    const { handle } = makeStorage();
    await handle.entity({
      type: 'pr',
      id: '1',
      attributes: { state: 'open' },
      updated_at: 1000,
    });
    await handle.entity({
      type: 'pr',
      id: '1',
      attributes: { state: 'closed' },
      updated_at: 2000,
    });
    const results = await handle.queryEntities({ type: 'pr' });
    expect(results).toHaveLength(1);
    expect(results[0]!.attributes['state']).toBe('closed');
  });

  it('batch upserts via entities()', async () => {
    const { handle } = makeStorage();
    await handle.entities([
      { type: 'pr', id: '1', attributes: {}, updated_at: 1000 },
      { type: 'pr', id: '2', attributes: {}, updated_at: 2000 },
    ]);
    const results = await handle.queryEntities({ type: 'pr' });
    expect(results).toHaveLength(2);
  });

  it('entities() replaces all for the type', async () => {
    const { handle } = makeStorage();
    await handle.entity({
      type: 'pr',
      id: '1',
      attributes: {},
      updated_at: 1000,
    });
    await handle.entities([
      { type: 'pr', id: '2', attributes: {}, updated_at: 2000 },
    ]);
    const results = await handle.queryEntities({ type: 'pr' });
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe('2');
  });

  it('entities([], { types }) clears the type scope', async () => {
    const { handle } = makeStorage();
    await handle.entity({
      type: 'pr',
      id: '1',
      attributes: {},
      updated_at: 1000,
    });
    await handle.entity({
      type: 'user',
      id: 'alice',
      attributes: {},
      updated_at: 1000,
    });
    await handle.entities([], { types: ['pr'] });
    const prs = await handle.queryEntities({ type: 'pr' });
    const users = await handle.queryEntities({ type: 'user' });
    expect(prs).toHaveLength(0);
    expect(users).toHaveLength(1);
  });

  it('entities() preserves entity types not in the batch', async () => {
    const { handle } = makeStorage();
    await handle.entity({
      type: 'user',
      id: 'alice',
      attributes: {},
      updated_at: 1000,
    });
    await handle.entities([
      { type: 'pr', id: '1', attributes: {}, updated_at: 2000 },
    ]);
    const users = await handle.queryEntities({ type: 'user' });
    expect(users).toHaveLength(1);
    const prs = await handle.queryEntities({ type: 'pr' });
    expect(prs).toHaveLength(1);
  });

  it('getEntity returns correct entity', async () => {
    const { handle } = makeStorage();
    await handle.entity({
      type: 'pr',
      id: '42',
      attributes: { title: 'Fix' },
      updated_at: 1000,
    });
    const found = await handle.getEntity('pr', '42');
    expect(found?.attributes['title']).toBe('Fix');
    const missing = await handle.getEntity('pr', '999');
    expect(missing).toBeNull();
  });
});

describe('InMemoryStorage — metrics', () => {
  it('replaces via metrics()', async () => {
    const { handle } = makeStorage();
    await handle.metric({ name: 'spend', ts: 1000, value: 10, attributes: {} });
    await handle.metrics([
      { name: 'spend', ts: 2000, value: 20, attributes: {} },
    ]);
    const results = await handle.queryMetrics({});
    expect(results).toHaveLength(1);
    expect(results[0]!.value).toBe(20);
  });

  it('filters metrics by time range', async () => {
    const { handle } = makeStorage();
    await handle.metrics([
      { name: 'spend', ts: 1000, value: 10, attributes: {} },
      { name: 'spend', ts: 5000, value: 50, attributes: {} },
    ]);
    const results = await handle.queryMetrics({ start: 3000 });
    expect(results).toHaveLength(1);
    expect(results[0]!.value).toBe(50);
  });
});

describe('InMemoryStorage — edges', () => {
  it('upserts by (from_type, from_id, kind, to_id)', async () => {
    const { handle } = makeStorage();
    const base = {
      from_type: 'pr',
      from_id: '1',
      kind: 'reviewed_by',
      to_type: 'user',
      to_id: 'alice',
      updated_at: 1000,
    };
    await handle.edge({ ...base, attributes: { state: 'PENDING' } });
    await handle.edge({ ...base, attributes: { state: 'APPROVED' } });
    const results = await handle.traverse({ fromId: '1', kind: 'reviewed_by' });
    expect(results).toHaveLength(1);
    expect(results[0]!.attributes['state']).toBe('APPROVED');
  });

  it('edges([], { kinds }) clears the kind scope', async () => {
    const { handle } = makeStorage();
    await handle.edges([
      {
        from_type: 'pr',
        from_id: '1',
        kind: 'reviewed_by',
        to_type: 'user',
        to_id: 'alice',
        attributes: {},
        updated_at: 1000,
      },
      {
        from_type: 'pr',
        from_id: '1',
        kind: 'labeled',
        to_type: 'label',
        to_id: 'bug',
        attributes: {},
        updated_at: 1000,
      },
    ]);
    await handle.edges([], { kinds: ['reviewed_by'] });
    const reviews = await handle.traverse({ kind: 'reviewed_by' });
    const labels = await handle.traverse({ kind: 'labeled' });
    expect(reviews).toHaveLength(0);
    expect(labels).toHaveLength(1);
  });

  it('edges() preserves other kinds across calls', async () => {
    const { handle } = makeStorage();
    await handle.edges([
      {
        from_type: 'pr',
        from_id: '1',
        kind: 'reviewed_by',
        to_type: 'user',
        to_id: 'alice',
        attributes: {},
        updated_at: 1000,
      },
    ]);
    await handle.edges([
      {
        from_type: 'pr',
        from_id: '1',
        kind: 'labeled',
        to_type: 'label',
        to_id: 'bug',
        attributes: {},
        updated_at: 1000,
      },
    ]);
    const reviews = await handle.traverse({ kind: 'reviewed_by' });
    const labels = await handle.traverse({ kind: 'labeled' });
    expect(reviews).toHaveLength(1);
    expect(labels).toHaveLength(1);
  });

  it('edges() upserts existing keys with to_type distinct', async () => {
    const { handle } = makeStorage();
    await handle.edges([
      {
        from_type: 'pr',
        from_id: '1',
        kind: 'reviewed_by',
        to_type: 'user',
        to_id: 'alice',
        attributes: { state: 'PENDING' },
        updated_at: 1000,
      },
      {
        from_type: 'pr',
        from_id: '1',
        kind: 'reviewed_by',
        to_type: 'team',
        to_id: 'alice',
        attributes: { state: 'REQUESTED' },
        updated_at: 1000,
      },
    ]);
    const all = await handle.traverse({ kind: 'reviewed_by' });
    expect(all).toHaveLength(2);
  });

  it('traverses by kind', async () => {
    const { handle } = makeStorage();
    await handle.edges([
      {
        from_type: 'pr',
        from_id: '1',
        kind: 'reviewed_by',
        to_type: 'user',
        to_id: 'alice',
        attributes: {},
        updated_at: 1000,
      },
      {
        from_type: 'pr',
        from_id: '1',
        kind: 'labeled',
        to_type: 'label',
        to_id: 'bug',
        attributes: {},
        updated_at: 1000,
      },
    ]);
    const reviews = await handle.traverse({ kind: 'reviewed_by' });
    expect(reviews).toHaveLength(1);
  });
});

describe('InMemoryStorage — distributions', () => {
  it('replaces via distributions()', async () => {
    const { handle } = makeStorage();
    await handle.distribution({
      name: 'latency',
      ts: 1000,
      kind: 'histogram',
      data: { buckets: [], count: 0, sum: 0 },
      attributes: {},
    });
    await handle.distributions([
      {
        name: 'latency',
        ts: 2000,
        kind: 'histogram',
        data: { buckets: [{ le: 0.1, count: 5 }], count: 5, sum: 0.3 },
        attributes: {},
      },
    ]);
    const results = await handle.queryDistributions({});
    expect(results).toHaveLength(1);
    expect(results[0]!.ts).toBe(2000);
  });
});

describe('InMemoryStorage — sync state', () => {
  it('tracks sync lifecycle', () => {
    const { storage } = makeStorage();
    expect(storage.getSyncState().status).toBe('idle');
    storage.setSyncing();
    expect(storage.getSyncState().status).toBe('syncing');
    storage.setSyncSuccess();
    expect(storage.getSyncState().status).toBe('idle');
    expect(storage.getSyncState().lastSyncAt).not.toBeNull();
    storage.setSyncError('oops');
    expect(storage.getSyncState().status).toBe('error');
    expect(storage.getSyncState().lastError).toBe('oops');
  });

  it('isolates connectors', async () => {
    const s = new InMemoryStorage();
    const h1 = s.getStorageHandle('c1');
    const h2 = s.getStorageHandle('c2');
    await h1.event({
      name: 'run',
      start_ts: 1000,
      end_ts: null,
      attributes: {},
    });
    const c2Events = await h2.queryEvents({});
    expect(c2Events).toHaveLength(0);
  });
});
