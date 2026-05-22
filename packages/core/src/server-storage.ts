import type { StorageHandle } from './connector';
import type { SyncState } from './engine';

export interface GetStorageHandleOptions {
  signal?: AbortSignal;
}

export interface ServerStorage {
  getStorageHandle(
    connectorId: string,
    options?: GetStorageHandleOptions,
  ): StorageHandle;
  getSyncState(): Promise<SyncState>;
  setSyncing(): Promise<boolean>;
  setSyncSuccess(): Promise<void>;
  setSyncError(error: string): Promise<void>;
}
