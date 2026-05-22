import { describe, expect, it, vi } from 'vitest';

import { InMemoryStorage } from './in-memory-storage';

describe('storage handle abort isolation (InMemoryStorage)', () => {
  it('drops writes after the signal aborts', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = new InMemoryStorage();
    const controller = new AbortController();
    const handle = storage.getStorageHandle('c', { signal: controller.signal });

    await handle.event({
      name: 'before',
      start_ts: 1,
      end_ts: null,
      attributes: {},
    });

    controller.abort();

    await handle.event({
      name: 'after',
      start_ts: 2,
      end_ts: null,
      attributes: {},
    });
    await handle.events(
      [{ name: 'after-batch', start_ts: 3, end_ts: null, attributes: {} }],
      { names: ['after-batch'] },
    );
    await handle.entity({
      type: 't',
      id: '1',
      attributes: {},
      updated_at: 1,
    });
    await handle.metric({ name: 'm', ts: 1, value: 1, attributes: {} });
    await handle.edge({
      from_type: 'a',
      from_id: '1',
      kind: 'k',
      to_type: 'b',
      to_id: '2',
      attributes: {},
      updated_at: 1,
    });

    const events = await handle.queryEvents({});
    expect(events).toEqual([
      { name: 'before', start_ts: 1, end_ts: null, attributes: {} },
    ]);
    expect(await handle.queryEntities({ type: 't' })).toEqual([]);
    expect(await handle.queryMetrics({})).toEqual([]);
    expect(await handle.traverse({})).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('returns rowsDeleted=0 for deleteOlderThan after abort', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = new InMemoryStorage();
    const controller = new AbortController();
    const handle = storage.getStorageHandle('c', { signal: controller.signal });
    await handle.event({
      name: 'e',
      start_ts: 10,
      end_ts: null,
      attributes: {},
    });
    controller.abort();
    const result = await handle.deleteOlderThan('events', 1000);
    expect(result).toEqual({ rowsDeleted: 0 });
    const remaining = await handle.queryEvents({});
    expect(remaining).toHaveLength(1);
    warn.mockRestore();
  });

  it('reads still work after abort', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = new InMemoryStorage();
    const controller = new AbortController();
    const handle = storage.getStorageHandle('c', { signal: controller.signal });
    await handle.event({
      name: 'e',
      start_ts: 1,
      end_ts: null,
      attributes: {},
    });
    controller.abort();
    expect(await handle.queryEvents({})).toHaveLength(1);
    warn.mockRestore();
  });

  it('a fresh handle without a signal is not affected by an unrelated controller', async () => {
    const storage = new InMemoryStorage();
    const controller = new AbortController();
    controller.abort();
    const handle = storage.getStorageHandle('c');
    await handle.event({
      name: 'e',
      start_ts: 1,
      end_ts: null,
      attributes: {},
    });
    expect(await handle.queryEvents({})).toHaveLength(1);
  });

  it('writes from a timed-out run do not leak into the next run', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = new InMemoryStorage();

    const first = new AbortController();
    const firstHandle = storage.getStorageHandle('c', {
      signal: first.signal,
    });
    first.abort();
    await firstHandle.event({
      name: 'stale',
      start_ts: 1,
      end_ts: null,
      attributes: {},
    });

    const second = new AbortController();
    const secondHandle = storage.getStorageHandle('c', {
      signal: second.signal,
    });
    await secondHandle.event({
      name: 'fresh',
      start_ts: 2,
      end_ts: null,
      attributes: {},
    });

    const events = await secondHandle.queryEvents({});
    expect(events.map((e) => e.name)).toEqual(['fresh']);
    warn.mockRestore();
  });
});
