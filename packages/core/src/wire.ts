import type { SyncState } from './engine';
import type { ResolvedWidgetFormat } from './format';

export type { ResolvedWidgetFormat };

export type WidgetSyncState =
  | 'fresh'
  | 'stale'
  | 'unsynced'
  | 'syncing'
  | 'failing';

export interface CachedWidget<TData = unknown> {
  widgetId: string;
  connectorId: string;
  data: TData | null;
  cachedAt: string | null;
  syncState?: WidgetSyncState;
  syncIntervalSeconds?: number;
  format?: ResolvedWidgetFormat;
  meta?: Record<string, unknown>;
}

export interface WidgetsListResponse {
  widgets: CachedWidget[];
}

export interface HealthResponse {
  status: 'ok';
}

export interface TriggerSyncResponse {
  queued: boolean;
}

export interface DataSource {
  getWidget(dashboardId: string, widgetId: string): Promise<CachedWidget>;
  getWidgets(dashboardId: string): Promise<CachedWidget[]>;
  getHealth(): Promise<HealthResponse>;
  getSyncState(): Promise<SyncState>;
  triggerSync(): Promise<TriggerSyncResponse>;
  ensureFresh(maxAgeMs?: number): Promise<boolean>;
}

export interface ServerDataSource {
  getWidget(dashboardId: string, widgetId: string): Promise<CachedWidget>;
  getWidgets(dashboardId: string): Promise<CachedWidget[]>;
  getHealth(): Promise<HealthResponse>;
  getSyncState(): Promise<SyncState>;
  triggerSync(): Promise<TriggerSyncResponse>;
}
