import type {
  AggregateRequest,
  AggregateValue,
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
import { AGGREGATE_ENTITY_TYPE, InMemoryStorage } from '@rawdash/core';
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

    expect(connector.observed.map((o) => o.cursor)).toEqual([
      undefined,
      { page: 1 },
      { page: 2 },
    ]);
    expect(connector.observed.every((o) => o.mode === 'full')).toBe(true);
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
    const expectedMin = before - 90 * 86_400_000 - 86_400_000;
    const expectedMax = after - 90 * 86_400_000 - 86_400_000;
    expect(sinceMs).toBeGreaterThanOrEqual(expectedMin - 5);
    expect(sinceMs).toBeLessThanOrEqual(expectedMax + 5);
  });

  it('omits since when all referencing widgets are current-state (no window)', async () => {
    const connector = new ChunkedConnector([{ done: true }]);
    const { registry, entry } = makeRegistry(connector);
    const storage = new InMemoryStorage();

    await runSync(makeConfig(entry), storage, { connectorRegistry: registry });

    expect(connector.observed).toHaveLength(1);
    expect(connector.observed[0]!.since).toBeUndefined();
  });

  it('passes a resources allowlist limited to widget-referenced names', async () => {
    const connector = new ChunkedConnector([{ done: true }]);
    const { registry, entry } = makeRegistry(connector);
    const storage = new InMemoryStorage();
    const config = {
      connectors: [entry],
      dashboards: {
        main: {
          widgets: {
            prs: {
              kind: 'stat',
              title: 'prs',
              metric: {
                connectorId: entry.name,
                shape: 'entity',
                name: 'pull_request',
                fn: 'count',
              },
            },
            repo: {
              kind: 'stat',
              title: 'repo',
              metric: {
                connectorId: entry.name,
                shape: 'entity',
                name: 'repo',
                fn: 'latest',
              },
            },
          },
        },
      },
    } as unknown as DashboardConfig;

    await runSync(config, storage, { connectorRegistry: registry });

    expect(connector.observed).toHaveLength(1);
    const resources = connector.observed[0]!.resources;
    expect(resources).toBeDefined();
    expect(Array.from(resources!).sort()).toEqual(['pull_request', 'repo']);
  });

  it('dispatches aggregate calls and skips entity sync when every resource is aggregate-served', async () => {
    class AggregateConnector implements Connector {
      static readonly schemas = {};
      readonly id = 'agg';
      readonly syncCalls: SyncOptions[] = [];
      readonly aggregateCalls: AggregateRequest[] = [];
      serializeConfig() {
        return {};
      }
      async sync(options: SyncOptions): Promise<SyncResult> {
        this.syncCalls.push(options);
        return { done: true };
      }
      async aggregate(req: AggregateRequest): Promise<AggregateValue> {
        this.aggregateCalls.push(req);
        if (req.fn === 'count') {
          return 42;
        }
        return 'ok';
      }
    }
    const connector = new AggregateConnector();
    const { registry, entry } = makeRegistry(connector);
    const storage = new InMemoryStorage();
    const config = {
      connectors: [entry],
      dashboards: {
        main: {
          widgets: {
            open_prs: {
              kind: 'stat',
              title: 'Open PRs',
              metric: {
                connectorId: entry.name,
                shape: 'entity',
                name: 'pull_request',
                field: 'state',
                fn: 'count',
                filter: [{ field: 'state', op: 'eq', value: 'open' }],
              },
            },
            ci: {
              kind: 'stat',
              title: 'CI',
              metric: {
                connectorId: entry.name,
                shape: 'event',
                name: 'workflow_run',
                field: 'conclusion',
                fn: 'latest',
              },
            },
          },
        },
      },
    } as unknown as DashboardConfig;

    await runSync(config, storage, { connectorRegistry: registry });

    expect(connector.aggregateCalls).toHaveLength(2);
    expect(connector.syncCalls).toEqual([]);
    const handle = storage.getStorageHandle(entry.name);
    const open = await handle.getEntity(AGGREGATE_ENTITY_TYPE, 'main:open_prs');
    expect(open?.attributes['value']).toBe(42);
    const ci = await handle.getEntity(AGGREGATE_ENTITY_TYPE, 'main:ci');
    expect(ci?.attributes['value']).toBe('ok');
  });

  it('keeps entity sync for a resource shared by aggregate and non-aggregate widgets', async () => {
    class MixedConnector implements Connector {
      static readonly schemas = {};
      readonly id = 'mixed';
      readonly syncCalls: SyncOptions[] = [];
      readonly aggregateCalls: AggregateRequest[] = [];
      serializeConfig() {
        return {};
      }
      async sync(options: SyncOptions): Promise<SyncResult> {
        this.syncCalls.push(options);
        return { done: true };
      }
      async aggregate(req: AggregateRequest): Promise<AggregateValue> {
        this.aggregateCalls.push(req);
        return 0;
      }
    }
    const connector = new MixedConnector();
    const { registry, entry } = makeRegistry(connector);
    const storage = new InMemoryStorage();
    const config = {
      connectors: [entry],
      dashboards: {
        main: {
          widgets: {
            open_prs: {
              kind: 'stat',
              title: 'Open PRs',
              metric: {
                connectorId: entry.name,
                shape: 'entity',
                name: 'pull_request',
                fn: 'count',
              },
            },
            prs_per_week: {
              kind: 'timeseries',
              title: 'PRs/week',
              window: '90d',
              metric: {
                connectorId: entry.name,
                shape: 'entity',
                name: 'pull_request',
                fn: 'count',
                window: '90d',
                groupBy: { field: 'updated_at', granularity: 'week' },
              },
            },
          },
        },
      },
    } as unknown as DashboardConfig;

    await runSync(config, storage, { connectorRegistry: registry });

    expect(connector.aggregateCalls).toHaveLength(1);
    expect(connector.syncCalls).toHaveLength(1);
    expect(Array.from(connector.syncCalls[0]!.resources!).sort()).toEqual([
      'pull_request',
    ]);
  });

  it('falls back to entity sync for a resource whose aggregate call failed', async () => {
    class FlakyAggregateConnector implements Connector {
      static readonly schemas = {};
      readonly id = 'flaky';
      readonly syncCalls: SyncOptions[] = [];
      serializeConfig() {
        return {};
      }
      async sync(options: SyncOptions): Promise<SyncResult> {
        this.syncCalls.push(options);
        return { done: true };
      }
      async aggregate(): Promise<AggregateValue> {
        throw new Error('upstream 500');
      }
    }
    const connector = new FlakyAggregateConnector();
    const { registry, entry } = makeRegistry(connector);
    const storage = new InMemoryStorage();
    const config = {
      connectors: [entry],
      dashboards: {
        main: {
          widgets: {
            open_prs: {
              kind: 'stat',
              title: 'Open PRs',
              metric: {
                connectorId: entry.name,
                shape: 'entity',
                name: 'pull_request',
                fn: 'count',
              },
            },
          },
        },
      },
    } as unknown as DashboardConfig;

    await runSync(config, storage, { connectorRegistry: registry });

    // Aggregate failed → resource must NOT be pruned → entity sync runs.
    expect(connector.syncCalls).toHaveLength(1);
    expect(Array.from(connector.syncCalls[0]!.resources!)).toEqual([
      'pull_request',
    ]);
    const state = await storage.getSyncState();
    expect(state.status).toBe('failed');
    expect(state.lastError).toContain('upstream 500');
  });

  it('uses a custom loggerFactory for both the runner and each connector instance', async () => {
    const connector = new ChunkedConnector([{ done: true }]);
    const { registry, entry } = makeRegistry(connector);
    const storage = new InMemoryStorage();
    const config = makeConfig(entry);
    const factoryScopes: string[] = [];
    const calls: Array<{ scope: string; level: string; event: string }> = [];
    const loggerFactory = (scope: string) => {
      factoryScopes.push(scope);
      return {
        info: (event: string) => calls.push({ scope, level: 'info', event }),
        warn: (event: string) => calls.push({ scope, level: 'warn', event }),
      };
    };

    await runSync(config, storage, {
      connectorRegistry: registry,
      loggerFactory,
    });

    expect(factoryScopes).toEqual(
      expect.arrayContaining(['runner', entry.name]),
    );
    const runnerEvents = calls
      .filter((c) => c.scope === 'runner')
      .map((c) => c.event);
    expect(runnerEvents).toContain('sync started');
    expect(runnerEvents).toContain('sync settled');
  });

  it('survives a throwing loggerFactory and reports sync succeeded', async () => {
    const connector = new ChunkedConnector([{ done: true }]);
    const { registry, entry } = makeRegistry(connector);
    const storage = new InMemoryStorage();
    const config = makeConfig(entry);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await runSync(config, storage, {
      connectorRegistry: registry,
      loggerFactory: () => {
        throw new Error('factory boom');
      },
    });

    const state = await storage.getSyncState();
    expect(state.status).toBe('succeeded');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('survives a logger whose info() throws', async () => {
    const connector = new ChunkedConnector([{ done: true }]);
    const { registry, entry } = makeRegistry(connector);
    const storage = new InMemoryStorage();
    const config = makeConfig(entry);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await runSync(config, storage, {
      connectorRegistry: registry,
      loggerFactory: () => ({
        info: () => {
          throw new Error('info boom');
        },
        warn: () => {},
      }),
    });

    const state = await storage.getSyncState();
    expect(state.status).toBe('succeeded');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('passes an empty resources set when only status widgets reference the connector', async () => {
    const connector = new ChunkedConnector([{ done: true }]);
    const { registry, entry } = makeRegistry(connector);
    const storage = new InMemoryStorage();
    const config = {
      connectors: [entry],
      dashboards: {
        main: {
          widgets: {
            s: { kind: 'status', title: 's', source: entry.name },
          },
        },
      },
    } as unknown as DashboardConfig;

    await runSync(config, storage, { connectorRegistry: registry });

    expect(connector.observed).toHaveLength(1);
    const resources = connector.observed[0]!.resources;
    expect(resources).toBeDefined();
    expect(resources!.size).toBe(0);
  });
});
