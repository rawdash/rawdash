import type { DashboardConfig, WidgetEntry } from '@rawdash/core';
import { InMemoryStorage, resolveWidget } from '@rawdash/core';

import { SyncRouter } from './routers/sync';
import type { ServerStorage } from './types';

export interface EngineOptions {
  storage?: ServerStorage;
}

export interface Engine {
  getWidget(
    dashboardId: string,
    widgetId: string,
  ): Promise<WidgetEntry | undefined>;
  getWidgets(dashboardId: string): Promise<WidgetEntry[]>;
  getHealth(): Promise<{
    status: 'idle' | 'syncing' | 'error';
    lastSyncAt: string | null;
    lastError: string | null;
  }>;
  triggerSync(): Promise<{ triggered: boolean }>;
}

export function createEngine(
  config: DashboardConfig,
  options: EngineOptions = {},
): Engine {
  const storage: ServerStorage = options.storage ?? new InMemoryStorage();
  const syncRouter = new SyncRouter(config, storage);

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
      return resolved.filter((w): w is WidgetEntry => w !== undefined);
    },

    async getHealth() {
      return storage.getSyncState();
    },

    async triggerSync() {
      const state = await storage.getSyncState();
      if (state.status === 'syncing') {
        return { triggered: false };
      }
      void syncRouter.runSync().catch((error) => {
        console.error('Rawdash sync failed', error);
      });
      return { triggered: true };
    },
  };
}
