import type { StorageHandle, SyncState } from '@rawdash/core';

export type { ConnectorEntry, DashboardConfig } from '@rawdash/core';

export interface ServerStorage {
  getStorageHandle(connectorId: string): StorageHandle;
  getRecords(
    connectorId: string,
    resource: string,
  ): Promise<Record<string, unknown>[]>;
  getSyncState(): SyncState;
  setSyncing(): void;
  setSyncSuccess(): void;
  setSyncError(error: string): void;
}

export interface ServeOptions {
  port?: number;
  storage?: ServerStorage;
}
