import type { StorageHandle } from './connector';
import type { SyncState } from './engine';

export interface ServerStorage {
  getStorageHandle(connectorId: string): StorageHandle;
  getSyncState(): Promise<SyncState>;
  markSyncQueued(): Promise<boolean>;
  markSyncRunning(): Promise<boolean>;
  markSyncSucceeded(): Promise<void>;
  markSyncFailed(error: string): Promise<void>;
}
