import type {
  ConfiguredConnector,
  Connector,
  ConnectorClass,
  ConnectorRegistry,
  DashboardConfig,
  StorageHandle,
  SyncOptions,
  SyncResult,
} from '@rawdash/core';
import { InMemoryStorage } from '@rawdash/core';
import { describe, expect, it } from 'vitest';

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
    widgets: [],
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
