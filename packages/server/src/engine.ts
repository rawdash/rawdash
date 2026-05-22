import type {
  CachedWidget,
  DashboardConfig,
  HealthResponse,
  ServerStorage,
  SyncState,
  TriggerSyncResponse,
} from '@rawdash/core';
import { InMemoryStorage, isSyncActive, resolveWidget } from '@rawdash/core';

import { runSync } from './sync';

export interface EngineOptions {
  storage?: ServerStorage;
}

export interface Engine {
  getWidget(
    dashboardId: string,
    widgetId: string,
  ): Promise<CachedWidget | undefined>;
  getWidgets(dashboardId: string): Promise<CachedWidget[]>;
  getHealth(): Promise<HealthResponse>;
  getSyncState(): Promise<SyncState>;
  triggerSync(): Promise<TriggerSyncResponse>;
}

export function createEngine(
  config: DashboardConfig,
  options: EngineOptions = {},
): Engine {
  const storage: ServerStorage = options.storage ?? new InMemoryStorage();

  return {
    async getWidget(dashboardId, widgetId) {
      const dashboard = config.dashboards[dashboardId];
      if (!dashboard) {
        return undefined;
      }
      const widget = dashboard.widgets[widgetId];
      if (!widget) {
        return undefined;
      }
      return resolveWidget(widgetId, widget, config.connectors, storage);
    },

    async getWidgets(dashboardId) {
      const dashboard = config.dashboards[dashboardId];
      if (!dashboard) {
        return [];
      }
      const entries = Object.entries(dashboard.widgets);
      const resolved = await Promise.all(
        entries.map(([key, widget]) =>
          resolveWidget(key, widget, config.connectors, storage),
        ),
      );
      return resolved.filter((w): w is CachedWidget => w !== undefined);
    },

    async getHealth() {
      return { status: 'ok' };
    },

    async getSyncState() {
      return storage.getSyncState();
    },

    async triggerSync() {
      const state = await storage.getSyncState();
      if (isSyncActive(state.status)) {
        return { queued: false };
      }
      void runSync(config, storage).catch((error) => {
        console.error('Rawdash sync failed', error);
      });
      return { queued: true };
    },
  };
}
