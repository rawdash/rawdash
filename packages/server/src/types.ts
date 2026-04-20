import type { StorageHandle, SyncState } from '@rawdash/core';

export type { ConnectorEntry, DashboardConfig } from '@rawdash/core';

export interface ServerStorage {
  getStorageHandle(connectorId: string): StorageHandle;
  getSyncState(): Promise<SyncState>;
  setSyncing(): Promise<boolean>;
  setSyncSuccess(): Promise<void>;
  setSyncError(error: string): Promise<void>;
}

export interface ServeOptions {
  port?: number;
  storage?: ServerStorage;
}
