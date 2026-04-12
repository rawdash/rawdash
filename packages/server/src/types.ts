export type { ConnectorConfigEntry, DashboardConfig } from '@rawdash/core';

export interface WidgetEntry {
  id: string;
  connectorId: string;
  data: unknown;
  cachedAt: string;
}

export interface SyncState {
  status: 'idle' | 'syncing' | 'error';
  lastSyncAt: string | null;
  lastError: string | null;
}

export interface ServeOptions {
  port?: number;
}
