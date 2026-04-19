import type { StorageHandle } from '@rawdash/core';

export type { ConnectorEntry, DashboardConfig } from '@rawdash/core';

export interface WidgetEntry {
  id: string;
  widgetId: string;
  connectorId: string;
  data: unknown;
  cachedAt: string;
}

export interface SyncState {
  status: 'idle' | 'syncing' | 'error';
  lastSyncAt: string | null;
  lastError: string | null;
}

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
