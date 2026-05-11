import type { DashboardConfig, Widget, WidgetEntry } from '@rawdash/core';

import { computeMetric } from './compute';
import { SyncRouter } from './routers/sync';
import { InMemoryStorage } from './storage';
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

  async function resolveWidget(
    connectors: DashboardConfig['connectors'],
    id: string,
    widget: Widget,
  ): Promise<WidgetEntry | undefined> {
    if (widget.kind === 'status') {
      return {
        id,
        widgetId: id,
        connectorId: widget.source,
        data: null,
        cachedAt: null,
      };
    }
    const { connectorId } = widget.metric;
    const connectorEntry = connectors.find(
      (e) => e.connector.id === connectorId,
    );
    if (!connectorEntry) {
      return undefined;
    }
    const handle = storage.getStorageHandle(connectorId);
    const data = await computeMetric(handle, widget.metric);
    return {
      id,
      widgetId: id,
      connectorId,
      data,
      cachedAt: (await storage.getSyncState()).lastSyncAt,
    };
  }

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
      return resolveWidget(config.connectors, widgetId, widget);
    },

    async getWidgets(dashboardId) {
      const dashboard = config.dashboards[dashboardId];
      if (!dashboard) {
        return [];
      }
      const entries = Object.entries(dashboard.widgets);
      const resolved = await Promise.all(
        entries.map(([key, widget]) =>
          resolveWidget(config.connectors, key, widget),
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
