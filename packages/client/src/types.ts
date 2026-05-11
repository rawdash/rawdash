export interface CachedWidgetResponse<TData = unknown> {
  connectorId: string;
  widgetId: string;
  data: TData;
  cachedAt: string | null;
}

export interface HealthResponse {
  status: 'idle' | 'syncing' | 'error';
  lastSyncAt: string | null;
  lastError: string | null;
}

export interface SyncTriggerResponse {
  triggered: boolean;
}

export interface DataSource {
  getWidget(
    dashboardId: string,
    widgetId: string,
  ): Promise<CachedWidgetResponse>;
  getWidgets(dashboardId: string): Promise<CachedWidgetResponse[]>;
  getHealth(): Promise<HealthResponse>;
  triggerSync(): Promise<SyncTriggerResponse>;
  ensureFresh(maxAgeMs?: number): Promise<boolean>;
}

export interface RawdashEngine {
  getWidget(
    dashboardId: string,
    widgetId: string,
  ): Promise<CachedWidgetResponse>;
  getWidgets(dashboardId: string): Promise<CachedWidgetResponse[]>;
  getHealth(): Promise<HealthResponse>;
  triggerSync(): Promise<SyncTriggerResponse>;
}
