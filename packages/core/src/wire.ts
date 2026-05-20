import type { SyncState } from './engine';

export type WidgetSyncState =
  | 'synced'
  | 'unsynced'
  | 'syncing'
  | 'stale'
  | 'error';

export interface CachedWidget<TData = unknown> {
  widgetId: string;
  connectorId: string;
  data: TData | null;
  cachedAt: string | null;
  syncState?: WidgetSyncState;
  meta?: Record<string, unknown>;
}

export interface WidgetsListResponse {
  widgets: CachedWidget[];
}

export interface TriggerSyncResponse {
  triggered: boolean;
}

export interface DataSource {
  getWidget(dashboardId: string, widgetId: string): Promise<CachedWidget>;
  getWidgets(dashboardId: string): Promise<CachedWidget[]>;
  getHealth(): Promise<SyncState>;
  triggerSync(): Promise<TriggerSyncResponse>;
  ensureFresh(maxAgeMs?: number): Promise<boolean>;
}

export interface ServerDataSource {
  getWidget(dashboardId: string, widgetId: string): Promise<CachedWidget>;
  getWidgets(dashboardId: string): Promise<CachedWidget[]>;
  getHealth(): Promise<SyncState>;
  triggerSync(): Promise<TriggerSyncResponse>;
}
