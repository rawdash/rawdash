import type { ConnectorHealth, StorageHandle } from './connector';
import type { SyncState } from './engine';
import type { SyncSchedulingState } from './plan-sync';

export interface GetStorageHandleOptions {
  signal?: AbortSignal;
}

export interface MarkConnectorSyncSucceededOptions {
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
  markSyncSucceeded(): Promise<void>;
  markSyncFailed(error: string): Promise<void>;
  getConnectorSyncState?(connectorId: string): Promise<SyncSchedulingState>;
  markConnectorSyncSucceeded?(
    connectorId: string,
    options?: MarkConnectorSyncSucceededOptions,
  ): Promise<void>;
}
