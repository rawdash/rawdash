import { describe, expect, it } from 'vitest';

import { TursoStorage } from './turso-storage';

function makeStorage(): TursoStorage {
  return new TursoStorage({ url: ':memory:' });
}

describe('TursoStorage — events', () => {
  it('appends via event() and filters by name', async () => {
    const s = makeStorage();
    const h = s.getStorageHandle('c');
    await h.event({
      name: 'run',
      start_ts: 1000,
      end_ts: 2000,
      attributes: { status: 'ok' },
    });
    await h.event({
      name: 'deploy',
      start_ts: 1500,
      end_ts: null,
      attributes: {},
    });
    const runs = await h.queryEvents({ name: 'run' });
    expect(runs).toHaveLength(1);
    expect(runs[0]!.attributes['status']).toBe('ok');
    await s.close();
  });

  it('batch replaces only scoped names', async () => {
    const s = makeStorage();
    const h = s.getStorageHandle('c');
    await h.events([
      { name: 'run', start_ts: 1000, end_ts: null, attributes: {} },
      { name: 'deploy', start_ts: 2000, end_ts: null, attributes: {} },
    ]);
    await h.events([
      { name: 'run', start_ts: 3000, end_ts: null, attributes: {} },
    ]);
    const all = await h.queryEvents({});
    expect(all).toHaveLength(2);
    const runs = await h.queryEvents({ name: 'run' });
    expect(runs).toHaveLength(1);
    expect(runs[0]!.start_ts).toBe(3000);
    await s.close();
  });

  it('filters events by start window', async () => {
    const s = makeStorage();
    const h = s.getStorageHandle('c');
    await h.events([
      { name: 'e', start_ts: 1000, end_ts: null, attributes: {} },
      { name: 'e', start_ts: 5000, end_ts: null, attributes: {} },
    ]);
    const results = await h.queryEvents({ start: 3000 });
    expect(results).toHaveLength(1);
    expect(results[0]!.start_ts).toBe(5000);
    await s.close();
  });
});

describe('TursoStorage — entities', () => {
  it('upserts via entity() by natural key', async () => {
    const s = makeStorage();
    const h = s.getStorageHandle('c');
    await h.entity({
      type: 'pr',
      id: '1',
      attributes: { state: 'open' },
      updated_at: 1000,
    });
    await h.entity({
      type: 'pr',
      id: '1',
      attributes: { state: 'closed' },
      updated_at: 2000,
    });
    const rows = await h.queryEntities({ type: 'pr' });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.attributes['state']).toBe('closed');
    await s.close();
  });

  it('entities() replaces types in batch, preserves others', async () => {
    const s = makeStorage();
    const h = s.getStorageHandle('c');
    await h.entity({
      type: 'user',
      id: 'alice',
      attributes: {},
      updated_at: 1000,
    });
    await h.entities([
      { type: 'pr', id: '1', attributes: {}, updated_at: 2000 },
    ]);
    expect(await h.queryEntities({ type: 'user' })).toHaveLength(1);
    expect(await h.queryEntities({ type: 'pr' })).toHaveLength(1);
    await h.entities([
      { type: 'pr', id: '2', attributes: {}, updated_at: 3000 },
    ]);
    const prs = await h.queryEntities({ type: 'pr' });
    expect(prs).toHaveLength(1);
    expect(prs[0]!.id).toBe('2');
    await s.close();
  });

  it('getEntity returns null for missing', async () => {
    const s = makeStorage();
    const h = s.getStorageHandle('c');
    await h.entity({
      type: 'pr',
      id: '1',
      attributes: { title: 'Fix' },
      updated_at: 1000,
    });
    expect((await h.getEntity('pr', '1'))?.attributes['title']).toBe('Fix');
    expect(await h.getEntity('pr', '999')).toBeNull();
    await s.close();
  });
});

describe('TursoStorage — metrics', () => {
  it('replaces metrics() by name', async () => {
    const s = makeStorage();
    const h = s.getStorageHandle('c');
    await h.metrics([
      { name: 'spend', ts: 1000, value: 10, attributes: {} },
      { name: 'clicks', ts: 1000, value: 100, attributes: {} },
    ]);
    await h.metrics([{ name: 'spend', ts: 2000, value: 20, attributes: {} }]);
    const spend = await h.queryMetrics({ name: 'spend' });
    expect(spend).toHaveLength(1);
    expect(spend[0]!.value).toBe(20);
    const clicks = await h.queryMetrics({ name: 'clicks' });
    expect(clicks).toHaveLength(1);
    await s.close();
  });
});

describe('TursoStorage — edges', () => {
  it('upserts edge by natural key', async () => {
    const s = makeStorage();
    const h = s.getStorageHandle('c');
    const base = {
      from_type: 'pr',
      from_id: '1',
      kind: 'reviewed_by',
      to_type: 'user',
      to_id: 'alice',
      updated_at: 1000,
    };
    await h.edge({ ...base, attributes: { state: 'PENDING' } });
    await h.edge({ ...base, attributes: { state: 'APPROVED' } });
    const results = await h.traverse({ fromId: '1', kind: 'reviewed_by' });
    expect(results).toHaveLength(1);
    expect(results[0]!.attributes['state']).toBe('APPROVED');
    await s.close();
  });

  it('edges() scoped delete by kind preserves other kinds', async () => {
    const s = makeStorage();
    const h = s.getStorageHandle('c');
    await h.edges([
      {
        from_type: 'pr',
        from_id: '1',
        kind: 'reviewed_by',
        to_type: 'user',
        to_id: 'alice',
        attributes: {},
        updated_at: 1,
      },
      {
        from_type: 'pr',
        from_id: '1',
        kind: 'labeled',
        to_type: 'label',
        to_id: 'bug',
        attributes: {},
        updated_at: 1,
      },
    ]);
    await h.edges([
      {
        from_type: 'pr',
        from_id: '2',
        kind: 'reviewed_by',
        to_type: 'user',
        to_id: 'bob',
        attributes: {},
        updated_at: 2,
      },
    ]);
    expect(await h.traverse({ kind: 'reviewed_by' })).toHaveLength(1);
    expect(await h.traverse({ kind: 'labeled' })).toHaveLength(1);
    await s.close();
  });
});

describe('TursoStorage — distributions', () => {
  it('round-trips histogram and summary', async () => {
    const s = makeStorage();
    const h = s.getStorageHandle('c');
    await h.distributions([
      {
        name: 'latency',
        ts: 1000,
        kind: 'histogram',
        data: { buckets: [{ le: 0.1, count: 5 }], count: 5, sum: 0.3 },
        attributes: {},
      },
      {
        name: 'rt',
        ts: 1000,
        kind: 'summary',
        data: { quantiles: [{ q: 0.5, value: 0.2 }], count: 10, sum: 2 },
        attributes: {},
      },
    ]);
    const histos = await h.queryDistributions({ name: 'latency' });
    expect(histos).toHaveLength(1);
    expect(histos[0]!.kind).toBe('histogram');
    if (histos[0]!.kind === 'histogram') {
      expect(histos[0]!.data.buckets).toHaveLength(1);
    }
    const summaries = await h.queryDistributions({ name: 'rt' });
    expect(summaries[0]!.kind).toBe('summary');
    await s.close();
  });
});

describe('TursoStorage — isolation + sync state', () => {
  it('isolates connectors', async () => {
    const s = makeStorage();
    const h1 = s.getStorageHandle('c1');
    const h2 = s.getStorageHandle('c2');
    await h1.event({
      name: 'run',
      start_ts: 1000,
      end_ts: null,
      attributes: {},
    });
    expect(await h2.queryEvents({})).toHaveLength(0);
    await s.close();
  });

  it('tracks sync lifecycle', async () => {
    const s = makeStorage();
    expect(s.getSyncState().status).toBe('idle');
    s.setSyncing();
    expect(s.getSyncState().status).toBe('syncing');
    s.setSyncSuccess();
    expect(s.getSyncState().status).toBe('idle');
    expect(s.getSyncState().lastSyncAt).not.toBeNull();
    s.setSyncError('boom');
    expect(s.getSyncState().status).toBe('error');
    expect(s.getSyncState().lastError).toBe('boom');
    await s.close();
  });
});
