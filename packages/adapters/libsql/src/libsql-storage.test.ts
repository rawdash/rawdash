import { type Client, createClient } from '@libsql/client';
import { describe, expect, it, vi } from 'vitest';

import { LibsqlStorage } from './libsql-storage';

function makeStorage(url = ':memory:'): {
  storage: LibsqlStorage;
  client: Client;
} {
  const client = createClient({ url });
  const storage = new LibsqlStorage({ client });
  return { storage, client };
}

describe('LibsqlStorage — events', () => {
  it('appends via event() and filters by name', async () => {
    const { storage: s } = makeStorage();
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
    const { storage: s } = makeStorage();
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
    const { storage: s } = makeStorage();
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

describe('LibsqlStorage — entities', () => {
  it('upserts via entity() by natural key', async () => {
    const { storage: s } = makeStorage();
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
    const { storage: s } = makeStorage();
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
    const { storage: s } = makeStorage();
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

describe('LibsqlStorage — metrics', () => {
  it('replaces metrics() by name', async () => {
    const { storage: s } = makeStorage();
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

describe('LibsqlStorage — edges', () => {
  it('upserts edge by natural key', async () => {
    const { storage: s } = makeStorage();
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
    const { storage: s } = makeStorage();
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

describe('LibsqlStorage — distributions', () => {
  it('round-trips histogram and summary', async () => {
    const { storage: s } = makeStorage();
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

describe('LibsqlStorage — deleteOlderThan (events)', () => {
  it('deletes events with start_ts strictly less than threshold', async () => {
    const { storage: s } = makeStorage();
    const h = s.getStorageHandle('c');
    await h.events([
      { name: 'e', start_ts: 1000, end_ts: null, attributes: {} },
      { name: 'e', start_ts: 2000, end_ts: null, attributes: {} },
      { name: 'e', start_ts: 3000, end_ts: null, attributes: {} },
    ]);
    const { rowsDeleted } = await h.deleteOlderThan('events', 2000);
    expect(rowsDeleted).toBe(1);
    const remaining = await h.queryEvents({});
    expect(remaining).toHaveLength(2);
    expect(remaining.every((r) => r.start_ts >= 2000)).toBe(true);
    await s.close();
  });

  it('returns zero when nothing is old enough', async () => {
    const { storage: s } = makeStorage();
    const h = s.getStorageHandle('c');
    await h.event({ name: 'e', start_ts: 5000, end_ts: null, attributes: {} });
    const { rowsDeleted } = await h.deleteOlderThan('events', 1000);
    expect(rowsDeleted).toBe(0);
    expect(await h.queryEvents({})).toHaveLength(1);
    await s.close();
  });

  it('is scoped to the connector — does not delete other connectors rows', async () => {
    const { storage: s } = makeStorage();
    const h1 = s.getStorageHandle('c1');
    const h2 = s.getStorageHandle('c2');
    await h1.event({ name: 'e', start_ts: 500, end_ts: null, attributes: {} });
    await h2.event({ name: 'e', start_ts: 500, end_ts: null, attributes: {} });
    const { rowsDeleted } = await h1.deleteOlderThan('events', 1000);
    expect(rowsDeleted).toBe(1);
    expect(await h2.queryEvents({})).toHaveLength(1);
    await s.close();
  });
});

describe('LibsqlStorage — deleteOlderThan (metrics)', () => {
  it('deletes metrics with ts strictly less than threshold', async () => {
    const { storage: s } = makeStorage();
    const h = s.getStorageHandle('c');
    await h.metrics([
      { name: 'm', ts: 100, value: 1, attributes: {} },
      { name: 'm', ts: 200, value: 2, attributes: {} },
      { name: 'm', ts: 300, value: 3, attributes: {} },
    ]);
    const { rowsDeleted } = await h.deleteOlderThan('metrics', 200);
    expect(rowsDeleted).toBe(1);
    const remaining = await h.queryMetrics({});
    expect(remaining).toHaveLength(2);
    expect(remaining.every((r) => r.ts >= 200)).toBe(true);
    await s.close();
  });
});

describe('LibsqlStorage — deleteOlderThan (distributions)', () => {
  it('deletes distributions with ts strictly less than threshold', async () => {
    const { storage: s } = makeStorage();
    const h = s.getStorageHandle('c');
    await h.distributions([
      {
        name: 'lat',
        ts: 100,
        kind: 'histogram',
        data: { buckets: [], count: 0, sum: 0 },
        attributes: {},
      },
      {
        name: 'lat',
        ts: 200,
        kind: 'histogram',
        data: { buckets: [], count: 0, sum: 0 },
        attributes: {},
      },
      {
        name: 'lat',
        ts: 300,
        kind: 'histogram',
        data: { buckets: [], count: 0, sum: 0 },
        attributes: {},
      },
    ]);
    const { rowsDeleted } = await h.deleteOlderThan('distributions', 250);
    expect(rowsDeleted).toBe(2);
    const remaining = await h.queryDistributions({});
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.ts).toBe(300);
    await s.close();
  });
});

describe('LibsqlStorage — isolation + sync state', () => {
  it('isolates connectors', async () => {
    const { storage: s } = makeStorage();
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

  it('sync state is durable across storage instances sharing a file', async () => {
    const tmp = `/tmp/rawdash-sync-${Date.now()}-${Math.random()}.db`;
    const { storage: s1 } = makeStorage(`file:${tmp}`);
    expect(await s1.markSyncQueued()).toBe(true);
    expect(await s1.markSyncRunning()).toBe(true);
    await s1.close();
    const { storage: s2 } = makeStorage(`file:${tmp}`);
    expect((await s2.getSyncState()).status).toBe('running');
    expect(await s2.markSyncRunning()).toBe(false);
    await s2.close();
  });

  it('tracks full sync lifecycle through queued → running → succeeded', async () => {
    const { storage: s } = makeStorage();
    expect((await s.getSyncState()).status).toBe('idle');
    expect(await s.markSyncQueued()).toBe(true);
    expect((await s.getSyncState()).status).toBe('queued');
    expect(await s.markSyncRunning()).toBe(true);
    expect((await s.getSyncState()).status).toBe('running');
    expect(await s.markSyncRunning()).toBe(false);
    await s.markSyncSucceeded();
    expect((await s.getSyncState()).status).toBe('succeeded');
    expect((await s.getSyncState()).lastSyncAt).not.toBeNull();
    await s.close();
  });

  it('failed transition records lastError', async () => {
    const { storage: s } = makeStorage();
    await s.markSyncQueued();
    await s.markSyncRunning();
    await s.markSyncFailed('boom');
    expect((await s.getSyncState()).status).toBe('failed');
    expect((await s.getSyncState()).lastError).toBe('boom');
    await s.close();
  });

  it('markSyncRunning rejects non-queued states', async () => {
    const { storage: s } = makeStorage();
    expect(await s.markSyncRunning()).toBe(false);
    await s.markSyncQueued();
    await s.markSyncRunning();
    await s.markSyncSucceeded();
    expect(await s.markSyncRunning()).toBe(false);
    await s.close();
  });

  it('markSyncQueued reflects timestamps', async () => {
    const { storage: s } = makeStorage();
    expect(await s.markSyncQueued()).toBe(true);
    const state = await s.getSyncState();
    expect(state.status).toBe('queued');
    expect(state.queuedAt).not.toBeNull();
    expect(await s.markSyncQueued()).toBe(false);
    await s.close();
  });
});

describe('LibsqlStorage — abort isolation', () => {
  it('drops writes after the signal aborts', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { storage: s } = makeStorage();
    try {
      const controller = new AbortController();
      const h = s.getStorageHandle('c', { signal: controller.signal });

      await h.event({
        name: 'before',
        start_ts: 1,
        end_ts: null,
        attributes: {},
      });

      controller.abort();

      await h.event({
        name: 'after',
        start_ts: 2,
        end_ts: null,
        attributes: {},
      });
      await h.events([
        { name: 'after-batch', start_ts: 3, end_ts: null, attributes: {} },
      ]);
      await h.entity({
        type: 't',
        id: '1',
        attributes: {},
        updated_at: 1,
      });
      await h.metric({ name: 'm', ts: 1, value: 1, attributes: {} });

      expect(await h.queryEvents({})).toHaveLength(1);
      expect(await h.queryEntities({ type: 't' })).toEqual([]);
      expect(await h.queryMetrics({})).toEqual([]);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      await s.close();
    }
  });

  it('isolates a timed-out run from a fresh handle on the same storage', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { storage: s } = makeStorage();
    try {
      const first = new AbortController();
      const h1 = s.getStorageHandle('c', { signal: first.signal });
      first.abort();
      await h1.event({
        name: 'stale',
        start_ts: 1,
        end_ts: null,
        attributes: {},
      });

      const second = new AbortController();
      const h2 = s.getStorageHandle('c', { signal: second.signal });
      await h2.event({
        name: 'fresh',
        start_ts: 2,
        end_ts: null,
        attributes: {},
      });

      const events = await h2.queryEvents({});
      expect(events.map((e) => e.name)).toEqual(['fresh']);
    } finally {
      warn.mockRestore();
      await s.close();
    }
  });

  it('reads remain functional after abort', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { storage: s } = makeStorage();
    try {
      const controller = new AbortController();
      const h = s.getStorageHandle('c', { signal: controller.signal });
      await h.event({
        name: 'e',
        start_ts: 1,
        end_ts: null,
        attributes: {},
      });
      controller.abort();
      expect(await h.queryEvents({})).toHaveLength(1);
    } finally {
      warn.mockRestore();
      await s.close();
    }
  });
});
