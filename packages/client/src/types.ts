export type WidgetSyncState = 'synced' | 'unsynced' | 'syncing' | 'error';

export interface CachedWidgetData<TData = unknown> {
  connectorId: string;
  widgetId: string;
  data: TData | null;
  cachedAt: string | null;
  syncState?: WidgetSyncState;
  meta?: Record<string, unknown>;
}

export interface HealthStatus {
  status: 'idle' | 'syncing' | 'error';
  lastSyncAt: string | null;
  lastError: string | null;
}

export interface SyncResult {
  triggered: boolean;
}

export interface DataSource {
  getWidget(dashboardId: string, widgetId: string): Promise<CachedWidgetData>;
  getWidgets(dashboardId: string): Promise<CachedWidgetData[]>;
  getHealth(): Promise<HealthStatus>;
  triggerSync(): Promise<SyncResult>;
  ensureFresh(maxAgeMs?: number): Promise<boolean>;
}

export interface ServerDataSource {
  getWidget(dashboardId: string, widgetId: string): Promise<CachedWidgetData>;
  getWidgets(dashboardId: string): Promise<CachedWidgetData[]>;
  getHealth(): Promise<HealthStatus>;
  triggerSync(): Promise<SyncResult>;
}
