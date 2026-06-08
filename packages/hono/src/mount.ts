import type {
  ConnectorLoggerFactory,
  ConnectorRegistry,
  DashboardConfig,
  SecretsResolver,
  ServerStorage,
} from '@rawdash/server';
import { InMemoryStorage, ROUTES } from '@rawdash/server';
import { Hono } from 'hono';

import { createHealthRouter } from './health';
import { createRetentionRouter, startRetentionLoop } from './retention';
import { createSyncRouter, createSyncStateRouter } from './sync';
import { createWidgetsRouter } from './widgets';

export interface MountEngineOptions {
  storage?: ServerStorage;
  connectorRegistry: ConnectorRegistry;
  secretsResolver?: SecretsResolver;
  loggerFactory?: ConnectorLoggerFactory;
  startRetention?: boolean;
}

export interface MountEngineResult {
  app: Hono;
  stop(): void;
}

export function mountEngine(
  config: DashboardConfig,
  options: MountEngineOptions,
): MountEngineResult {
  const storage: ServerStorage = options.storage ?? new InMemoryStorage();
  const { connectorRegistry, secretsResolver, loggerFactory } = options;
  const getConfig = (): DashboardConfig => config;
  const getStorage = (): ServerStorage => storage;

  const app = new Hono();
  app.route('/dashboards', createWidgetsRouter({ getConfig, getStorage }));
  app.route(
    ROUTES.sync,
    createSyncRouter({
      getConfig,
      getStorage,
      connectorRegistry,
      secretsResolver,
      loggerFactory,
    }),
  );
  app.route(ROUTES.syncState, createSyncStateRouter({ getStorage }));
  app.route('/retention', createRetentionRouter({ getConfig, getStorage }));
  app.route(ROUTES.health, createHealthRouter());

  let stopRetention: (() => void) | null = null;
  if (options.startRetention !== false) {
    stopRetention = startRetentionLoop({ getConfig, getStorage });
  }

  return {
    app,
    stop() {
      if (stopRetention) {
        stopRetention();
      }
    },
  };
}
