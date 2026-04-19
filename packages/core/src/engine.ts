export interface WidgetEntry {
  id: string;
  widgetId: string;
  connectorId: string;
  data: unknown;
  cachedAt: string | null;
}

export interface SyncState {
  status: 'idle' | 'syncing' | 'error';
  lastSyncAt: string | null;
  lastError: string | null;
}
