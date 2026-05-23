import type {
  ConfiguredConnector,
  Connector,
  ConnectorClass,
  ConnectorRegistry,
  DashboardConfig,
  ServerStorage,
  StorageHandle,
  SyncOptions,
  SyncResult,
  SyncState,
} from '@rawdash/core';
import { InMemoryStorage } from '@rawdash/core';
import { describe, expect, it, vi } from 'vitest';

import { FULL_SYNC_MAX_CHUNKS, runSync } from './sync';

class ChunkedConnector implements Connector {
  static readonly schemas = {};
  readonly id = 'chunked';
  readonly observed: SyncOptions[] = [];
  constructor(private readonly script: SyncResult[]) {}
  serializeConfig() {
    return {};
  }
  async sync(options: SyncOptions): Promise<SyncResult> {
    this.observed.push(options);
    const next = this.script[this.observed.length - 1];
    if (!next) {
      throw new Error('script exhausted');
    }
    return next;
  }
}

class NeverDoneConnector implements Connector {
  static readonly schemas = {};
  readonly id = 'never-done';
  calls = 0;
  serializeConfig() {
    return {};
  }
  async sync(
    _options: SyncOptions,
    _storage: StorageHandle,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    this.calls += 1;
    if (signal?.aborted) {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    }
    return { done: false, cursor: { page: this.calls } };
  }
}

class DoneConnector implements Connector {
  static readonly schemas = {};
  readonly id = 'done';
  serializeConfig() {
    return {};
  }
  async sync(): Promise<SyncResult> {
    return { done: true };
  }
}

function makeRegistry(instance: Connector): {
  registry: ConnectorRegistry;
  entry: ConfiguredConnector;
} {
  const ConnectorCls = class {
    static readonly schemas = {};
    constructor() {
      return instance;
    }
  } as unknown as ConnectorClass;
  const registry: ConnectorRegistry = { test: ConnectorCls };
  const entry: ConfiguredConnector = {
    name: 'test',
    connectorId: 'test',
    config: {},
  };
  return { registry, entry };
}

function makeConfig(entry: ConfiguredConnector): DashboardConfig {
  return {
    connectors: [entry],
    dashboards: {
      main: {
        widgets: {
          probe: {
            kind: 'stat',
            title: 'probe',
            metric: {
              connectorId: entry.name,
              shape: 'entity',
              name: 'probe',
              fn: 'count',
            },
          },
        },
      },
    },
  } as unknown as DashboardConfig;
}

describe('runSync — chunked connector loop', () => {
  it('loops until the connector returns done:true, forwarding the cursor', async () => {
    const connector = new ChunkedConnector([
      { done: false, cursor: { page: 1 } },
      { done: false, cursor: { page: 2 } },
      { done: true },
    ]);
    const { registry, entry } = makeRegistry(connector);
    const storage = new InMemoryStorage();

    await runSync(makeConfig(entry), storage, { connectorRegistry: registry });

    expect(connector.observed).toEqual([
      { mode: 'full', cursor: undefined },
      { mode: 'full', cursor: { page: 1 } },
      { mode: 'full', cursor: { page: 2 } },
    ]);
    const state = await storage.getSyncState();
    expect(state.status).toBe('succeeded');
  });

  it('fails the sync after exceeding the chunk cap', async () => {
    const connector = new NeverDoneConnector();
    const { registry, entry } = makeRegistry(connector);
    const storage = new InMemoryStorage();

    await runSync(makeConfig(entry), storage, { connectorRegistry: registry });

    expect(connector.calls).toBe(FULL_SYNC_MAX_CHUNKS);
    const state = await storage.getSyncState();
    expect(state.status).toBe('failed');
    expect(state.lastError).toContain(`${FULL_SYNC_MAX_CHUNKS}`);
  });
});

describe('runSync — optional markSyncRunning', () => {
  it('works when storage omits markSyncRunning (deferred-mode storage)', async () => {
    const inner = new InMemoryStorage();
    const storage: ServerStorage = {
      getStorageHandle: (id, opts): StorageHandle =>
        inner.getStorageHandle(id, opts),
      getSyncState: (): Promise<SyncState> => inner.getSyncState(),
      markSyncQueued: () => inner.markSyncQueued(),
      markSyncSucceeded: () => inner.markSyncSucceeded(),
      markSyncFailed: (e) => inner.markSyncFailed(e),
    };
    const { registry, entry } = makeRegistry(new DoneConnector());

    await runSync(makeConfig(entry), storage, { connectorRegistry: registry });

    const state = await inner.getSyncState();
    expect(state.status).toBe('succeeded');
  });

  it('skips remaining work when markSyncRunning returns false', async () => {
    const storage = new InMemoryStorage();
    await storage.markSyncQueued();
    await storage.markSyncRunning();
    const handleSpy = vi.spyOn(storage, 'getStorageHandle');
    const { registry, entry } = makeRegistry(new DoneConnector());

    await runSync(makeConfig(entry), storage, { connectorRegistry: registry });

    expect(handleSpy).not.toHaveBeenCalled();
  });

  it('transitions queued → succeeded via markSyncRunning when present', async () => {
    const storage = new InMemoryStorage();
    const runningSpy = vi.spyOn(storage, 'markSyncRunning');
    const { registry, entry } = makeRegistry(new DoneConnector());

    await runSync(makeConfig(entry), storage, { connectorRegistry: registry });

    expect(runningSpy).toHaveBeenCalled();
    const state = await storage.getSyncState();
    expect(state.status).toBe('succeeded');
  });
});

describe('runSync — widget-driven backfill scoping', () => {
  it('skips connectors with no widgets referencing them', async () => {
    const connector = new ChunkedConnector([{ done: true }]);
    const { registry, entry } = makeRegistry(connector);
    const storage = new InMemoryStorage();
    const config = {
      connectors: [entry],
      dashboards: { main: { widgets: {} } },
    } as unknown as DashboardConfig;

    await runSync(config, storage, { connectorRegistry: registry });

    expect(connector.observed).toEqual([]);
    const state = await storage.getSyncState();
    expect(state.status).toBe('succeeded');
  });

  it('passes since = now - max(window) - 1d when widgets declare windows', async () => {
    const connector = new ChunkedConnector([{ done: true }]);
    const { registry, entry } = makeRegistry(connector);
    const storage = new InMemoryStorage();
    const config = {
      connectors: [entry],
      dashboards: {
        main: {
          widgets: {
            short: {
              kind: 'timeseries',
              title: 'short',
              window: '7d',
              metric: {
                connectorId: entry.name,
                shape: 'event',
                name: 'e',
                fn: 'count',
                window: '7d',
              },
            },
            long: {
              kind: 'timeseries',
              title: 'long',
              window: '90d',
              metric: {
                connectorId: entry.name,
                shape: 'event',
                name: 'e',
                fn: 'count',
                window: '90d',
              },
            },
          },
        },
      },
    } as unknown as DashboardConfig;

    const before = Date.now();
    await runSync(config, storage, { connectorRegistry: registry });
    const after = Date.now();

    expect(connector.observed).toHaveLength(1);
    const observed = connector.observed[0]!;
    expect(typeof observed.since).toBe('string');
    const sinceMs = new Date(observed.since!).getTime();
    const expectedMax = before - 90 * 86_400_000 - 86_400_000;
    const expectedMin = after - 90 * 86_400_000 - 86_400_000;
    expect(sinceMs).toBeLessThanOrEqual(expectedMax);
    expect(sinceMs).toBeGreaterThanOrEqual(expectedMin - 5);
  });

  it('omits since when all referencing widgets are current-state (no window)', async () => {
    const connector = new ChunkedConnector([{ done: true }]);
    const { registry, entry } = makeRegistry(connector);
    const storage = new InMemoryStorage();

    await runSync(makeConfig(entry), storage, { connectorRegistry: registry });

    expect(connector.observed).toHaveLength(1);
    expect(connector.observed[0]!.since).toBeUndefined();
  });
});
