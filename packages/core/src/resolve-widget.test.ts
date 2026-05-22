import { describe, expect, it } from 'vitest';

import type { Widget } from './config';
import type { ConnectorHealth, StorageHandle } from './connector';
import { InMemoryStorage } from './in-memory-storage';
import { resolveWidget } from './resolve-widget';
import type { ServerStorage } from './server-storage';

const CONNECTOR = 'c';

const STAT_WIDGET: Widget = {
  kind: 'stat',
  title: 'My Stat',
  metric: {
    connectorId: CONNECTOR,
    shape: 'event',
    name: 'run',
    field: 'start_ts',
    fn: 'count',
  },
};

const STATUS_WIDGET: Widget = {
  kind: 'status',
  title: 'Conn',
  source: CONNECTOR,
};

function makeStorage(getHealth?: () => Promise<ConnectorHealth | null>): {
  storage: ServerStorage;
  inner: InMemoryStorage;
} {
  const inner = new InMemoryStorage();
  if (!getHealth) {
    return { storage: inner, inner };
  }
  const storage: ServerStorage = {
    getStorageHandle: (id) => {
      const handle = inner.getStorageHandle(id);
      const override: StorageHandle = { ...handle, getHealth };
      return override;
    },
    getSyncState: () => inner.getSyncState(),
    markSyncQueued: () => inner.markSyncQueued(),
    markSyncRunning: () => inner.markSyncRunning(),
    markSyncSucceeded: () => inner.markSyncSucceeded(),
    markSyncFailed: (e) => inner.markSyncFailed(e),
  };
  return { storage, inner };
}

describe('resolveWidget', () => {
  it('skips widgets whose connector is not in the allowlist', async () => {
    const { storage } = makeStorage();
    const result = await resolveWidget('w', STAT_WIDGET, ['other'], storage);
    expect(result).toBeUndefined();
  });

  it('returns syncState "unsynced" when health is absent and there is no data', async () => {
    const storage: ServerStorage = {
      getStorageHandle: (): StorageHandle => ({
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
        queryEvents: async () => [],
        getEntity: async () => null,
        queryEntities: async () => [],
        queryMetrics: async () => [],
        traverse: async () => [],
        queryDistributions: async () => [],
        deleteOlderThan: async () => ({ rowsDeleted: 0 }),
      }),
      getSyncState: async () => ({
        status: 'idle',
        queuedAt: null,
        startedAt: null,
        lastSyncAt: null,
        lastError: null,
      }),
      markSyncQueued: async () => true,
      markSyncRunning: async () => true,
      markSyncSucceeded: async () => {},
      markSyncFailed: async () => {},
    };
    const w = await resolveWidget('w', STATUS_WIDGET, undefined, storage);
    expect(w?.syncState).toBe('unsynced');
    expect(w?.meta).toBeUndefined();
    expect(w?.cachedAt).toBeNull();
  });

  it('returns "fresh" from health when within the freshness window', async () => {
    const lastSyncAt = new Date().toISOString();
    const { storage } = makeStorage(async () => ({
      status: 'idle',
      lastSyncAt,
      lastError: null,
      syncIntervalSeconds: 600,
    }));
    const w = await resolveWidget('w', STAT_WIDGET, undefined, storage);
    expect(w?.syncState).toBe('fresh');
    expect(w?.meta).toEqual({ connectorStatus: 'idle' });
    expect(w?.cachedAt).toBe(lastSyncAt);
  });

  it('returns "stale" when lastSyncAt is older than 2 × syncIntervalSeconds', async () => {
    const lastSyncAt = new Date(Date.now() - 5_000_000).toISOString();
    const { storage } = makeStorage(async () => ({
      status: 'idle',
      lastSyncAt,
      lastError: null,
      syncIntervalSeconds: 600,
    }));
    const w = await resolveWidget('w', STAT_WIDGET, undefined, storage);
    expect(w?.syncState).toBe('stale');
  });

  it('returns "unsynced" when health has no lastSyncAt', async () => {
    const { storage } = makeStorage(async () => ({
      status: 'idle',
      lastSyncAt: null,
      lastError: null,
      syncIntervalSeconds: 600,
    }));
    const w = await resolveWidget('w', STAT_WIDGET, undefined, storage);
    expect(w?.syncState).toBe('unsynced');
  });

  it('returns "syncing" when health status is syncing', async () => {
    const { storage } = makeStorage(async () => ({
      status: 'syncing',
      lastSyncAt: new Date().toISOString(),
      lastError: null,
      syncIntervalSeconds: 600,
    }));
    const w = await resolveWidget('w', STAT_WIDGET, undefined, storage);
    expect(w?.syncState).toBe('syncing');
    expect(w?.meta?.['connectorStatus']).toBe('syncing');
  });

  it('returns "failing" for error/auth_failed/paused and exposes lastError in meta', async () => {
    for (const status of ['error', 'auth_failed', 'paused'] as const) {
      const { storage } = makeStorage(async () => ({
        status,
        lastSyncAt: new Date().toISOString(),
        lastError: 'boom',
        syncIntervalSeconds: 600,
      }));
      const w = await resolveWidget('w', STAT_WIDGET, undefined, storage);
      expect(w?.syncState).toBe('failing');
      expect(w?.meta).toEqual({
        connectorStatus: status,
        lastError: 'boom',
      });
    }
  });

  it('populates syncState for status widgets from health', async () => {
    const { storage } = makeStorage(async () => ({
      status: 'auth_failed',
      lastSyncAt: null,
      lastError: 'token expired',
      syncIntervalSeconds: 600,
    }));
    const w = await resolveWidget('w', STATUS_WIDGET, undefined, storage);
    expect(w?.data).toBeNull();
    expect(w?.syncState).toBe('failing');
    expect(w?.meta).toEqual({
      connectorStatus: 'auth_failed',
      lastError: 'token expired',
    });
  });

  it('with InMemoryStorage: "unsynced" before any write, "stale" after a write (window=0)', async () => {
    const storage = new InMemoryStorage();
    const before = await resolveWidget('w', STAT_WIDGET, undefined, storage);
    expect(before?.syncState).toBe('unsynced');

    const handle = storage.getStorageHandle(CONNECTOR);
    await handle.event({
      name: 'run',
      start_ts: Date.now(),
      end_ts: null,
      attributes: {},
    });

    await new Promise((r) => setTimeout(r, 5));
    const after = await resolveWidget('w', STAT_WIDGET, undefined, storage);
    expect(after?.syncState).toBe('stale');
    expect(after?.cachedAt).not.toBeNull();
    expect(after?.meta).toEqual({ connectorStatus: 'idle' });
  });
});
