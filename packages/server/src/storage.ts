import type { StorageHandle } from '@rawdash/core';

import type { ServerStorage, SyncState } from './types';

export class InMemoryStorage implements ServerStorage {
  private records = new Map<string, Map<string, Record<string, unknown>[]>>();
  private syncState: SyncState = {
    status: 'idle',
    lastSyncAt: null,
    lastError: null,
  };

  getStorageHandle(connectorId: string): StorageHandle {
    return {
      upsert: async (resource, records) => {
        if (!this.records.has(connectorId)) {
          this.records.set(connectorId, new Map());
        }
        this.records.get(connectorId)!.set(resource, records);
      },
    };
  }

  async getRecords(
    connectorId: string,
    resource: string,
  ): Promise<Record<string, unknown>[]> {
    return this.records.get(connectorId)?.get(resource) ?? [];
  }

  getSyncState(): SyncState {
    return { ...this.syncState };
  }

  setSyncing(): void {
    this.syncState = { ...this.syncState, status: 'syncing' };
  }

  setSyncSuccess(): void {
    this.syncState = {
      status: 'idle',
      lastSyncAt: new Date().toISOString(),
      lastError: null,
    };
  }

  setSyncError(error: string): void {
    this.syncState = {
      status: 'error',
      lastSyncAt: this.syncState.lastSyncAt,
      lastError: error,
    };
  }
}
