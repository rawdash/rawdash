import type { StorageHandle } from './connector';
import type { SyncState } from './engine';

export interface ServerStorage {
  getStorageHandle(connectorId: string): StorageHandle;
  getSyncState(): Promise<SyncState>;
  setSyncing(): Promise<boolean>;
  setSyncSuccess(): Promise<void>;
  setSyncError(error: string): Promise<void>;
}
