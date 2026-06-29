import type { ConnectorHealth, StorageHandle } from './connector';
import type { SyncState } from './engine';

export interface GetStorageHandleOptions {
  signal?: AbortSignal;
}

export interface MarkSyncSucceededOptions {
  backfillDue?: boolean;
}

export interface ServerStorage {
  getStorageHandle(
    connectorId: string,
    options?: GetStorageHandleOptions,
  ): StorageHandle;
  getHealth(connectorId: string): Promise<ConnectorHealth | null>;
  getSyncState(): Promise<SyncState>;
  markSyncQueued(): Promise<boolean>;
  markSyncRunning?(): Promise<boolean>;
  markSyncSucceeded(options?: MarkSyncSucceededOptions): Promise<void>;
  markSyncFailed(error: string): Promise<void>;
}
