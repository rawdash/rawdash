import type { SyncState } from './engine';
import type { ResolvedWidgetFormat } from './format';

export type { ResolvedWidgetFormat };

export type WidgetSyncState =
  | 'fresh'
  | 'stale'
  | 'unsynced'
  | 'syncing'
  | 'failing';

export type WidgetStatus = 'ok' | 'no_data' | 'error';

export interface WidgetSeries<TData = unknown> {
  key: string;
  connectorId: string;
  label: string;
  data: TData | null;
  status?: WidgetStatus;
  syncState?: WidgetSyncState;
  syncIntervalSeconds?: number;
  matchedRows?: number;
  format?: ResolvedWidgetFormat;
  errorMessage?: string;
}

export interface CachedWidget<TData = unknown> {
  widgetId: string;
  connectorId: string;
  data: TData | null;
  series?: WidgetSeries<TData>[];
  cachedAt: string | null;
  syncState?: WidgetSyncState;
  syncIntervalSeconds?: number;
  format?: ResolvedWidgetFormat;
  meta?: Record<string, unknown>;
  status?: WidgetStatus;
  errorMessage?: string;
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
