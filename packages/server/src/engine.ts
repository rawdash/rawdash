import type {
  CachedWidget,
  ConnectorRegistry,
  DashboardConfig,
  HealthResponse,
  SecretsResolver,
  ServerStorage,
  SyncState,
  TriggerSyncResponse,
} from '@rawdash/core';
import { InMemoryStorage, isSyncActive, resolveWidget } from '@rawdash/core';

import { type ConnectorLoggerFactory, runSync } from './sync';

export interface EngineOptions {
  storage?: ServerStorage;
  connectorRegistry?: ConnectorRegistry;
  secretsResolver?: SecretsResolver;
  loggerFactory?: ConnectorLoggerFactory;
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
  const connectorNames = config.connectors.map((c) => c.name);

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
      return resolveWidget(
        dashboardId,
        widgetId,
        widget,
        connectorNames,
        storage,
      );
    },

    async getWidgets(dashboardId) {
      const dashboard = config.dashboards[dashboardId];
      if (!dashboard) {
        return [];
      }
      const entries = Object.entries(dashboard.widgets);
      const resolved = await Promise.all(
        entries.map(([key, widget]) =>
          resolveWidget(dashboardId, key, widget, connectorNames, storage),
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
      if (!options.connectorRegistry) {
        throw new Error(
          'createEngine: connectorRegistry is required to triggerSync',
        );
      }
      const state = await storage.getSyncState();
      if (isSyncActive(state.status)) {
        return { queued: false };
      }
      const queued = await storage.markSyncQueued();
      if (!queued) {
        return { queued: false };
      }
      void runSync(config, storage, {
        connectorRegistry: options.connectorRegistry,
        secretsResolver: options.secretsResolver,
        loggerFactory: options.loggerFactory,
      }).catch((error) => {
        console.error('Rawdash sync failed', error);
      });
      return { queued: true };
    },
  };
}
