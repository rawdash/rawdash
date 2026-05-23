import type {
  ConnectorRegistry,
  DashboardConfig,
  ServerStorage,
  StorageHandle,
  SyncState,
} from '@rawdash/core';
import { describe, expect, it, vi } from 'vitest';

import { InMemoryStorage } from './storage';
import { runSync } from './sync';

class MockConnector {
  static readonly credentials = undefined;
  readonly id = 'test';
  constructor(
    _settings: Record<string, unknown>,
    _creds?: Record<string, unknown>,
  ) {}
  serializeConfig(): Record<string, unknown> {
    return {};
  }
  async sync(): Promise<{ done: boolean }> {
    return { done: true };
  }
}

const connectorRegistry: ConnectorRegistry = {
  test: MockConnector as unknown as ConnectorRegistry[string],
};

const config: DashboardConfig = {
  connectors: [{ name: 'test', connectorId: 'test', config: {} }],
  dashboards: {},
};

describe('runSync', () => {
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

    await runSync(config, storage, { connectorRegistry });

    const state = await inner.getSyncState();
    expect(state.status).toBe('succeeded');
  });

  it('skips remaining work when markSyncRunning returns false', async () => {
    const storage = new InMemoryStorage();
    await storage.markSyncQueued();
    await storage.markSyncRunning();
    const handleSpy = vi.spyOn(storage, 'getStorageHandle');

    await runSync(config, storage, { connectorRegistry });

    expect(handleSpy).not.toHaveBeenCalled();
  });

  it('transitions queued → succeeded via markSyncRunning when present', async () => {
    const storage = new InMemoryStorage();
    const runningSpy = vi.spyOn(storage, 'markSyncRunning');

    await runSync(config, storage, { connectorRegistry });

    expect(runningSpy).toHaveBeenCalled();
    const state = await storage.getSyncState();
    expect(state.status).toBe('succeeded');
  });
});
